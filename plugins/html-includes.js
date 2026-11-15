import fs from 'node:fs';
import path from 'node:path';

/**
 * Build-time HTML partials (replaces the old runtime fetch('header.html') pattern).
 *
 *   <include src="partials/head.html" title="About" description="…"></include>
 *   <include src="partials/header.html" />
 *
 * Inside any page or partial:
 *   {{ title }}                      attribute passed to the include (or set on a parent include)
 *   {{ description || site.description }}   first truthy value wins; '…' literals allowed
 *   {{ site.name }} {{ page.url }} {{ page.path }} {{ year }} {{ nav }}
 *   <if feature="shop">…</if>        kept only when site.features.shop is true
 *   <if set="site.analytics.ga4">…</if>  kept only when the value is truthy
 *   <if not="hideHeader">…</if>      kept only when the value is falsy
 *   <each in="catalog.products" as="product">{{ product.name }}</each>   repeat per item (not nestable)
 *
 * Extra template data (e.g. the product catalog) is passed in via the `data` option.
 *
 * Runs as a `pre` transform so Vite still processes asset URLs inside partials.
 */
export default function htmlIncludes({ site, data = {}, partialsDir = 'partials' } = {}) {
	let root;

	const lookup = (expr, vars) => {
		for (const part of expr.split('||').map((s) => s.trim())) {
			const literal = part.match(/^'(.*)'$/);
			if (literal) return literal[1];
			const value = part.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), vars);
			if (value !== undefined && value !== null && value !== '' && value !== false) return value;
		}
		return '';
	};

	const parseAttrs = (str) => {
		const attrs = {};
		for (const [, key, value] of str.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[key] = value;
		return attrs;
	};

	const featureOn = (name) => {
		const flags = site.features || {};
		if (!flags[name]) return false;
		// stripe/paypal implicitly depend on shop
		if ((name === 'stripe' || name === 'paypal') && !flags.shop) return false;
		return true;
	};

	const renderNav = (currentPath) =>
		(site.nav || [])
			.filter((item) => !item.feature || featureOn(item.feature))
			.map((item) => {
				const current = item.href === currentPath ? ' aria-current="page"' : '';
				return `<li><a href="${item.href}"${current}>${item.label}</a></li>`;
			})
			.join('\n');

	const processIfs = (html, vars) => {
		const re = /<if\s+([^>]*)>((?:(?!<if[\s>])[\s\S])*?)<\/if>/g;
		let prev;
		do {
			prev = html;
			html = html.replace(re, (_, attrStr, body) => {
				const a = parseAttrs(attrStr);
				let keep = true;
				if (a.feature) keep &&= featureOn(a.feature);
				if (a.set) keep &&= Boolean(lookup(a.set, vars));
				if (a.not) keep &&= !lookup(a.not, vars);
				return keep ? body : '';
			});
		} while (html !== prev);
		return html;
	};

	const processEach = (html, vars, file, depth) =>
		html.replace(/<each\s+([^>]*)>([\s\S]*?)<\/each>/g, (_, attrStr, body) => {
			const { in: listPath, as = 'item' } = parseAttrs(attrStr);
			const list = lookup(listPath, vars);
			if (!Array.isArray(list)) throw new Error(`[html-includes] <each in="${listPath}"> is not an array (${file})`);
			return list.map((item, index) => render(body, { ...vars, [as]: item, index }, file, depth + 1)).join('');
		});

	const render = (html, vars, file, depth = 0) => {
		if (depth > 10) throw new Error(`[html-includes] include depth > 10 in ${file} (circular include?)`);
		html = processEach(html, vars, file, depth);
		html = processIfs(html, vars);
		html = html.replace(/<include\s+([^>]*?)\s*(?:\/>|>\s*<\/include>)/g, (_, attrStr) => {
			const attrs = parseAttrs(attrStr);
			if (!attrs.src) throw new Error(`[html-includes] <include> without src in ${file}`);
			const partialPath = path.resolve(root, attrs.src);
			if (!fs.existsSync(partialPath)) throw new Error(`[html-includes] ${attrs.src} not found (included from ${file})`);
			const { src, ...rest } = attrs;
			// Partials' <!-- doc comments --> are for developers, not the shipped HTML
			const partial = fs.readFileSync(partialPath, 'utf8').replace(/<!--(?!\[if)[\s\S]*?-->\s*/g, '');
			return render(partial, { ...vars, ...rest }, src, depth + 1);
		});
		return html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => String(lookup(expr, vars)));
	};

	const pagePathFor = (filename) => {
		const name = path.relative(root, filename).replace(/\\/g, '/').replace(/\.html$/, '');
		if (name === 'index') return '/';
		return '/' + name.replace(/\/index$/, '/');
	};

	const hardenExternalLinks = (html) => {
		const ownHost = new URL(site.url).host;
		return html.replace(/<a\s([^>]*?)>/g, (tag, attrStr) => {
			const href = attrStr.match(/href="(https?:\/\/[^"]+)"/)?.[1];
			if (!href || new URL(href).host === ownHost) return tag;
			if (!/target="_blank"/.test(attrStr) || /\brel=/.test(attrStr)) return tag;
			return `<a ${attrStr} rel="noopener noreferrer">`;
		});
	};

	// Vite adds `base` to asset URLs; page links (<a href="/about">, form actions) are ours to prefix
	const withBase = (html) => {
		const base = site.base || '/';
		if (base === '/') return html;
		return html.replace(/(<(?:a|form)\s[^>]*?\b(?:href|action)=")\/(?!\/)/g, `$1${base}`);
	};

	return {
		name: 'html-includes',

		configResolved(config) {
			root = config.root;
		},

		// Dev only: serve /about as /about.html to match Cloudflare's clean URLs in production.
		configureServer(server) {
			server.middlewares.use((req, _res, next) => {
				const [pathname, query] = req.url.split('?');
				if (pathname !== '/' && !path.extname(pathname)) {
					const candidate = pathname.replace(/\/$/, '') + '.html';
					if (fs.existsSync(path.join(root, candidate))) req.url = candidate + (query ? `?${query}` : '');
				}
				next();
			});
		},

		handleHotUpdate({ file, server }) {
			if (file.startsWith(path.join(root, partialsDir))) {
				server.ws.send({ type: 'full-reload' });
				return [];
			}
		},

		transformIndexHtml: {
			order: 'pre',
			handler(html, ctx) {
				const pagePath = pagePathFor(ctx.filename);
				const vars = {
					...data,
					site,
					year: new Date().getFullYear(),
					nav: renderNav(pagePath),
					page: { path: pagePath, url: site.url + pagePath },
				};
				return withBase(hardenExternalLinks(render(html, vars, path.basename(ctx.filename))));
			},
		},
	};
}
