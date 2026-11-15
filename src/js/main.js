import '@scss/style.scss';

import initNav from './modules/nav.js';
import initReveal from './modules/reveal.js';
import initAnalytics from './modules/analytics.js';

initNav();
initReveal();
initAnalytics();

const lazyModules = {
	'[data-carousel]': () => import('./modules/carousel.js'),
	'#contact-form': () => import('./modules/contact-form.js'),
	'[data-cart-count], [data-add-to-cart], [data-cart]': () => import('./modules/cart.js'),
	'[data-orders], [data-orders-verify], [data-login]': () => import('./modules/orders.js'),
	'[data-admin]': () => import('./modules/admin.js'),
	'[data-admin-customers]': () => import('./modules/admin-customers.js'),
	'[data-admin-users]': () => import('./modules/admin-users.js'),
};

for (const [selector, load] of Object.entries(lazyModules)) {
	if (document.querySelector(selector)) {
		load()
			.then((module) => module.default())
			.catch((error) => console.error(`Failed to load module for ${selector}`, error));
	}
}
