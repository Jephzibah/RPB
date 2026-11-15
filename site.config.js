// Everything here is PUBLIC (it ends up in HTML). Secrets go in `wrangler secret put` / .dev.vars.
export default {
	name: 'Rock Paper Branding',
	url: 'https://rockpaperbranding.com', // origin the site is served from, no path or trailing slash
	// 'cloudflare' | 'github-pages' | 'static'. Only Cloudflare runs the Worker, so contact & shop switch off elsewhere.
	hosting: 'cloudflare',
	base: '', // empty = automatic ('/<repo>/' on GitHub Pages, else '/'). Set '/' for a GitHub Pages custom domain.
	// Cloudflare only: every URL shows /coming-soon until the SITE_PASSWORD secret is entered. Crawlers are blocked.
	comingSoon: true,
	lang: 'en',
	description: 'Rock Paper Branding is a full-service brand & website design studio for small businesses.',
	ogImage: '/og-image.jpg',
	twitterHandle: '',
	themeColor: '#323232',
	iconCredit: false, // Font Awesome Free (CC BY 4.0) credit in the footer; set false if no icons are used

	nav: [
		{ label: 'Brand Design', href: '/brand-design' },
		{ label: 'About', href: '/about' },
		{ label: 'Shop', href: '/shop', feature: 'shop' },
		{ label: 'Contact', href: '/contact', feature: 'contact' },
	],

	features: {
		contact: true,
		shop: true,
		stripe: true, // requires features.shop
		paypal: false, // requires features.shop
	},

	analytics: {
		cloudflareToken: '',
		gtm: '', // 'GTM-XXXXXXX'. Needs a consent banner in the EU/UK; tags beyond GA4 need `csp` entries.
	},

	turnstile: {
		siteKey: '0x4AAAAAAGCF0PkXOZoI5jrg',
	},

	paypal: {
		clientId: 'sb', // public client id; 'sb' = PayPal sandbox placeholder. Currency comes from catalog/products.json
	},
};
