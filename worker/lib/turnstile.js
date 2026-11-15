// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export async function verifyTurnstile(token, ip, secret) {
	if (!token || typeof token !== 'string') return false;
	const body = new FormData();
	body.append('secret', secret);
	body.append('response', token);
	if (ip) body.append('remoteip', ip);

	const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
	if (!response.ok) return false;
	const result = await response.json();
	return result.success === true;
}
