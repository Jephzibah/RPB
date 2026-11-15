import { HttpError, json, isSameOrigin } from './lib/http.js';
import { handleContact } from './lib/contact.js';
import { createStripeCheckout, handleStripeWebhook } from './lib/stripe.js';
import { createPayPalOrder, capturePayPalOrder } from './lib/paypal.js';
import { comingSoon } from './lib/coming-soon.js';
import { login, createOrderSession, listMyOrders, endOrderSession, postCustomerMessage } from './lib/orders.js';
import { adminMe, adminListOrders, adminGetOrder, adminUpdateOrder, adminAddNote, adminPostMessage, adminEditCustomer, adminExportCsv, adminListCustomers, adminChangeCustomerEmail } from './lib/admin.js';
import { adminListUsers, adminAddUser, adminRemoveUser } from './lib/admin-users.js';
import { adminReportError } from './lib/admin-report.js';

// Only /api/* reaches this code (wrangler.jsonc `run_worker_first`), or every request while site.comingSoon is on. Routes: [method, path pattern, handler, options]
const routes = [
	['POST', /^\/api\/contact$/, handleContact],
	['POST', /^\/api\/checkout\/stripe$/, createStripeCheckout],
	['POST', /^\/api\/webhooks\/stripe$/, handleStripeWebhook, { crossOrigin: true }],
	['POST', /^\/api\/paypal\/orders$/, createPayPalOrder],
	['POST', /^\/api\/paypal\/orders\/([A-Z0-9]+)\/capture$/, capturePayPalOrder],
	['POST', /^\/api\/login$/, login],
	['POST', /^\/api\/orders\/session$/, createOrderSession],
	['POST', /^\/api\/orders\/logout$/, endOrderSession],
	['GET', /^\/api\/orders$/, listMyOrders],
	['POST', /^\/api\/orders\/(\d+)\/messages$/, postCustomerMessage],
	['GET', /^\/api\/admin\/me$/, adminMe],
	['GET', /^\/api\/admin\/orders$/, adminListOrders],
	['GET', /^\/api\/admin\/orders\.csv$/, adminExportCsv],
	['GET', /^\/api\/admin\/orders\/(\d+)$/, adminGetOrder],
	['PATCH', /^\/api\/admin\/orders\/(\d+)$/, adminUpdateOrder],
	['POST', /^\/api\/admin\/orders\/(\d+)\/notes$/, adminAddNote],
	['POST', /^\/api\/admin\/orders\/(\d+)\/messages$/, adminPostMessage],
	['PATCH', /^\/api\/admin\/orders\/(\d+)\/customer$/, adminEditCustomer],
	['GET', /^\/api\/admin\/customers$/, adminListCustomers],
	['POST', /^\/api\/admin\/customers\/email$/, adminChangeCustomerEmail],
	['GET', /^\/api\/admin\/users$/, adminListUsers],
	['POST', /^\/api\/admin\/users$/, adminAddUser],
	['DELETE', /^\/api\/admin\/users$/, adminRemoveUser],
	['POST', /^\/api\/admin\/report$/, adminReportError],
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
				const known = error instanceof HttpError;
				if (known && error.status < 500) return json({ error: error.message }, error.status);
				const id = crypto.randomUUID().slice(0, 8);
				console.error(`[${id}] ${method} ${url.pathname} failed`, error);
				const status = known ? error.status : 500;
				const body = { error: known ? error.message : 'Something went wrong. Please try again.', errorId: id };
				// Admin routes are behind Cloudflare Access, so the real cause can be shown (and reported) there
				if (url.pathname.startsWith('/api/admin/')) {
					body.detail = {
						id,
						time: new Date().toISOString(),
						request: `${method} ${url.pathname}${url.search}`,
						status,
						cause: (known && error.internal) || String(error?.message || error),
						stack: known ? undefined : String(error?.stack || '').split('\n').slice(0, 6).join('\n'),
					};
				}
				return json(body, status);
			}
		}
		if (allowed.length) return json({ error: 'Method not allowed' }, 405, { Allow: allowed.join(', ') });
		return json({ error: 'Not found' }, 404);
	},
};
