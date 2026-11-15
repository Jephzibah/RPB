import { HttpError, json, requireFeature, requireEnv, readJson } from './http.js';
import { resolveCart } from './catalog.js';
import { sendEmail } from './email.js';

const API = 'https://api.stripe.com/v1';

/** Stripe's API takes form-encoded nested params: line_items[0][price_data][currency]=usd */
function formEncode(value, prefix = '', params = new URLSearchParams()) {
	if (value === undefined || value === null) return params;
	if (typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) formEncode(child, prefix ? `${prefix}[${key}]` : key, params);
	} else {
		params.append(prefix, String(value));
	}
	return params;
}

async function stripe(env, path, params) {
	const response = await fetch(`${API}${path}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formEncode(params),
	});
	const data = await response.json();
	if (!response.ok) {
		console.error('Stripe API error', data.error);
		throw new HttpError(502, 'Checkout is unavailable right now.');
	}
	return data;
}

export async function createStripeCheckout(request, env) {
	requireFeature('stripe');
	requireEnv(env, 'STRIPE_SECRET_KEY');

	const { items } = await readJson(request);
	const { currency, lines, shippingCountries } = resolveCart(items);
	const origin = new URL(request.url).origin;

	const session = await stripe(env, '/checkout/sessions', {
		mode: 'payment',
		success_url: `${origin}/thanks?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${origin}/cart`,
		line_items: lines.map(({ product, qty }) =>
			product.stripePriceId
				? { price: product.stripePriceId, quantity: qty }
				: { quantity: qty, price_data: { currency, unit_amount: product.price, product_data: { name: product.name } } },
		),
		...(shippingCountries.length && { shipping_address_collection: { allowed_countries: shippingCountries } }),
	});

	return json({ url: session.url });
}

export async function handleStripeWebhook(request, env, ctx) {
	requireFeature('stripe');
	requireEnv(env, 'STRIPE_WEBHOOK_SECRET');

	const payload = await request.text();
	const valid = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
	if (!valid) throw new HttpError(400, 'Invalid signature');

	const event = JSON.parse(payload);
	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object;
			const amount = (session.amount_total / 100).toFixed(2);
			ctx.waitUntil(
				sendEmail(env, {
					to: env.CONTACT_TO,
					subject: `New order: ${amount} ${session.currency.toUpperCase()}`,
					text: `Stripe checkout completed.\n\nSession: ${session.id}\nCustomer: ${session.customer_details?.email || '-'}\nAmount: ${amount} ${session.currency.toUpperCase()}\n\nSee the Stripe dashboard for line items and shipping.`,
				}).catch((error) => console.error('Order email failed', error)),
			);
			break;
		}
		default:
			break;
	}
	return json({ received: true });
}

// https://docs.stripe.com/webhooks#verify-manually
async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
	if (!header) return false;
	const parts = header.split(',').map((part) => part.split('='));
	const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
	const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
	if (!timestamp || !signatures.length) return false;
	if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
	const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return signatures.some((signature) => timingSafeEqual(signature, expected));
}

function timingSafeEqual(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
