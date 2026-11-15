import { HttpError, json, requireFeature, requireEnv, readJson } from './http.js';
import { resolveCart } from './catalog.js';
import { recordOrder, notifyNewOrder } from './orders.js';

const apiBase = (env) => (env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

// Assumes a 2-decimal currency (USD, EUR, GBP…). Zero-decimal currencies (JPY) need adjusting.
const toValue = (cents) => (cents / 100).toFixed(2);

async function accessToken(env) {
	const response = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	if (!response.ok) {
		console.error('PayPal auth failed', response.status, await response.text());
		throw new HttpError(502, 'PayPal is unavailable right now.');
	}
	return (await response.json()).access_token;
}

async function paypal(env, path, body, method = 'POST') {
	const response = await fetch(`${apiBase(env)}${path}`, {
		method,
		headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.json();
	if (!response.ok) {
		console.error('PayPal API error', response.status, JSON.stringify(data));
		throw new HttpError(502, 'PayPal could not process the order.');
	}
	return data;
}

export async function createPayPalOrder(request, env) {
	requireFeature('paypal');
	requireEnv(env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET');

	const { items } = await readJson(request);
	const { currency, lines, total } = resolveCart(items);
	const currency_code = currency.toUpperCase();

	const order = await paypal(env, '/v2/checkout/orders', {
		intent: 'CAPTURE',
		purchase_units: [
			{
				amount: { currency_code, value: toValue(total), breakdown: { item_total: { currency_code, value: toValue(total) } } },
				items: lines.map(({ product, qty }) => ({
					name: product.name.slice(0, 127),
					sku: product.id,
					quantity: String(qty),
					unit_amount: { currency_code, value: toValue(product.price) },
				})),
			},
		],
	});
	return json({ id: order.id });
}

/** Captures an approved order. The amount was fixed server-side at creation, so it can't be altered here. */
export async function capturePayPalOrder(request, env, ctx, [orderId]) {
	requireFeature('paypal');
	requireEnv(env, 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET');

	const result = await paypal(env, `/v2/checkout/orders/${orderId}/capture`);
	if (result.status === 'COMPLETED') {
		// The capture response has no line items, so read the order back for them
		const details = await paypal(env, `/v2/checkout/orders/${orderId}`, undefined, 'GET');
		const unit = details.purchase_units?.[0] || {};
		const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
		const toCents = (value) => Math.round(Number.parseFloat(value) * 100);
		const order = {
			provider: 'paypal',
			ref: result.id,
			email: details.payer?.email_address || '',
			name: [details.payer?.name?.given_name, details.payer?.name?.surname].filter(Boolean).join(' '),
			currency: capture?.amount?.currency_code || unit.amount?.currency_code,
			total: toCents(capture?.amount?.value ?? unit.amount?.value),
			items: (unit.items || []).map((item) => ({ id: item.sku, name: item.name, qty: Number(item.quantity), price: toCents(item.unit_amount?.value) })),
			shipping: unit.shipping || null,
		};
		const { number, created } = await recordOrder(env, order);
		if (created) ctx.waitUntil(notifyNewOrder(env, { ...order, number }));
		return json({ id: result.id, status: result.status, number });
	}
	return json({ id: result.id, status: result.status });
}
