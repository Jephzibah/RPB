import site from '../../site.config.js';

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export const json = (body, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
	});

export function isSameOrigin(request, url) {
	const origin = request.headers.get('Origin');
	// Non-browser clients may omit Origin; Sec-Fetch-Site covers modern browsers that do too.
	if (origin) return origin === url.origin;
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	return !fetchSite || fetchSite === 'same-origin';
}

/** Throws 404 when a feature is switched off in site.config.js, so disabled endpoints don't exist. */
export function requireFeature(name) {
	const f = site.features || {};
	const enabled = name === 'stripe' || name === 'paypal' ? f.shop && f[name] : f[name];
	if (!enabled) throw new HttpError(404, 'Not found');
}

/** Throws 503 listing any missing secrets/vars (message is generic; names go to the log). */
export function requireEnv(env, ...names) {
	const missing = names.filter((name) => !env[name]);
	if (missing.length) {
		console.error(`Missing configuration: ${missing.join(', ')}`);
		throw new HttpError(503, 'This feature is not configured yet.');
	}
}

export async function readJson(request, maxBytes = 16_384) {
	const text = await request.text();
	if (text.length > maxBytes) throw new HttpError(413, 'Request too large');
	try {
		return JSON.parse(text);
	} catch {
		throw new HttpError(400, 'Invalid JSON');
	}
}

export const clean = (value, max) =>
	String(value ?? '')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.trim()
		.slice(0, max);

export const isEmail = (value) => /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(value) && value.length <= 200;
