import { prefersReducedMotion } from './util.js';

export default function initCarousels() {
	document.querySelectorAll('[data-carousel]').forEach(setup);
}

function setup(root) {
	const slides = [...root.querySelectorAll('[data-slide]')];
	if (slides.length < 2) return;

	const interval = Number(root.dataset.interval) || 6000;
	const autoplay = !prefersReducedMotion();
	let index = 0;
	let timer;

	const dots = document.createElement('div');
	dots.className = 'carousel__dots';
	const buttons = slides.map((_, i) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'carousel__dot';
		button.setAttribute('aria-label', `Show item ${i + 1} of ${slides.length}`);
		button.addEventListener('click', () => show(i));
		dots.append(button);
		return button;
	});
	root.append(dots);

	function show(i) {
		index = i;
		slides.forEach((slide, n) => {
			const active = n === i;
			slide.classList.toggle('is-active', active);
			slide.setAttribute('aria-hidden', String(!active));
			slide.inert = !active;
		});
		buttons.forEach((button, n) => button.setAttribute('aria-current', String(n === i)));
	}
	const stop = () => clearInterval(timer);
	const start = () => {
		stop();
		if (autoplay) timer = setInterval(() => show((index + 1) % slides.length), interval);
	};

	root.addEventListener('mouseenter', stop);
	root.addEventListener('mouseleave', start);
	root.addEventListener('focusin', stop);
	root.addEventListener('focusout', start);
	document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

	root.toggleAttribute('data-enhanced', true);
	show(0);
	start();
}
