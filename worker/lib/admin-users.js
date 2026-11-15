import site from '../../site.config.js';
import { HttpError, json, requireFeature, requireEnv, readJson, clean, isEmail, emailList } from './http.js';
import { requireAdmin } from './access.js';
import { sendEmail } from './email.js';

// Fields the Access "update policy" API accepts; everything else the GET returns (id, timestamps…) is read-only
const WRITABLE = ['name', 'decision', 'include', 'exclude', 'require', 'session_duration', 'approval_required', 'approval_groups', 'isolation_required', 'purpose_justification_required', 'purpose_justification_prompt', 'mfa_config', 'connection_rules'];
const CACHE_MS = 5 * 60 * 1000;
let cache = { emails: null, at: 0 };

const normalizeEmail = (value) => clean(value, 200).toLowerCase();
const configured = (env) => Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.ACCESS_POLICY_ID);

async function accessApi(env, method, body) {
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/access/policies/${env.ACCESS_POLICY_ID}`, {
		method,
		headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(10_000),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok || !data.success) {
		console.error('Access policy API error', response.status, JSON.stringify(data.errors || data));
		throw new HttpError(502, 'Cloudflare Access could not be updated right now.');
	}
	return data.result;
}

const policyEmails = (policy) => (policy.include || []).filter((rule) => rule.email?.email).map((rule) => rule.email.email.toLowerCase());

/** Everyone who can sign in to /admin: the Access policy when the API is set up, else PROVIDER_EMAILS + OWNER_EMAILS. */
export async function adminEmails(env) {
	const fallback = [...emailList(env.PROVIDER_EMAILS), ...emailList(env.OWNER_EMAILS)];
	if (!configured(env)) return fallback;
	if (cache.emails && Date.now() - cache.at < CACHE_MS) return cache.emails;
	try {
		cache = { emails: policyEmails(await accessApi(env, 'GET')), at: Date.now() };
		return cache.emails;
	} catch {
		return fallback;
	}
}

async function adminUser(request, env) {
	requireFeature('shop');
	requireEnv(env, 'DB');
	const actor = await requireAdmin(request, env);
	if (!configured(env)) throw new HttpError(503, 'Admin user management isn’t set up yet (see README → Orders → Setup).');
	return actor;
}

const audit = (env, actor, action, detail) =>
	env.DB.prepare('INSERT INTO audit_log (actor, action, order_id, detail, created_at) VALUES (?, ?, NULL, ?, ?)')
		.bind(`${actor.email} (${actor.role})`, action, JSON.stringify(detail), Date.now())
		.run();

function describe(env, policy) {
	const providers = emailList(env.PROVIDER_EMAILS);
	return policyEmails(policy).map((email) => ({ email, role: providers.includes(email) ? 'provider' : 'owner' }));
}

async function savePolicy(env, policy, include) {
	const body = Object.fromEntries(WRITABLE.filter((key) => policy[key] !== undefined).map((key) => [key, policy[key]]));
	const updated = await accessApi(env, 'PUT', { ...body, include });
	cache = { emails: policyEmails(updated), at: Date.now() };
	return updated;
}

export async function adminListUsers(request, env) {
	const actor = await adminUser(request, env);
	return json({ users: describe(env, await accessApi(env, 'GET')), you: actor });
}

export async function adminAddUser(request, env, ctx) {
	const actor = await adminUser(request, env);
	const email = normalizeEmail((await readJson(request)).email);
	if (!isEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');

	const policy = await accessApi(env, 'GET');
	if (policyEmails(policy).includes(email)) throw new HttpError(409, 'That email can already sign in.');
	const updated = await savePolicy(env, policy, [...(policy.include || []), { email: { email } }]);
	await audit(env, actor, 'add-admin', { email });

	ctx.waitUntil(
		sendEmail(env, {
			to: email,
			replyTo: env.CONTACT_TO,
			subject: `You've been added to the ${site.name} admin`,
			text: `${actor.email} gave you access to the ${site.name} orders admin.\n\nSign in at ${site.url}/login with this email address. You'll get a one-time code by email; there's no password.\n`,
		}).catch((error) => console.error('Admin invite email failed', error)),
	);
	return json({ users: describe(env, updated) });
}

// Owners can manage owners; only providers can remove a provider. Nobody can remove themselves (no lock-outs).
export async function adminRemoveUser(request, env) {
	const actor = await adminUser(request, env);
	const email = normalizeEmail((await readJson(request)).email);
	if (email === actor.email) throw new HttpError(400, 'You can’t remove yourself. Ask another admin to do it.');
	if (emailList(env.PROVIDER_EMAILS).includes(email) && actor.role !== 'provider') throw new HttpError(403, 'Only the provider can remove a provider.');

	const policy = await accessApi(env, 'GET');
	const include = (policy.include || []).filter((rule) => rule.email?.email?.toLowerCase() !== email);
	if (include.length === (policy.include || []).length) throw new HttpError(404, 'That email isn’t an admin.');
	if (!include.length) throw new HttpError(400, 'At least one admin has to remain.');
	const updated = await savePolicy(env, policy, include);
	await audit(env, actor, 'remove-admin', { email });
	return json({ users: describe(env, updated) });
}
