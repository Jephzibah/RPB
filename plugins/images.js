import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const WIDTHS = [480, 960, 1440, 1920];
const MAX_WIDTH = 2400;
const SUPPORTED = /\.(jpe?g|png|webp|avif|tiff?)$/i;

export default function responsiveImages({ quality = { avif: 55, webp: 78 } } = {}) {
	let root;
	let genDir;

	const generate = async (srcFile, base, width, format) => {
		const out = path.join(genDir, `${base}-${width}.${format}`);
		if (existsSync(out) && statSync(out).mtimeMs >= statSync(srcFile).mtimeMs) return;
		await sharp(srcFile)
			.rotate()
			.resize({ width, withoutEnlargement: true })
			[format]({ quality: quality[format] })
			.toFile(out);
	};

	const processImg = async (tag, attrStr) => {
		if (/\bdata-no-optimize\b/.test(attrStr)) return tag.replace(/\s*data-no-optimize\b/, '');
		const src = attrStr.match(/\bsrc="([^"]+)"/)?.[1];
		if (!src || /^(https?:)?\/\//.test(src) || !SUPPORTED.test(src)) return tag;

		const srcFile = path.join(root, decodeURI(src));
		if (!existsSync(srcFile)) throw new Error(`[images] ${src} not found`);

		const meta = await sharp(srcFile).metadata();
		const origW = Math.min(meta.width, MAX_WIDTH);
		const origH = Math.round(meta.height * (origW / meta.width));
		const widths = [...new Set([...WIDTHS.filter((w) => w < origW), origW])];
		const base = path
			.basename(src, path.extname(src))
			.normalize('NFKD')
			.replace(/[^\w-]+/g, '-')
			.replace(/-+/g, '-')
			.toLowerCase();

		await Promise.all(widths.flatMap((w) => [generate(srcFile, base, w, 'avif'), generate(srcFile, base, w, 'webp')]));

		const url = (w, f) => `/assets/generated/${base}-${w}.${f}`;
		const srcset = (f) => widths.map((w) => `${url(w, f)} ${w}w`).join(', ');
		const fallbackW = widths.find((w) => w >= 960) ?? origW;
		const sizes = attrStr.match(/\bsizes="([^"]+)"/)?.[1] ?? '100vw';
		const eager = /\bdata-eager\b/.test(attrStr);

		const kept = attrStr
			.replace(/\s*\b(src|srcset|sizes|width|height|loading|decoding|fetchpriority)="[^"]*"/g, '')
			.replace(/\s*\bdata-eager\b/, '')
			.replace(/\s*\/$/, '')
			.trim();
		const loading = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';

		return (
			`<picture><source type="image/avif" srcset="${srcset('avif')}" sizes="${sizes}">` +
			`<img src="${url(fallbackW, 'webp')}" srcset="${srcset('webp')}" sizes="${sizes}" ` +
			`width="${origW}" height="${origH}" ${kept} ${loading} decoding="async"></picture>`
		);
	};

	return {
		name: 'responsive-images',

		async configResolved(config) {
			root = config.root;
			genDir = path.join(root, 'assets/generated');
			await fs.mkdir(genDir, { recursive: true });
		},

		transformIndexHtml: {
			order: 'pre',
			async handler(html) {
				const tags = [...html.matchAll(/<img\s([^>]*?)\/?>/g)];
				const replacements = await Promise.all(tags.map(([tag, attrStr]) => processImg(tag, attrStr)));
				let i = 0;
				return html.replace(/<img\s([^>]*?)\/?>/g, () => replacements[i++]);
			},
		},
	};
}
