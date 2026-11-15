import site from '../../site.config.js';
import { HttpError, json, requireFeature, requireEnv, readJson, clean, isEmail } from './http.js';
import { requireAdmin } from './access.js';
import { sendEmail } from './email.js';
import { STATUSES, loadMessages, normalizeEmail, normalizeShipping, orderIdFrom, orderNumber, toOrder } from './orders.js';

const PAGE_SIZE = 25;

async function admin(request, env) {
	requireFeature('shop');
	requireEnv(env, 'DB');
	return requireAdmin(request, env);
}

const adminOrder = (row) => ({ ...toOrder(row), email: row.email, name: row.name, provider: row.provider, providerRef: row.provider_ref, updatedAt: row.updated_at });

const audit = (env, actor, action, orderId, detail) =>
	env.DB.prepare('INSERT INTO audit_log (actor, action, order_id, detail, created_at) VALUES (?, ?, ?, ?, ?)').bind(
		`${actor.email} (${actor.role})`,
		action,
		orderId,
		JSON.stringify(detail),
		Date.now(),
	);

async function findOrder(env, number) {
	const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderIdFrom(number)).first();
	if (!row) throw new HttpError(404, 'Order not found.');
	return row;
}

export async function adminMe(request, env) {
	return json(await admin(request, env));
}

export async function adminListOrders(request, env) {
	await admin(request, env);
	const params = new URL(request.url).searchParams;
	const where = [];
	const binds = [];

	const status = params.get('status');
	if (STATUSES.includes(status)) {
		where.push('status = ?');
		binds.push(status);
	}
	const email = normalizeEmail(params.get('email'));
	if (email) {
		where.push('email = ?');
		binds.push(email);
	}
	const q = clean(params.get('q'), 200).toLowerCase();
	if (/^#?\d+$/.test(q)) {
		where.push('id = ?');
		binds.push(orderIdFrom(q.replace('#', '')));
	} else if (q) {
		where.push("(email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\')");
		const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
		binds.push(like, like);
	}
	const before = Number.parseInt(params.get('before'), 10);
	if (before > 0) {
		where.push('id < ?');
		binds.push(orderIdFrom(before));
	}

	const sql = `SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`;
	const { results } = await env.DB.prepare(sql).bind(...binds).all();
	const orders = results.slice(0, PAGE_SIZE).map(adminOrder);
	return json({ orders, next: results.length > PAGE_SIZE ? orders.at(-1).number : null });
}

export async function adminGetOrder(request, env, ctx, [number]) {
	await admin(request, env);
	const row = await findOrder(env, number);
	const [[notes, history], messages] = await Promise.all([
		env.DB.batch([
			env.DB.prepare('SELECT author, body, created_at FROM order_notes WHERE order_id = ? ORDER BY id').bind(row.id),
			env.DB.prepare('SELECT actor, action, detail, created_at FROM audit_log WHERE order_id = ? ORDER BY id').bind(row.id),
		]),
		loadMessages(env, [row.id]),
	]);
	return json({
		order: adminOrder(row),
		messages: messages.get(row.id),
		notes: notes.results.map((n) => ({ author: n.author, body: n.body, createdAt: n.created_at })),
		history: history.results.map((h) => ({ actor: h.actor, action: h.action, detail: JSON.parse(h.detail), createdAt: h.created_at })),
	});
}

export async function adminUpdateOrder(request, env, ctx, [number]) {
	const actor = await admin(request, env);
	const row = await findOrder(env, number);
	const body = await readJson(request);

	const status = body.status ?? row.status;
	if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status.');
	const tracking = body.tracking === undefined ? row.tracking : clean(body.tracking, 200);
	if (status === row.status && tracking === row.tracking) return json({ order: adminOrder(row) });

	const [updated] = await env.DB.batch([
		env.DB.prepare('UPDATE orders SET status = ?, tracking = ?, updated_at = ? WHERE id = ? RETURNING *').bind(status, tracking, Date.now(), row.id),
		audit(env, actor, 'update', row.id, { from: { status: row.status, tracking: row.tracking }, to: { status, tracking }, notified: Boolean(body.notify) }),
	]);

	if (body.notify) {
		ctx.waitUntil(
			sendEmail(env, {
				to: row.email,
				replyTo: env.CONTACT_TO,
				subject: `Order #${orderNumber(row.id)} is ${status}`,
				text: `Your ${site.name} order #${orderNumber(row.id)} is now: ${status}.${tracking ? `\nTracking: ${tracking}` : ''}\n\nSee your orders at ${site.url}/orders\n`,
			}).catch((error) => console.error('Status email failed', error)),
		);
	}
	return json({ order: adminOrder(updated.results[0]) });
}

export async function adminAddNote(request, env, ctx, [number]) {
	const actor = await admin(request, env);
	const row = await findOrder(env, number);
	const note = clean((await readJson(request)).body, 2000);
	if (!note) throw new HttpError(400, 'The note is empty.');
	await env.DB.prepare('INSERT INTO order_notes (order_id, author, body, created_at) VALUES (?, ?, ?, ?)')
		.bind(row.id, actor.email, note, Date.now())
		.run();
	return json({ ok: true });
}

export async function adminPostMessage(request, env, ctx, [number]) {
	const actor = await admin(request, env);
	const row = await findOrder(env, number);
	const body = clean((await readJson(request)).body, 2000);
	if (!body) throw new HttpError(400, 'The message is empty.');
	await env.DB.prepare('INSERT INTO order_messages (order_id, author_role, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(row.id, actor.role, actor.email, body, Date.now())
		.run();
	ctx.waitUntil(
		sendEmail(env, {
			to: row.email,
			replyTo: env.CONTACT_TO,
			subject: `New message about your ${site.name} order #${orderNumber(row.id)}`,
			text: `${body}\n\nTo reply or see your order, sign in at ${site.url}/login\n\n${site.name}\n`,
		}).catch((error) => console.error('Message email failed', error)),
	);
	return json({ ok: true });
}

const maskEmail = (email) => email.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1•••$2•••$3');

// The email is how a customer signs in, so it moves across every order on the old address at once.
const moveEmailStatements = (env, from, to, now) => [
	env.DB.prepare('UPDATE orders SET email = ?, updated_at = ? WHERE email = ?').bind(to, now, from),
	env.DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(from),
];

const notifyEmailMove = (env, ctx, from, to, count) =>
	ctx.waitUntil(
		Promise.allSettled([
			sendEmail(env, {
				to: from,
				replyTo: env.CONTACT_TO,
				subject: `The email on your ${site.name} orders was changed`,
				text: `Your ${site.name} orders now use ${maskEmail(to)}. If you didn't ask for this, reply to this email right away.\n`,
			}),
			sendEmail(env, {
				to,
				replyTo: env.CONTACT_TO,
				subject: `Your ${site.name} orders now use this email`,
				text: `${count} order${count === 1 ? '' : 's'} moved to this address. Sign in to see them at ${site.url}/login\n`,
			}),
		]),
	);

const countOrders = (env, email) => env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE email = ?').bind(email).first('n');

const parseShipping = (json) => normalizeShipping(json ? JSON.parse(json) : null);

/**
 * Name and shipping change this order only. An email change moves every order on the old address (the email is
 * how a customer signs in), so it requires `confirmed` — only after verifying the person some other way (README runbook).
 */
export async function adminEditCustomer(request, env, ctx, [number]) {
	const actor = await admin(request, env);
	const row = await findOrder(env, number);
	const body = await readJson(request);

	const name = body.name === undefined ? row.name : clean(body.name, 200);
	const oldShipping = parseShipping(row.shipping);
	const shipping = body.shipping === undefined ? oldShipping : normalizeShipping(body.shipping);
	const email = body.email === undefined ? row.email : normalizeEmail(body.email);
	if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
	const emailChanged = email !== row.email;
	if (emailChanged && body.confirmed !== true) throw new HttpError(400, 'Confirm you’ve verified this person before changing their email.');

	const changes = {};
	if (name !== row.name) changes.name = { from: row.name, to: name };
	if (JSON.stringify(shipping) !== JSON.stringify(oldShipping)) changes.shipping = { from: oldShipping, to: shipping };
	if (emailChanged) {
		changes.email = { from: row.email, to: email, orders: await countOrders(env, row.email) };
	}
	if (!Object.keys(changes).length) return json({ order: adminOrder(row) });

	const now = Date.now();
	await env.DB.batch([
		env.DB.prepare('UPDATE orders SET name = ?, shipping = ?, updated_at = ? WHERE id = ?').bind(name, shipping ? JSON.stringify(shipping) : null, now, row.id),
		...(emailChanged ? moveEmailStatements(env, row.email, email, now) : []),
		audit(env, actor, 'edit-customer', row.id, changes),
	]);

	if (emailChanged) notifyEmailMove(env, ctx, row.email, email, changes.email.orders);
	return json({ order: adminOrder(await findOrder(env, number)) });
}

export async function adminListCustomers(request, env) {
	await admin(request, env);
	const params = new URL(request.url).searchParams;
	const q = clean(params.get('q'), 200).toLowerCase();
	const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
	const { results } = await env.DB.prepare(
		`SELECT email, MAX(name) AS name, COUNT(*) AS orders, SUM(total) AS spent, MAX(currency) AS currency, MAX(created_at) AS last_order
		 FROM orders ${q ? "WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\'" : ''}
		 GROUP BY email ORDER BY last_order DESC LIMIT 500`,
	)
		.bind(...(q ? [like, like] : []))
		.all();
	return json({
		customers: results.map((c) => ({ email: c.email, name: c.name, orders: c.orders, spent: c.spent, currency: c.currency, lastOrder: c.last_order })),
	});
}

export async function adminChangeCustomerEmail(request, env, ctx) {
	const actor = await admin(request, env);
	const body = await readJson(request);
	const from = normalizeEmail(body.from);
	const to = normalizeEmail(body.to);
	if (!isEmail(from) || !isEmail(to)) throw new HttpError(400, 'Please enter a valid email address.');
	if (from === to) throw new HttpError(400, 'The new email is the same as the old one.');
	if (body.confirmed !== true) throw new HttpError(400, 'Confirm you’ve verified this person before changing their email.');
	const count = await countOrders(env, from);
	if (!count) throw new HttpError(404, 'No orders use that email.');

	await env.DB.batch([...moveEmailStatements(env, from, to, Date.now()), audit(env, actor, 'change-email', null, { from, to, orders: count })]);
	notifyEmailMove(env, ctx, from, to, count);
	return json({ moved: count });
}

const csvCell = (value) => {
	let text = String(value ?? '');
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function adminExportCsv(request, env) {
	await admin(request, env);
	const { results } = await env.DB.prepare('SELECT * FROM orders ORDER BY id').all();
	const header = ['Order', 'Date', 'Status', 'Email', 'Name', 'Items', 'Total', 'Currency', 'Tracking', 'Provider', 'Provider reference'];
	const rows = results.map((row) => {
		const items = JSON.parse(row.items).map((item) => `${item.qty} x ${item.name}`).join('; ');
		return [orderNumber(row.id), new Date(row.created_at).toISOString(), row.status, row.email, row.name, items, (row.total / 100).toFixed(2), row.currency.toUpperCase(), row.tracking, row.provider, row.provider_ref];
	});
	const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
	return new Response(`${csv}\r\n`, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
			'Cache-Control': 'no-store',
		},
	});
}
