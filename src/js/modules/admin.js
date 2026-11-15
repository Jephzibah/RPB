import { el, fetchJson as api, formatDate, formatMoney } from './util.js';

const formatDateTime = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const jsonBody = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function describeAddress(shipping) {
	if (!shipping) return null;
	const address = shipping.address || {};
	const name = shipping.name?.full_name || shipping.name || '';
	return [name, address.line1 || address.address_line_1, address.line2 || address.address_line_2, [address.city || address.admin_area_2, address.state || address.admin_area_1, address.postal_code].filter(Boolean).join(' '), address.country || address.country_code]
		.filter(Boolean)
		.join(', ');
}

function describeHistory(entry) {
	if (entry.action === 'update') {
		const { from, to, notified } = entry.detail;
		const changes = [];
		if (from.status !== to.status) changes.push(`status ${from.status} → ${to.status}`);
		if (from.tracking !== to.tracking) changes.push(`tracking “${to.tracking || 'none'}”`);
		return `${changes.join(', ')}${notified ? ' (customer emailed)' : ''}`;
	}
	return entry.action;
}

export default function initAdmin() {
	const root = document.querySelector('[data-admin]');
	if (!root) return;

	const $ = (selector) => root.querySelector(selector);
	const status = $('[data-admin-status]');
	const rows = $('[data-admin-rows]');
	const more = $('[data-admin-more]');
	const detail = $('[data-admin-detail]');
	const filters = $('[data-admin-filters]');
	let next = null;
	let current = null;

	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};
	const fail = (error) => setStatus(error.status === 401 ? 'Your session has expired. Reload the page to sign in again.' : error.message, 'error');

	api('/api/admin/me')
		.then(({ email, role }) => ($('[data-admin-who]').textContent = `Signed in as ${email} (${role}).`))
		.catch(fail);

	function row(order) {
		const open = el('button', { class: 'link-button', type: 'button' }, `#${order.number}`);
		open.addEventListener('click', () => showOrder(order.number));
		return el(
			'tr',
			{},
			el('th', { scope: 'row' }, open),
			el('td', {}, formatDate(order.createdAt)),
			el('td', {}, order.name ? `${order.name} · ${order.email}` : order.email),
			el('td', {}, formatMoney(order.total, order.currency)),
			el('td', { class: 'admin__status' }, order.status),
		);
	}

	async function loadOrders({ append = false } = {}) {
		const params = new URLSearchParams(new FormData(filters));
		if (append && next) params.set('before', next);
		try {
			const data = await api(`/api/admin/orders?${params}`);
			next = data.next;
			if (append) rows.append(...data.orders.map(row));
			else rows.replaceChildren(...data.orders.map(row));
			$('[data-admin-empty]').hidden = rows.children.length > 0;
			more.hidden = !next;
		} catch (error) {
			fail(error);
		}
	}

	async function showOrder(number) {
		try {
			const { order, notes, history } = await api(`/api/admin/orders/${number}`);
			current = order;
			$('[data-admin-detail-title]').textContent = `Order #${order.number}`;
			const address = describeAddress(order.shipping);
			$('[data-admin-detail-body]').replaceChildren(
				el(
					'dl',
					{ class: 'admin__meta' },
					el('dt', {}, 'Placed'), el('dd', {}, formatDateTime(order.createdAt)),
					el('dt', {}, 'Customer'), el('dd', {}, [order.name, order.email].filter(Boolean).join(' · ')),
					el('dt', {}, 'Total'), el('dd', {}, formatMoney(order.total, order.currency)),
					el('dt', {}, 'Payment'), el('dd', {}, `${order.provider} · ${order.providerRef}`),
					...(address ? [el('dt', {}, 'Ship to'), el('dd', {}, address)] : []),
				),
				el('h3', {}, 'Items'),
				el('ul', {}, ...order.items.map((item) => el('li', {}, `${item.qty} × ${item.name} · ${formatMoney(item.price * item.qty, order.currency)}`))),
				el('h3', {}, 'Notes'),
				notes.length
					? el('ul', { class: 'admin__notes' }, ...notes.map((n) => el('li', {}, el('strong', {}, `${n.author}, ${formatDateTime(n.createdAt)}: `), n.body)))
					: el('p', {}, 'No notes yet.'),
				el('h3', {}, 'History'),
				history.length
					? el('ul', { class: 'admin__history' }, ...history.map((h) => el('li', {}, `${formatDateTime(h.createdAt)} · ${h.actor} · ${describeHistory(h)}`)))
					: el('p', {}, 'No changes yet.'),
			);
			const update = $('[data-admin-update]');
			update.elements.status.value = order.status;
			update.elements.tracking.value = order.tracking;
			detail.hidden = false;
			detail.focus();
		} catch (error) {
			fail(error);
		}
	}

	filters.addEventListener('submit', (event) => {
		event.preventDefault();
		loadOrders();
	});
	more.addEventListener('click', () => loadOrders({ append: true }));

	$('[data-admin-update]').addEventListener('submit', async (event) => {
		event.preventDefault();
		const form = event.currentTarget;
		try {
			await api(`/api/admin/orders/${current.number}`, jsonBody({ status: form.elements.status.value, tracking: form.elements.tracking.value, notify: form.elements.notify.checked }, 'PATCH'));
			setStatus(`Order #${current.number} saved.`, 'success');
			await Promise.all([showOrder(current.number), loadOrders()]);
		} catch (error) {
			fail(error);
		}
	});

	$('[data-admin-note]').addEventListener('submit', async (event) => {
		event.preventDefault();
		const form = event.currentTarget;
		try {
			await api(`/api/admin/orders/${current.number}/notes`, jsonBody({ body: form.elements.body.value }));
			form.reset();
			setStatus('Note added.', 'success');
			await showOrder(current.number);
		} catch (error) {
			fail(error);
		}
	});

	$('[data-admin-email]').addEventListener('submit', async (event) => {
		event.preventDefault();
		const form = event.currentTarget;
		const { from, to } = form.elements;
		if (!form.checkValidity()) {
			form.reportValidity();
			return;
		}
		if (!window.confirm(`Move all orders from ${from.value} to ${to.value}?`)) return;
		try {
			const { moved } = await api('/api/admin/customers/email', jsonBody({ from: from.value, to: to.value }));
			form.reset();
			setStatus(`${moved} order${moved === 1 ? '' : 's'} moved to the new email. Both addresses were notified.`, 'success');
			loadOrders();
		} catch (error) {
			fail(error);
		}
	});

	loadOrders();
}
