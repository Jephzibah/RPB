import site from '../../site.config.js';
import { isSameOrigin } from './http.js';

const PAGE = '/coming-soon';
const COOKIE = 'site_preview';
const MAX_AGE = 60 * 60 * 24 * 30;
const PUBLIC = [
	/^\/robots\.txt$/,
	/^\/favicon\.svg$/,
	/^\/apple-touch-icon\.png$/,
	/^\/assets\/[^/]+\.(css|js|woff2)$/,
	/^\/assets\/rpb-logo-[^/]+$/,
];

const encoder = new TextEncoder();

async function token(password) {
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode('coming-soon-preview'));
	return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function matches(a, b) {
	const left = encoder.encode(a);
	const right = encoder.encode(b);
	return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

function readCookie(request, name) {
	for (const part of (request.headers.get('Cookie') || '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return value.join('=');
	}
	return '';
}

const safeNext = (value) => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/');

async function page(request, env, { next, error = false } = {}) {
	const asset = await env.ASSETS.fetch(new Request(new URL(PAGE, request.url), { headers: request.headers }));
	let rewriter = new HTMLRewriter().on('input[name="next"]', {
		element: (el) => el.setAttribute('value', next),
	});
	if (error) {
		rewriter = rewriter
			.on('[data-unlock-error]', { element: (el) => el.setInnerContent('That password didn’t work. Please try again.') })
			.on('input[name="password"]', {
				element: (el) => {
					el.setAttribute('aria-invalid', 'true');
					el.setAttribute('autofocus', '');
				},
			});
	}
	const response = rewriter.transform(asset);
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'no-store');
	headers.set('X-Robots-Tag', 'noindex, nofollow');
	return new Response(response.body, { status: error ? 401 : 503, headers });
}

async function unlock(request, env, url) {
	if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
	if (!isSameOrigin(request, url)) return new Response('Forbidden', { status: 403 });

	const form = await request.formData();
	const next = safeNext(form.get('next'));
	const password = String(form.get('password') || '');
	if (!env.SITE_PASSWORD || !password || !matches(await token(password), await token(env.SITE_PASSWORD))) {
		return page(request, env, { next, error: true });
	}
	return new Response(null, {
		status: 303,
		headers: {
			Location: next,
			'Cache-Control': 'no-store',
			'Set-Cookie': `${COOKIE}=${await token(env.SITE_PASSWORD)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
		},
	});
}

// Returns a Response while the site is gated, or null to let the request through.
export async function comingSoon(request, env) {
	if (!site.comingSoon) return null;
	const url = new URL(request.url);

	if (url.pathname === '/api/unlock') return unlock(request, env, url);
	if (url.pathname.startsWith('/api/webhooks/')) return null;
	const cookie = readCookie(request, COOKIE);
	if (env.SITE_PASSWORD && cookie && matches(cookie, await token(env.SITE_PASSWORD))) return null;
	if (PUBLIC.some((pattern) => pattern.test(url.pathname))) return env.ASSETS.fetch(request);
	return page(request, env, { next: url.pathname + url.search });
}
