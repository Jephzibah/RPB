import { el, fetchJson as api, formatDate, formatMoney, loadScript } from './util.js';

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

function renderOrder(order) {
	const items = el('ul', { class: 'orders__items' }, ...order.items.map((item) => el('li', {}, `${item.qty} × ${item.name}`)));
	return el(
		'li',
		{ class: 'orders__order' },
		el('h2', { class: 'orders__number' }, `Order #${order.number}`),
		el(
			'dl',
			{ class: 'orders__meta' },
			el('dt', {}, 'Placed'), el('dd', {}, formatDate(order.createdAt)),
			el('dt', {}, 'Status'), el('dd', {}, order.status),
			el('dt', {}, 'Total'), el('dd', {}, formatMoney(order.total, order.currency)),
			...(order.tracking ? [el('dt', {}, 'Tracking'), el('dd', {}, order.tracking)] : []),
		),
		items,
	);
}

function initLookup(root) {
	const form = root.querySelector('[data-orders-request]');
	const results = root.querySelector('[data-orders-results]');
	const status = root.querySelector('[data-orders-status]');
	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};

	const showForm = () => {
		form.hidden = false;
		loadScript(TURNSTILE_SRC).catch(() => setStatus('Spam protection failed to load. Please refresh the page.', 'error'));
	};

	api('/api/orders')
		.then(({ email, orders }) => {
			root.querySelector('[data-orders-email]').textContent = `Signed in as ${email}.`;
			root.querySelector('[data-orders-empty]').hidden = orders.length > 0;
			root.querySelector('[data-orders-list]').replaceChildren(...orders.map(renderOrder));
			results.hidden = false;
		})
		.catch(showForm);

	root.querySelector('[data-orders-logout]').addEventListener('click', async () => {
		await api('/api/orders/logout', { method: 'POST' }).catch(() => {});
		window.location.reload();
	});

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const email = form.elements.email;
		email.removeAttribute('aria-invalid');
		if (!email.checkValidity()) {
			email.setAttribute('aria-invalid', 'true');
			email.focus();
			setStatus('Please enter a valid email address.', 'error');
			return;
		}
		const button = form.querySelector('[type="submit"]');
		button.disabled = true;
		setStatus('Sending…');
		try {
			const data = await api(form.action, { method: 'POST', body: new FormData(form) });
			setStatus(data.message, 'success');
		} catch (error) {
			setStatus(`${error.message} Please try again.`, 'error');
		} finally {
			window.turnstile?.reset();
			button.disabled = false;
		}
	});
}

function initVerify(root) {
	const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
	// Keep the token out of history and anything that reads the URL later
	if (window.location.hash) history.replaceState(null, '', window.location.pathname);
	const button = root.querySelector('[data-orders-verify-button]');
	const status = root.querySelector('[data-orders-status]');

	if (!token) {
		button.hidden = true;
		status.dataset.state = 'error';
		status.replaceChildren('This link is incomplete. ', el('a', { href: '/orders' }, 'Request a new one'), '.');
		return;
	}

	button.addEventListener('click', async () => {
		button.disabled = true;
		status.textContent = 'Signing in…';
		try {
			await api('/api/orders/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
			window.location.replace('/orders');
		} catch (error) {
			status.dataset.state = 'error';
			status.replaceChildren(`${error.message} `, el('a', { href: '/orders' }, 'Request a new link'), '.');
			button.hidden = true;
		}
	});
}

export default function initOrders() {
	const lookup = document.querySelector('[data-orders]');
	if (lookup) initLookup(lookup);
	const verify = document.querySelector('[data-orders-verify]');
	if (verify) initVerify(verify);
}
