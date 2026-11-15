/**
 * Emits sitemap.xml, robots.txt and Cloudflare's _headers file into dist/.
 * The CSP is generated from site.config.js `features`/`analytics`, so enabling a
 * feature automatically allows exactly the third-party origins it needs.
 * Add per-site origins with `site.csp = { script: [], connect: [], frame: [], img: [] }`.
 */
export default function siteFiles({ site }) {
	const f = site.features || {};
	const shop = Boolean(f.shop);
	const on = {
		contact: Boolean(f.contact),
		stripe: shop && Boolean(f.stripe),
		paypal: shop && Boolean(f.paypal),
		cfAnalytics: Boolean(site.analytics?.cloudflareToken),
		ga4: Boolean(site.analytics?.ga4),
	};

	const buildCsp = () => {
		const extra = site.csp || {};
		const src = {
			'default-src': ["'self'"],
			'script-src': ["'self'"],
			'style-src': ["'self'", "'unsafe-inline'"], // Turnstile/PayPal inject inline styles
			'img-src': ["'self'", 'data:'],
			'font-src': ["'self'"],
			'connect-src': ["'self'"],
			'frame-src': [],
			'form-action': ["'self'"],
			'base-uri': ["'self'"],
			'object-src': ["'none'"],
			'frame-ancestors': ["'none'"],
		};
		const add = (dir, ...origins) => src[dir].push(...origins);

		if (on.contact) {
			add('script-src', 'https://challenges.cloudflare.com');
			add('frame-src', 'https://challenges.cloudflare.com');
		}
		if (on.stripe) {
			// Hosted Checkout is a redirect; js.stripe.com is only for Buy Buttons / pricing tables
			add('script-src', 'https://js.stripe.com');
			add('frame-src', 'https://js.stripe.com', 'https://buy.stripe.com');
			add('img-src', 'https://*.stripe.com');
		}
		if (on.paypal) {
			add('script-src', 'https://www.paypal.com', 'https://*.paypal.com', 'https://www.paypalobjects.com');
			add('frame-src', 'https://www.paypal.com', 'https://*.paypal.com');
			add('connect-src', 'https://www.paypal.com', 'https://*.paypal.com');
			add('img-src', 'https://*.paypal.com', 'https://www.paypalobjects.com');
		}
		if (on.cfAnalytics) {
			add('script-src', 'https://static.cloudflareinsights.com');
			add('connect-src', 'https://cloudflareinsights.com');
		}
		if (on.ga4) {
			add('script-src', 'https://www.googletagmanager.com');
			add('connect-src', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com');
			add('img-src', 'https://*.google-analytics.com', 'https://*.googletagmanager.com');
		}
		for (const [key, origins] of Object.entries(extra)) add(`${key}-src`, ...origins);

		return Object.entries(src)
			.filter(([, values]) => values.length)
			.map(([dir, values]) => `${dir} ${[...new Set(values)].join(' ')}`)
			.concat('upgrade-insecure-requests')
			.join('; ');
	};

	const headers = () => `/*
  Content-Security-Policy: ${buildCsp()}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

	return {
		name: 'site-files',
		apply: 'build',

		// `post` so Vite's own HTML output is already in the bundle
		generateBundle: { order: 'post', handler(_, bundle) {
			const pages = Object.values(bundle)
				.filter((file) => file.fileName.endsWith('.html'))
				.filter((file) => !/^404\.html$/.test(file.fileName))
				.filter((file) => !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(String(file.source)))
				.map((file) => {
					const name = file.fileName.replace(/\.html$/, '');
					return name === 'index' ? '/' : '/' + name.replace(/\/index$/, '/');
				})
				.sort();

			const sitemap =
				'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
				pages.map((p) => `  <url><loc>${site.url}${p}</loc></url>`).join('\n') +
				'\n</urlset>\n';

			this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
			this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n` });
			this.emitFile({ type: 'asset', fileName: '_headers', source: headers() });
		} },
	};
}
