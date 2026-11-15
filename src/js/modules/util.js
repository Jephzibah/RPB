const loaded = new Map();

export function loadScript(src, attrs = {}) {
	if (!loaded.has(src)) {
		loaded.set(
			src,
			new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = src;
				script.async = true;
				Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
				script.onload = resolve;
				script.onerror = () => reject(new Error(`Failed to load ${src}`));
				document.head.append(script);
			}),
		);
	}
	return loaded.get(src);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';

export const formatMoney = (cents, currency) =>
	new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	Object.entries(attrs).forEach(([key, value]) => (key === 'class' ? (node.className = value) : node.setAttribute(key, value)));
	node.append(...children.filter((child) => child !== null && child !== undefined));
	return node;
}

export async function fetchJson(path, options = {}) {
	const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...options.headers } });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status });
	return data;
}
