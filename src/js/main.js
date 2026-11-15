import '@scss/style.scss';

import initNav from './modules/nav.js';
import initReveal from './modules/reveal.js';
import initAnalytics from './modules/analytics.js';

// Small, used on (nearly) every page
initNav();
initReveal();
initAnalytics();

// Everything else is code-split and only downloaded on pages that contain the matching element.
// A brochure page with no form, carousel or shop ships none of that code.
const lazyModules = {
	'[data-carousel]': () => import('./modules/carousel.js'),
	'#contact-form': () => import('./modules/contact-form.js'),
	'[data-cart-count], [data-add-to-cart], [data-cart]': () => import('./modules/cart.js'),
};

for (const [selector, load] of Object.entries(lazyModules)) {
	if (document.querySelector(selector)) {
		load()
			.then((module) => module.default())
			.catch((error) => console.error(`Failed to load module for ${selector}`, error));
	}
}
