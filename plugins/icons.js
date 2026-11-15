import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Font Awesome Free icons are CC BY 4.0: keep the "Icons by Font Awesome" credit (site.config.js `iconCredit`).
const STYLES = { 'fa-brands': 'brands', 'fa-solid': 'solid', 'fa-regular': 'regular', fab: 'brands', fas: 'solid', far: 'regular' };

export default function icons() {
	const require = createRequire(import.meta.url);
	const svgRoot = path.join(path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json')), 'svgs');
	const cache = new Map();

	const loadSvg = (style, name) => {
		const key = `${style}/${name}`;
		if (!cache.has(key)) {
			const file = path.join(svgRoot, style, `${name}.svg`);
			if (!fs.existsSync(file)) throw new Error(`[icons] Font Awesome icon "${key}" not found (check the name on fontawesome.com/icons)`);
			const svg = fs
				.readFileSync(file, 'utf8')
				.replace(/<!--[\s\S]*?-->/g, '')
				.replace('<svg ', `<svg class="fa-svg" data-fa="${key}" focusable="false" aria-hidden="true" `);
			cache.set(key, svg);
		}
		return cache.get(key);
	};

	return {
		name: 'fa-icons',
		transformIndexHtml: {
			order: 'pre',
			handler(html) {
				return html.replace(/<i\s([^>]*class="([^"]*)"[^>]*)>\s*<\/i>/g, (tag, attrStr, classes) => {
					const list = classes.split(/\s+/);
					const style = list.map((c) => STYLES[c]).find(Boolean);
					const name = list.find((c) => c.startsWith('fa-') && !STYLES[c] && !/^fa-(fw|lg|xs|sm|[0-9]+x|spin|pulse|beat|fade|flip|shake|bounce|rotate-.*|border|inverse|stack.*)$/.test(c));
					if (!style || !name) return tag;

					const label = attrStr.match(/\b(?:aria-label|data-tooltip|title)="([^"]+)"/)?.[1];
					const a11y = label
						? (/\baria-label=/.test(attrStr) ? '' : ` aria-label="${label}"`) + (/\brole=/.test(attrStr) ? '' : ' role="img"')
						: /\baria-hidden=/.test(attrStr) ? '' : ' aria-hidden="true"';
					return `<i ${attrStr}${a11y}>${loadSvg(style, name.slice(3))}</i>`;
				});
			},
		},
	};
}
