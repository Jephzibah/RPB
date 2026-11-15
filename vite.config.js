import { defineConfig } from 'vite';
import { resolve } from 'path';
import { glob } from 'glob';
import { readFileSync } from 'fs';

import siteConfig from './site.config.js';
import resolveHosting from './plugins/hosting.js';
import htmlIncludes from './plugins/html-includes.js';
import responsiveImages from './plugins/images.js';
import icons from './plugins/icons.js';
import siteFiles, { buildCsp } from './plugins/site-files.js';
import prodBranch from './plugins/prod-branch.js';

const site = resolveHosting(siteConfig);
// Cloudflare sends the CSP as a header (_headers); other hosts can only take it as a <meta> tag
if (site.hosting !== 'cloudflare') site.cspMeta = buildCsp(site, { meta: true });

// Product catalog: shared with the Worker (worker/lib/catalog.js), which is the price authority.
const catalog = JSON.parse(readFileSync(new URL('./catalog/products.json', import.meta.url), 'utf8'));
const money = new Intl.NumberFormat(site.lang, { style: 'currency', currency: catalog.currency.toUpperCase() });
catalog.products = catalog.products
	.filter((p) => p.active !== false)
	.map((p) => ({ ...p, priceDisplay: money.format(p.price / 100) }));
// One-item lists so a product page can render a single product with <each in="catalog.single.<id>" as="product">
catalog.single = Object.fromEntries(catalog.products.map((p) => [p.id, [p]]));

export function pageEntries() {
	return glob.sync('**/*.html', { cwd: './src', ignore: ['**/_*.html', 'partials/**', 'public/**'] }).reduce((entries, path) => {
		const name = path.replace(/\\/g, '/').replace(/\.html$/, '');
		entries[name] = resolve(import.meta.dirname, 'src', path);
		return entries;
	}, {});
}

export default defineConfig({
	root: './src',
	base: site.base, // prefixes built asset URLs; html-includes prefixes page links
	publicDir: 'public',

	plugins: [
		htmlIncludes({ site, data: { catalog } }),
		icons(),
		responsiveImages(),
		siteFiles({ site }),
		prodBranch(), // snapshots dist/ to the `prod` branch after each build
	],

	server: {
		port: 3000,
		open: true,
		// /api/* is served by the Worker (`wrangler dev`), see `npm run dev`
		proxy: { '/api': 'http://localhost:8787' },
	},

	css: {
		devSourcemap: true,
		postcss: './postcss.config.js',
		preprocessorOptions: {
			scss: { quietDeps: true, api: 'modern' },
		},
	},

	build: {
		outDir: '../dist',
		emptyOutDir: true,
		sourcemap: false,
		assetsDir: 'assets',
		assetsInlineLimit: 0, // never base64 images into HTML/CSS (bloats every page, defeats caching)
		rollupOptions: { input: pageEntries() },
	},

	resolve: {
		alias: {
			'@scss': resolve(import.meta.dirname, 'src/scss'),
			'@js': resolve(import.meta.dirname, 'src/js'),
		},
	},
});
