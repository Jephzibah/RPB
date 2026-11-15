import { HttpError, json, isSameOrigin } from './lib/http.js';
import { handleContact } from './lib/contact.js';
import { createStripeCheckout, handleStripeWebhook } from './lib/stripe.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';
import { comingSoon } from './lib/coming-soon.js';
import { requestOrderLink, createOrderSession, listMyOrders, endOrderSession } from './lib/orders.js';
import { adminMe, adminListOrders, adminGetOrder, adminUpdateOrder, adminAddNote, adminChangeEmail, adminExportCsv } from './lib/admin.js';

// Only /api/* reaches this code (wrangler.jsonc `run_worker_first`), or every request while site.comingSoon is on. Routes: [method, path pattern, handler, options]
const routes = [
	['POST', /^\/api\/contact$/, handleContact],
	['POST', /^\/api\/checkout\/stripe$/, createStripeCheckout],
	['POST', /^\/api\/webhooks\/stripe$/, handleStripeWebhook, { crossOrigin: true }],
	['POST', /^\/api\/paypal\/orders$/, createPayPalOrder],
	['POST', /^\/api\/paypal\/orders\/([A-Z0-9]+)\/capture$/, capturePayPalOrder],
	['POST', /^\/api\/orders\/link$/, requestOrderLink],
	['POST', /^\/api\/orders\/session$/, createOrderSession],
	['POST', /^\/api\/orders\/logout$/, endOrderSession],
	['GET', /^\/api\/orders$/, listMyOrders],
	['GET', /^\/api\/admin\/me$/, adminMe],
	['GET', /^\/api\/admin\/orders$/, adminListOrders],
	['GET', /^\/api\/admin\/orders\.csv$/, adminExportCsv],
	['GET', /^\/api\/admin\/orders\/(\d+)$/, adminGetOrder],
	['PATCH', /^\/api\/admin\/orders\/(\d+)$/, adminUpdateOrder],
	['POST', /^\/api\/admin\/orders\/(\d+)\/notes$/, adminAddNote],
	['POST', /^\/api\/admin\/customers\/email$/, adminChangeEmail],
];

export default {
	async fetch(request, env, ctx) {
		const gated = await comingSoon(request, env);
		if (gated) return gated;

		const url = new URL(request.url);
		if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

		const allowed = [];
		for (const [method, pattern, handler, options = {}] of routes) {
			const match = url.pathname.match(pattern);
			if (!match) continue;
			if (request.method !== method) {
				allowed.push(method);
				continue;
			}
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
		if (allowed.length) return json({ error: 'Method not allowed' }, 405, { Allow: allowed.join(', ') });
		return json({ error: 'Not found' }, 404);
	},
};
