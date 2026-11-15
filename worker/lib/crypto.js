const encoder = new TextEncoder();

export const toHex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function base64url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value) {
	const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hmacHex(secret, message) {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

export const sha256Hex = async (value) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export function safeEqual(a, b) {
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

export const randomToken = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export function readCookie(request, name) {
	for (const part of (request.headers.get('Cookie') || '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return value.join('=');
	}
	return '';
}
