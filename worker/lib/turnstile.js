import site from '../../site.config.js';

const MAX_TOKEN_LENGTH = 2048;
const host = new URL(site.url).hostname;
const HOSTNAMES = [host, host.startsWith('www.') ? host.slice(4) : `www.${host}`];
// Cloudflare's public test secrets (always pass/fail) report a dummy hostname and no action
const isTestSecret = (secret) => /^[123]x0{30,}AA$/.test(secret);

/** Fails closed: any network error, timeout, or mismatched action/hostname counts as not human. */
export async function verifyTurnstile(token, ip, secret, action) {
	if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return false;
	const body = new FormData();
	body.append('secret', secret);
	body.append('response', token);
	if (ip) body.append('remoteip', ip);

	try {
		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return false;
		const result = await response.json();
		if (result.success !== true) return false;
		if (isTestSecret(secret)) return true;
		return result.action === action && HOSTNAMES.includes(result.hostname);
	} catch (error) {
		console.error('Turnstile verification failed', error);
		return false;
	}
}
