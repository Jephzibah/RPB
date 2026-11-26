import { prefersReducedMotion } from './util.js';

const STAGGER_MS = 120;
const LOAD_TIMEOUT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lazy images finish loading in any order; waiting for each keeps the fade-ins in page order
function loaded(el) {
	const images = el.matches('img') ? [el] : [...el.querySelectorAll('img')];
	const pending = images.filter((img) => !img.complete).map((img) => img.decode().catch(() => {}));
	return Promise.race([Promise.all(pending), sleep(LOAD_TIMEOUT_MS)]);
}

// Only elements starting below the fold are hidden, so nothing already visible ever flashes.
export default function initReveal() {
	if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;

	const targets = [...document.querySelectorAll('[data-reveal], main img')].filter(
		(el) => el.matches('[data-reveal]') || !el.closest('[data-reveal]'),
	);
	const belowFold = targets.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
	if (!belowFold.length) return;

	const order = new Map(belowFold.map((el, i) => [el, i]));
	// One queue across observer batches, so a fast scroll can't overtake items still waiting
	let queue = Promise.resolve();
	let lastShown = 0;
	const reveal = (el) => {
		const ready = loaded(el);
		queue = queue.then(async () => {
			await ready;
			await sleep(lastShown + STAGGER_MS - performance.now());
			el.classList.add('is-visible');
			lastShown = performance.now();
		});
	};

	const observer = new IntersectionObserver(
		(entries) => {
			entries
				.filter((entry) => entry.isIntersecting)
				.map((entry) => entry.target)
				.sort((a, b) => order.get(a) - order.get(b))
				.forEach((el) => {
					observer.unobserve(el);
					reveal(el);
				});
		},
		{ threshold: 0.15, rootMargin: '0px 0px -5% 0px' },
	);

	belowFold.forEach((el) => {
		el.classList.add('reveal');
		observer.observe(el);
	});
}
