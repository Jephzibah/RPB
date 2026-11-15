// Single source of truth for per-site settings.
// Everything here is PUBLIC (it ends up in HTML). Secrets go in `wrangler secret put` / .dev.vars.
export default {
	name: 'Site Name',
	url: 'https://example.com', // production origin, no trailing slash
	base: '/', // path the site is served from: '/' at a domain root, '/<repo>/' on GitHub Pages project sites
	lang: 'en',
	description: 'Default meta description used when a page does not set its own.',
	ogImage: '/og-image.jpg', // lives in src/public, made absolute at build time
	twitterHandle: '', // e.g. '@handle'
	themeColor: '#13144a',
	iconCredit: true, // Font Awesome Free (CC BY 4.0) credit in the footer; set false if no icons are used

	nav: [
		{ label: 'Home', href: '/' },
		{ label: 'About', href: '/about' },
		{ label: 'Shop', href: '/shop', feature: 'shop' },
		{ label: 'Contact', href: '/contact', feature: 'contact' },
	],

	// Feature switches. Turning one off removes its nav links, <if> blocks and CSP allowances.
	features: {
		contact: true, // /api/contact + Cloudflare Turnstile
		shop: true, // cart + checkout endpoints
		stripe: true, // requires features.shop
		paypal: true, // requires features.shop
	},

	analytics: {
		cloudflareToken: '', // Cloudflare Web Analytics (cookieless). Preferred.
		ga4: '', // 'G-XXXXXXX' – only if the client insists; needs a consent banner in the EU/UK.
	},

	turnstile: {
		// Cloudflare test key (always passes). Replace with the real site key per domain.
		siteKey: '1x00000000000000000000AA',
	},

	paypal: {
		clientId: 'sb', // public client id; 'sb' = PayPal sandbox placeholder. Currency comes from catalog/products.json
	},
};
