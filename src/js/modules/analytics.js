import { loadScript, meta } from './util.js';

export default function initAnalytics() {
	const id = meta('gtm-id');
	if (!id) return;
	// GTM requires the global dataLayer; this is the standard container snippet without the inline <script>
	window.dataLayer = window.dataLayer || [];
	window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
	loadScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`);
}
