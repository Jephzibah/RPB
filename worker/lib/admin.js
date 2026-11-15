import site from '../../site.config.js';
import { HttpError, json, requireFeature, requireEnv, readJson, clean, isEmail } from './http.js';
import { requireAdmin } from './access.js';
import { sendEmail } from './email.js';
import { STATUSES, normalizeEmail, orderIdFrom, orderNumber, toOrder } from './orders.js';

const PAGE_SIZE = 50;

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
	const [notes, history] = await env.DB.batch([
		env.DB.prepare('SELECT author, body, created_at FROM order_notes WHERE order_id = ? ORDER BY id').bind(row.id),
		env.DB.prepare('SELECT actor, action, detail, created_at FROM audit_log WHERE order_id = ? ORDER BY id').bind(row.id),
	]);
	return json({
		order: adminOrder(row),
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

const maskEmail = (email) => email.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1•••$2•••$3');

// Only after verifying the person some other way (see README: "Changing a customer's email")
export async function adminChangeEmail(request, env, ctx) {
	const actor = await admin(request, env);
	const body = await readJson(request);
	const from = normalizeEmail(body.from);
	const to = normalizeEmail(body.to);
	if (!isEmail(from) || !isEmail(to)) throw new HttpError(400, 'Enter both email addresses.');
	if (from === to) throw new HttpError(400, 'The new email is the same as the old one.');

	const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE email = ?').bind(from).first('n');
	if (!existing) throw new HttpError(404, 'No orders use that email.');

	const [moved] = await env.DB.batch([
		env.DB.prepare('UPDATE orders SET email = ?, updated_at = ? WHERE email = ?').bind(to, Date.now(), from),
		env.DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(from),
		audit(env, actor, 'change-email', null, { from, to }),
	]);
	const count = moved.meta.changes;

	const notices = [
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
			text: `${count} order${count === 1 ? '' : 's'} moved to this address. See them at ${site.url}/orders\n`,
		}),
	];
	ctx.waitUntil(Promise.allSettled(notices));
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
