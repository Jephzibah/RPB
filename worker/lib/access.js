import { HttpError, requireEnv } from './http.js';
import { fromBase64url } from './crypto.js';

const CERTS_TTL = 60 * 60 * 1000;
const CERTS_MIN_REFRESH = 60 * 1000;
let certs = { keys: new Map(), fetchedAt: 0 };

async function loadKeys(teamDomain) {
	const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!response.ok) throw new Error(`Access certs request failed: ${response.status}`);
	const keys = new Map();
	for (const jwk of (await response.json()).keys || []) {
		keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
	}
	certs = { keys, fetchedAt: Date.now() };
}

async function signingKey(teamDomain, kid) {
	const age = Date.now() - certs.fetchedAt;
	// Unknown kid = Cloudflare rotated keys, but don't let forged kids trigger a fetch on every request
	if (age > CERTS_TTL || (!certs.keys.has(kid) && age > CERTS_MIN_REFRESH)) await loadKeys(teamDomain);
	return certs.keys.get(kid);
}

const decodeJson = (part) => JSON.parse(new TextDecoder().decode(fromBase64url(part)));

function identity(env, email) {
	const providers = (env.PROVIDER_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
	const normalized = email.toLowerCase();
	return { email: normalized, role: providers.includes(normalized) ? 'provider' : 'owner' };
}

/**
 * Cloudflare Access already blocks unauthenticated requests at the edge; this re-checks its signed JWT so the
 * Worker never trusts a request that reached it some other way (e.g. a workers.dev URL or a misconfigured app).
 */
export async function requireAdmin(request, env) {
	const { hostname } = new URL(request.url);
	if (env.ACCESS_DEV_EMAIL && (hostname === 'localhost' || hostname === '127.0.0.1')) return identity(env, env.ACCESS_DEV_EMAIL);

	requireEnv(env, 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD');
	const unauthorized = new HttpError(401, 'Not signed in.');
	const [header, payload, signature] = (request.headers.get('Cf-Access-Jwt-Assertion') || '').split('.');
	if (!signature) throw unauthorized;

	let claims;
	try {
		const { alg, kid } = decodeJson(header);
		const key = alg === 'RS256' && (await signingKey(env.ACCESS_TEAM_DOMAIN, kid));
		const valid = key && (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`)));
		if (!valid) throw unauthorized;
		claims = decodeJson(payload);
	} catch (error) {
		if (error !== unauthorized) console.error('Access JWT check failed', error);
		throw unauthorized;
	}

	const audiences = [].concat(claims.aud || []);
	const now = Date.now() / 1000;
	if (!audiences.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}` || !(claims.exp > now) || !claims.email) {
		throw unauthorized;
	}
	return identity(env, claims.email);
}
