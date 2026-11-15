import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const TARGETS = ['cloudflare', 'github-pages', 'static'];
const WORKER_FEATURES = ['contact', 'shop', 'stripe', 'paypal'];

const githubPagesBase = () => {
	if (existsSync(new URL('../src/public/CNAME', import.meta.url))) return '/';
	let remote;
	try {
		remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: 'pipe' }).trim();
	} catch {
		throw new Error('[hosting] github-pages needs a git "origin" remote to work out the base path. Set `base` in site.config.js instead.');
	}
	const repo = remote.replace(/\.git$/, '').split(/[/:]/).pop();
	return repo.endsWith('.github.io') ? '/' : `/${repo}/`;
};

export default function resolveHosting(site) {
	const hosting = site.hosting || 'cloudflare';
	if (!TARGETS.includes(hosting)) throw new Error(`[hosting] Unknown hosting "${hosting}". Use one of: ${TARGETS.join(', ')}.`);

	let base = site.base || (hosting === 'github-pages' ? githubPagesBase() : '/');
	base = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

	const features = { ...site.features };
	if (hosting !== 'cloudflare') {
		const disabled = WORKER_FEATURES.filter((name) => features[name]);
		for (const name of disabled) features[name] = false;
		if (disabled.length) console.warn(`[hosting] ${hosting}: no Worker to run /api, so these features are off: ${disabled.join(', ')}`);
	}

	if (site.comingSoon && hosting !== 'cloudflare') console.warn(`[hosting] ${hosting}: comingSoon needs the Worker, so the site is NOT password protected here.`);

	return {
		...site,
		hosting,
		base,
		features,
		rootUrl: site.url.replace(/\/+$/, '') + base.replace(/\/$/, ''),
	};
}
