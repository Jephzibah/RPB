import { el, fetchJson as api, formatDate, formatDateTime, formatMoney, loadScript } from './util.js';

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const jsonPost = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function statusSetter(node) {
	return (message, state = '') => {
		node.textContent = message;
		node.dataset.state = state;
	};
}

function renderThread(messages, siteName) {
	if (!messages.length) return el('p', { class: 'thread__empty' }, 'No messages yet. Questions about this order? Send us a message below.');
	return el(
		'ol',
		{ class: 'thread' },
		...messages.map((m) =>
			el(
				'li',
				{ class: `thread__message thread__message--${m.role === 'customer' ? 'mine' : 'theirs'}` },
				el('p', { class: 'thread__meta' }, `${m.role === 'customer' ? 'You' : siteName} · ${formatDateTime(m.createdAt)}`),
				el('p', { class: 'thread__body' }, m.body),
			),
		),
	);
}

function renderOrder(order, siteName, reload) {
	const fieldId = `message-${order.number}`;
	const status = el('p', { class: 'form__status', role: 'status' });
	const form = el(
		'form',
		{ class: 'form thread__form' },
		el('div', { class: 'form__field form__field--full' }, el('label', { for: fieldId }, 'Send a message'), el('textarea', { id: fieldId, name: 'body', rows: '3', maxlength: '2000', required: '' })),
		el('div', { class: 'form__field form__field--full' }, el('button', { class: 'btn btn--hollow', type: 'submit' }, 'Send'), status),
	);
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const setStatus = statusSetter(status);
		const button = form.querySelector('button');
		button.disabled = true;
		try {
			await api(`/api/orders/${order.number}/messages`, jsonPost({ body: form.elements.body.value }));
			await reload(order.number);
		} catch (error) {
			setStatus(error.message, 'error');
			button.disabled = false;
		}
	});

	return el(
		'li',
		{ class: 'orders__order', id: `order-${order.number}` },
		el('h2', { class: 'orders__number' }, `Order #${order.number}`),
		el(
			'dl',
			{ class: 'orders__meta' },
			el('dt', {}, 'Placed'), el('dd', {}, formatDate(order.createdAt)),
			el('dt', {}, 'Status'), el('dd', {}, order.status),
			el('dt', {}, 'Total'), el('dd', {}, formatMoney(order.total, order.currency)),
			...(order.tracking ? [el('dt', {}, 'Tracking'), el('dd', {}, order.tracking)] : []),
		),
		el('ul', { class: 'orders__items' }, ...order.items.map((item) => el('li', {}, `${item.qty} × ${item.name}`))),
		el('h3', { class: 'orders__subhead' }, 'Messages'),
		renderThread(order.messages, siteName),
		form,
	);
}

function initOrdersPage(root) {
	const results = root.querySelector('[data-orders-results]');
	const setStatus = statusSetter(root.querySelector('[data-orders-status]'));

	async function load(focusNumber) {
		try {
			const { email, siteName, orders } = await api('/api/orders');
			root.querySelector('[data-orders-email]').textContent = `Signed in as ${email}.`;
			root.querySelector('[data-orders-empty]').hidden = orders.length > 0;
			root.querySelector('[data-orders-list]').replaceChildren(...orders.map((order) => renderOrder(order, siteName, load)));
			results.hidden = false;
			if (focusNumber) document.getElementById(`message-${focusNumber}`)?.focus();
		} catch (error) {
			if (error.status === 401) {
				results.hidden = true;
				root.querySelector('[data-orders-signed-out]').hidden = false;
			} else {
				setStatus(error.message, 'error');
			}
		}
	}

	root.querySelector('[data-orders-logout]').addEventListener('click', async () => {
		await api('/api/orders/logout', { method: 'POST' }).catch(() => {});
		window.location.assign('/login');
	});
	load();
}

function initLogin(root) {
	const form = root.querySelector('[data-login-form]');
	const setStatus = statusSetter(root.querySelector('[data-login-status]'));

	// Already signed in as a customer: skip the form
	api('/api/orders')
		.then(() => window.location.replace('/orders'))
		.catch(() => {
			form.hidden = false;
			loadScript(TURNSTILE_SRC).catch(() => setStatus('Spam protection failed to load. Please refresh the page.', 'error'));
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
		setStatus('Checking…');
		try {
			const data = await api(form.action, { method: 'POST', body: new FormData(form) });
			if (data.redirect) {
				setStatus('Taking you to the admin sign-in…');
				window.location.assign(data.redirect);
				return;
			}
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
		status.replaceChildren('This link is incomplete. ', el('a', { href: '/login' }, 'Request a new one'), '.');
		return;
	}

	button.addEventListener('click', async () => {
		button.disabled = true;
		status.textContent = 'Signing in…';
		try {
			await api('/api/orders/session', jsonPost({ token }));
			window.location.replace('/orders');
		} catch (error) {
			status.dataset.state = 'error';
			status.replaceChildren(`${error.message} `, el('a', { href: '/login' }, 'Request a new link'), '.');
			button.hidden = true;
		}
	});
}

export default function initOrders() {
	const orders = document.querySelector('[data-orders]');
	if (orders) initOrdersPage(orders);
	const login = document.querySelector('[data-login]');
	if (login) initLogin(login);
	const verify = document.querySelector('[data-orders-verify]');
	if (verify) initVerify(verify);
}
