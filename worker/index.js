import { HttpError, json, isSameOrigin } from './lib/http.js';
import { handleContact } from './lib/contact.js';
import { createStripeCheckout, handleStripeWebhook } from './lib/stripe.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';

// Only /api/* reaches this code (wrangler.jsonc `run_worker_first`). Routes: [method, path pattern, handler, options]
const routes = [
	['POST', /^\/api\/contact$/, handleContact],
	['POST', /^\/api\/checkout\/stripe$/, createStripeCheckout],
	['POST', /^\/api\/webhooks\/stripe$/, handleStripeWebhook, { crossOrigin: true }],
	['POST', /^\/api\/paypal\/orders$/, createPayPalOrder],
	['POST', /^\/api\/paypal\/orders\/([A-Z0-9]+)\/capture$/, capturePayPalOrder],
];

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

		for (const [method, pattern, handler, options = {}] of routes) {
			const match = url.pathname.match(pattern);
			if (!match) continue;
			if (request.method !== method) return json({ error: 'Method not allowed' }, 405, { Allow: method });
			// Browser endpoints only accept requests from our own pages (basic CSRF protection)
			if (!options.crossOrigin && !isSameOrigin(request, url)) return json({ error: 'Forbidden' }, 403);

			try {
				return await handler(request, env, ctx, match.slice(1));
			} catch (error) {
				if (error instanceof HttpError) return json({ error: error.message }, error.status);
				console.error(`${method} ${url.pathname} failed`, error);
				return json({ error: 'Something went wrong. Please try again.' }, 500);
			}
		}
		return json({ error: 'Not found' }, 404);
	},
};
