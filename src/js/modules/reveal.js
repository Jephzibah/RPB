import { prefersReducedMotion } from './util.js';

const STAGGER_MS = 350;

/**
 * Fade/slide in [data-reveal] elements and images in <main> as they scroll into view.
 * data-reveal="left" | "right" slides horizontally (replaces the old scroll-position math).
 * Only elements starting below the fold are hidden, so nothing visible ever flashes.
 */
export default function initReveal() {
	if (prefersReducedMotion() || !('IntersectionObserver' in window)) return;

	// Skip images that sit inside an element that is already revealed as a whole
	const targets = [...document.querySelectorAll('[data-reveal], main img')].filter(
		(el) => el.matches('[data-reveal]') || !el.closest('[data-reveal]'),
	);
	const belowFold = targets.filter((el) => el.getBoundingClientRect().top > window.innerHeight);
	if (!belowFold.length) return;

	const observer = new IntersectionObserver(
		(entries) => {
			entries
				.filter((entry) => entry.isIntersecting)
				.forEach((entry, i) => {
					observer.unobserve(entry.target);
					setTimeout(() => entry.target.classList.add('is-visible'), i * STAGGER_MS);
				});
		},
		{ threshold: 0.15, rootMargin: '0px 0px -5% 0px' },
	);

	belowFold.forEach((el) => {
		el.classList.add('reveal');
		observer.observe(el);
	});
}
