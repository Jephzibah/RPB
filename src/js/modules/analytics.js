import { loadScript, meta } from './util.js';

// GA4 only loads when site.config.js sets analytics.ga4 (Cloudflare Web Analytics is the cookieless default).
export default function initAnalytics() {
	const id = meta('ga4-id');
	if (!id) return;
	window.dataLayer = window.dataLayer || [];
	window.gtag = function gtag() {
		window.dataLayer.push(arguments);
	};
	window.gtag('js', new Date());
	window.gtag('config', id);
	loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
}
