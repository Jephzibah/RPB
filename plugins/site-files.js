export function buildCsp(site, { meta = false } = {}) {
	const f = site.features || {};
	const shop = Boolean(f.shop);
	const on = {
		contact: Boolean(f.contact),
		stripe: shop && Boolean(f.stripe),
		paypal: shop && Boolean(f.paypal),
		cfAnalytics: Boolean(site.analytics?.cloudflareToken),
		gtm: Boolean(site.analytics?.gtm),
	};

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
		// Browsers ignore frame-ancestors in a <meta> CSP (and log an error), so it's header-only
		...(!meta && { 'frame-ancestors': ["'none'"] }),
	};
	const add = (dir, ...origins) => src[dir].push(...origins);

	// Turnstile guards the contact form and the shop's order-lookup form
	if (on.contact || shop) {
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
	if (on.gtm) {
		// GTM itself plus GA4, the tag almost every container loads. Other tags in the container need `site.csp` entries.
		add('script-src', 'https://www.googletagmanager.com');
		add('connect-src', 'https://www.googletagmanager.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com');
		add('img-src', 'https://www.googletagmanager.com', 'https://*.google-analytics.com');
	}
	for (const [key, origins] of Object.entries(site.csp || {})) add(`${key}-src`, ...origins);

	return Object.entries(src)
		.filter(([, values]) => values.length)
		.map(([dir, values]) => `${dir} ${[...new Set(values)].join(' ')}`)
		.concat('upgrade-insecure-requests')
		.join('; ');
}

export default function siteFiles({ site }) {
	const headers = () => `/*
  Content-Security-Policy: ${buildCsp(site)}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()

${site.base}assets/*
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
					const url = name === 'index' ? '/' : '/' + name.replace(/\/index$/, '/');
					return site.hosting === 'static' && !url.endsWith('/') ? `${url}.html` : url;
				})
				.sort();

			const sitemap =
				'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
				pages.map((p) => `  <url><loc>${site.rootUrl}${p}</loc></url>`).join('\n') +
				'\n</urlset>\n';

			this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
			this.emitFile({ type: 'asset', fileName: 'robots.txt', source: site.comingSoon ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: ${site.base}admin\nDisallow: ${site.base}orders\n\nSitemap: ${site.rootUrl}/sitemap.xml\n` });
			if (site.hosting === 'cloudflare') this.emitFile({ type: 'asset', fileName: '_headers', source: headers() });
			// Without this, GitHub Pages runs the output through Jekyll, which drops files starting with "_"
			if (site.hosting === 'github-pages') this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
		} },
	};
}
