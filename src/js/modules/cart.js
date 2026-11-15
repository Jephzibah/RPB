import { loadScript, meta } from './util.js';

// The Worker re-prices every item from catalog/products.json, so editing localStorage cannot change what is charged.
const KEY = 'cart:v1';
const currency = (meta('shop-currency') || 'usd').toUpperCase();
const money = new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency });

const read = () => {
	try {
		const items = JSON.parse(localStorage.getItem(KEY));
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
};
const write = (items) => {
	try {
		localStorage.setItem(KEY, JSON.stringify(items));
	} catch {
		/* private mode / storage full: cart just won't persist */
	}
	render();
};
const payload = () => ({ items: read().map(({ id, qty }) => ({ id, qty })) });
const announce = (message) => {
	const region = document.querySelector('[data-cart-announcer]');
	if (region) region.textContent = message;
};

export default function initCart() {
	if (new URLSearchParams(location.search).get('checkout') === 'success') write([]);

	document.addEventListener('click', (event) => {
		const add = event.target.closest('[data-add-to-cart]');
		if (add) {
			const { addToCart: id, name, price } = add.dataset;
			const items = read();
			const line = items.find((item) => item.id === id);
			if (line) line.qty = Math.min(line.qty + 1, 99);
			else items.push({ id, name, price: Number(price), qty: 1 });
			write(items);
			announce(`${name} added to cart.`);
		}

		const remove = event.target.closest('[data-remove]');
		if (remove) write(read().filter((item) => item.id !== remove.dataset.remove));

		if (event.target.closest('[data-checkout="stripe"]')) checkoutStripe(event.target.closest('button'));
	});

	document.addEventListener('change', (event) => {
		const input = event.target.closest('[data-qty]');
		if (!input) return;
		const qty = Math.max(1, Math.min(99, Number.parseInt(input.value, 10) || 1));
		write(read().map((item) => (item.id === input.dataset.qty ? { ...item, qty } : item)));
	});

	window.addEventListener('storage', (event) => event.key === KEY && render());
	render();
	initPayPal();
}

function render() {
	const items = read();
	const count = items.reduce((sum, item) => sum + item.qty, 0);
	document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = count));

	const cart = document.querySelector('[data-cart]');
	if (!cart) return;

	const empty = items.length === 0;
	cart.querySelector('[data-cart-empty]').hidden = !empty;
	cart.querySelector('[data-cart-table]').hidden = empty;
	cart.querySelector('[data-cart-checkout]').hidden = empty;

	const tbody = cart.querySelector('[data-cart-lines]');
	tbody.replaceChildren(
		...items.map((item) => {
			const row = document.createElement('tr');
			const name = document.createElement('td');
			name.textContent = item.name;
			const qty = document.createElement('td');
			const input = Object.assign(document.createElement('input'), { type: 'number', min: 1, max: 99, value: item.qty });
			input.dataset.qty = item.id;
			input.setAttribute('aria-label', `Quantity of ${item.name}`);
			qty.append(input);
			const price = document.createElement('td');
			price.textContent = money.format((item.price * item.qty) / 100);
			const actions = document.createElement('td');
			const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'cart__remove', textContent: 'Remove' });
			remove.dataset.remove = item.id;
			remove.setAttribute('aria-label', `Remove ${item.name}`);
			actions.append(remove);
			row.append(name, qty, price, actions);
			return row;
		}),
	);
	cart.querySelector('[data-cart-total]').textContent = money.format(items.reduce((sum, i) => sum + i.price * i.qty, 0) / 100);
}

function setCheckoutStatus(message) {
	const status = document.querySelector('[data-checkout-status]');
	if (status) {
		status.textContent = message;
		status.dataset.state = message ? 'error' : '';
	}
}

async function checkoutStripe(button) {
	button.disabled = true;
	setCheckoutStatus('');
	try {
		const response = await fetch('/api/checkout/stripe', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify(payload()),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok || !data.url) throw new Error(data.error || 'Checkout is unavailable right now.');
		location.assign(data.url);
	} catch (error) {
		setCheckoutStatus(error.message);
		button.disabled = false;
	}
}

async function initPayPal() {
	const container = document.querySelector('[data-paypal-buttons]');
	const clientId = meta('paypal-client-id');
	if (!container || !clientId) return;

	const params = new URLSearchParams({ 'client-id': clientId, currency, intent: 'capture' });
	try {
		await loadScript(`https://www.paypal.com/sdk/js?${params}`);
	} catch {
		return setCheckoutStatus('PayPal failed to load.');
	}

	window.paypal
		.Buttons({
			style: { layout: 'vertical', label: 'paypal' },
			createOrder: async () => {
				const response = await fetch('/api/paypal/orders', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
					body: JSON.stringify(payload()),
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Could not start PayPal checkout.');
				return data.id;
			},
			onApprove: async ({ orderID }) => {
				const response = await fetch(`/api/paypal/orders/${encodeURIComponent(orderID)}/capture`, {
					method: 'POST',
					headers: { Accept: 'application/json' },
				});
				const data = await response.json();
				if (!response.ok || data.status !== 'COMPLETED') throw new Error(data.error || 'Payment was not completed.');
				location.assign('/thanks?checkout=success');
			},
			onError: (error) => setCheckoutStatus(error.message || 'PayPal checkout failed.'),
		})
		.render(container);
}
