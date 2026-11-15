const loaded = new Map();

/** Inject a third-party <script> once; resolves when it has loaded. */
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
