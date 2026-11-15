import site from '../../site.config.js';
import { HttpError, json, requireFeature, requireEnv, readJson, clean, isEmail } from './http.js';
import { adminEmails } from './admin-users.js';
import { verifyTurnstile } from './turnstile.js';
import { sendEmail } from './email.js';
import { base64url, fromBase64url, hmacHex, randomToken, readCookie, safeEqual, sha256Hex } from './crypto.js';

// Order numbers shown to people are the row id + 1000 so the first order isn't "#1"
const NUMBER_OFFSET = 1000;
const SESSION_COOKIE = '__Host-orders';
const SESSION_SECONDS = 60 * 60;
const LINK_MINUTES = 15;
const MAX_LINKS = 3;
const MAX_CUSTOMER_MESSAGES_PER_HOUR = 10;

export const STATUSES = ['paid', 'processing', 'shipped', 'complete', 'refunded', 'cancelled'];
export const orderNumber = (id) => id + NUMBER_OFFSET;
export const orderIdFrom = (number) => Number(number) - NUMBER_OFFSET;
export const normalizeEmail = (value) => clean(value, 200).toLowerCase();

export const formatMoney = (cents, currency) =>
	new Intl.NumberFormat(site.lang, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export function toOrder(row) {
	return {
		number: orderNumber(row.id),
		status: row.status,
		currency: row.currency,
		total: row.total,
		items: JSON.parse(row.items),
		shipping: row.shipping ? JSON.parse(row.shipping) : null,
		tracking: row.tracking,
		createdAt: row.created_at,
	};
}

// Accepts Stripe's and PayPal's shipping shapes, or our own (admin edits), and stores one consistent shape.
export function normalizeShipping(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const a = raw.address || raw;
	const shipping = {
		name: clean(raw.name?.full_name ?? raw.name, 200),
		line1: clean(a.line1 ?? a.address_line_1, 200),
		line2: clean(a.line2 ?? a.address_line_2, 200),
		city: clean(a.city ?? a.admin_area_2, 100),
		state: clean(a.state ?? a.admin_area_1, 100),
		postal_code: clean(a.postal_code, 20),
		country: clean(a.country ?? a.country_code, 2).toUpperCase(),
	};
	return Object.values(shipping).some(Boolean) ? shipping : null;
}

export async function loadMessages(env, orderIds) {
	if (!orderIds.length) return new Map();
	const { results } = await env.DB.prepare(
		`SELECT order_id, author_role, author_email, body, created_at FROM order_messages WHERE order_id IN (${orderIds.map(() => '?').join(',')}) ORDER BY id`,
	)
		.bind(...orderIds)
		.all();
	const byOrder = new Map(orderIds.map((id) => [id, []]));
	for (const m of results) byOrder.get(m.order_id).push({ role: m.author_role, author: m.author_email, body: m.body, createdAt: m.created_at });
	return byOrder;
}

const itemLines = (order) => order.items.map((item) => `  ${item.qty} × ${item.name}  ${formatMoney(item.price * item.qty, order.currency)}`).join('\n');

/** Stores a paid order once. Returns { number, created }; created is false for a repeat webhook/capture. */
export async function recordOrder(env, { provider, ref, email, name = '', currency, total, items, shipping = null }) {
	if (!env.DB) {
		console.error(`DB binding missing: ${provider} order ${ref} was not stored`);
		return { number: null, created: true };
	}
	const now = Date.now();
	const address = normalizeShipping(shipping);
	const row = await env.DB.prepare(
		`INSERT INTO orders (provider, provider_ref, email, name, currency, total, items, shipping, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (provider, provider_ref) DO NOTHING RETURNING id`,
	)
		.bind(provider, ref, normalizeEmail(email), clean(name, 200), currency.toLowerCase(), total, JSON.stringify(items), address ? JSON.stringify(address) : null, now, now)
		.first();
	return row ? { number: orderNumber(row.id), created: true } : { number: null, created: false };
}

export async function notifyNewOrder(env, { number, provider, email, currency, total, items }) {
	const order = { currency, items };
	const label = number ? `#${number}` : `(${provider}, not stored)`;
	const sends = [
		sendEmail(env, {
			to: env.CONTACT_TO,
			subject: `New order ${label}: ${formatMoney(total, currency)}`,
			text: `New ${provider} order ${label} from ${email || 'unknown email'}.\n\n${itemLines(order)}\n\nTotal: ${formatMoney(total, currency)}\n\nManage it at ${site.url}/admin\n`,
		}),
	];
	if (email && isEmail(email)) {
		sends.push(
			sendEmail(env, {
				to: email,
				replyTo: env.CONTACT_TO,
				subject: `Thanks for your order${number ? ` #${number}` : ''} from ${site.name}`,
				text: `Thanks for your order!\n\n${itemLines(order)}\n\nTotal: ${formatMoney(total, currency)}\n\nYou can check on it any time at ${site.url}/orders using this email address.\n\n${site.name}\n`,
			}),
		);
	}
	const results = await Promise.allSettled(sends);
	results.filter((r) => r.status === 'rejected').forEach((r) => console.error('Order email failed', r.reason));
}

async function sessionCookie(env, email) {
	const value = `${Date.now() + SESSION_SECONDS * 1000}.${base64url(new TextEncoder().encode(email))}`;
	return `${SESSION_COOKIE}=${value}.${await hmacHex(env.ORDERS_SECRET, value)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function sessionEmail(request, env) {
	const [expires, encoded, signature] = readCookie(request, SESSION_COOKIE).split('.');
	if (!signature || !(Number(expires) > Date.now())) return null;
	if (!safeEqual(signature, await hmacHex(env.ORDERS_SECRET, `${expires}.${encoded}`))) return null;
	return new TextDecoder().decode(fromBase64url(encoded));
}

// Admin emails are sent to /admin (Cloudflare Access does the real sign-in). For everyone else the answer is the
// same whether or not the email has orders, so this can't be used to find out who bought what.
export async function login(request, env, ctx) {
	requireFeature('shop');
	requireEnv(env, 'DB', 'TURNSTILE_SECRET', 'EMAIL_FROM');

	const form = await request.formData();
	const human = await verifyTurnstile(form.get('cf-turnstile-response'), request.headers.get('CF-Connecting-IP'), env.TURNSTILE_SECRET, 'login');
	if (!human) throw new HttpError(403, 'Spam check failed.');
	const email = normalizeEmail(form.get('email'));
	if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
	if ((await adminEmails(env)).includes(email)) return json({ redirect: '/admin' });

	const reply = json({ message: `If we have orders for that email, a sign-in link is on its way. It works once and expires in ${LINK_MINUTES} minutes.` });
	const now = Date.now();
	ctx.waitUntil(env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 86_400_000).run());

	const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND expires_at > ?').bind(email, now).first('n');
	if (recent >= MAX_LINKS) return reply;
	if (!(await env.DB.prepare('SELECT 1 FROM orders WHERE email = ? LIMIT 1').bind(email).first())) return reply;

	const token = randomToken();
	await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)')
		.bind(await sha256Hex(token), email, now + LINK_MINUTES * 60_000)
		.run();
	ctx.waitUntil(
		sendEmail(env, {
			to: email,
			subject: `Your ${site.name} orders`,
			text: `Use this link to see your orders. It works once and expires in ${LINK_MINUTES} minutes:\n\n${site.url}/orders/verify#token=${token}\n\nIf you didn't ask for this, you can ignore this email.\n`,
		}).catch((error) => console.error('Order link email failed', error)),
	);
	return reply;
}

export async function createOrderSession(request, env) {
	requireFeature('shop');
	requireEnv(env, 'DB', 'ORDERS_SECRET');

	const { token } = await readJson(request, 1024);
	if (typeof token !== 'string' || !token) throw new HttpError(400, 'This link is incomplete. Please request a new one.');
	const now = Date.now();
	const row = await env.DB.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email')
		.bind(now, await sha256Hex(token), now)
		.first();
	if (!row) throw new HttpError(400, 'This link has expired or was already used. Please request a new one.');
	return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env, row.email) });
}

export async function listMyOrders(request, env) {
	requireFeature('shop');
	requireEnv(env, 'DB', 'ORDERS_SECRET');

	const email = await sessionEmail(request, env);
	if (!email) throw new HttpError(401, 'Please sign in to see your orders.');
	const { results } = await env.DB.prepare('SELECT * FROM orders WHERE email = ? ORDER BY id DESC LIMIT 100').bind(email).all();
	const messages = await loadMessages(env, results.map((row) => row.id));
	// Staff addresses stay private; customers see the business name instead
	const forCustomer = (m) => ({ role: m.role, body: m.body, createdAt: m.createdAt });
	return json({ email, siteName: site.name, orders: results.map((row) => ({ ...toOrder(row), messages: messages.get(row.id).map(forCustomer) })) });
}

export async function postCustomerMessage(request, env, ctx, [number]) {
	requireFeature('shop');
	requireEnv(env, 'DB', 'ORDERS_SECRET');

	const email = await sessionEmail(request, env);
	if (!email) throw new HttpError(401, 'Please sign in again to send a message.');
	const row = await env.DB.prepare('SELECT id, email FROM orders WHERE id = ?').bind(orderIdFrom(number)).first();
	if (!row || row.email !== email) throw new HttpError(404, 'Order not found.');
	const body = clean((await readJson(request)).body, 2000);
	if (!body) throw new HttpError(400, 'The message is empty.');

	const now = Date.now();
	const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_messages WHERE order_id = ? AND author_role = 'customer' AND created_at > ?")
		.bind(row.id, now - 3_600_000)
		.first('n');
	if (recent >= MAX_CUSTOMER_MESSAGES_PER_HOUR) throw new HttpError(429, 'You’ve sent a lot of messages in the last hour. Please wait a bit, or reply to one of our emails.');

	await env.DB.prepare("INSERT INTO order_messages (order_id, author_role, author_email, body, created_at) VALUES (?, 'customer', ?, ?, ?)")
		.bind(row.id, email, body, now)
		.run();
	ctx.waitUntil(
		sendEmail(env, {
			to: env.CONTACT_TO,
			replyTo: email,
			subject: `Customer message on order #${number}`,
			text: `${email} wrote about order #${number}:\n\n${body}\n\nReply in the admin: ${site.url}/admin#order-${number}\n`,
		}).catch((error) => console.error('Message email failed', error)),
	);
	return json({ ok: true });
}

export async function endOrderSession() {
	return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
}
