import { el, fetchJson as api, formatDate, formatDateTime, formatMoney, showAdminError } from './util.js';

const ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'postal_code', 'country'];
const jsonBody = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Orders recorded before shipping was normalized still hold Stripe's/PayPal's own address shape
function toAddress(shipping) {
	if (!shipping) return {};
	const a = shipping.address || shipping;
	return {
		name: shipping.name?.full_name ?? shipping.name ?? '',
		line1: a.line1 ?? a.address_line_1 ?? '',
		line2: a.line2 ?? a.address_line_2 ?? '',
		city: a.city ?? a.admin_area_2 ?? '',
		state: a.state ?? a.admin_area_1 ?? '',
		postal_code: a.postal_code ?? '',
		country: a.country ?? a.country_code ?? '',
	};
}

const describeAddress = (address) =>
	[address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(' '), address.country].filter(Boolean).join(', ');

function describeHistory(entry) {
	const { action, detail } = entry;
	if (action === 'update') {
		const changes = [];
		if (detail.from.status !== detail.to.status) changes.push(`status ${detail.from.status} → ${detail.to.status}`);
		if (detail.from.tracking !== detail.to.tracking) changes.push(`tracking “${detail.to.tracking || 'none'}”`);
		return `${changes.join(', ')}${detail.notified ? ' (customer emailed)' : ''}`;
	}
	if (action === 'edit-customer') {
		const changes = [];
		if (detail.name) changes.push(`name “${detail.name.from}” → “${detail.name.to}”`);
		if (detail.email) changes.push(`email ${detail.email.from} → ${detail.email.to} (${detail.email.orders} order${detail.email.orders === 1 ? '' : 's'} moved)`);
		if (detail.shipping) changes.push('shipping address');
		return `edited customer: ${changes.join(', ')}`;
	}
	if (action === 'change-email') return `email ${detail.from} → ${detail.to}`;
	return action;
}

const list = (items, empty, render) => (items.length ? el('ul', { class: 'admin__list' }, ...items.map(render)) : el('p', {}, empty));

export default function initAdmin() {
	const root = document.querySelector('[data-admin]');
	if (!root) return;

	const $ = (selector) => root.querySelector(selector);
	const status = $('[data-admin-status]');
	const rows = $('[data-admin-rows]');
	const more = $('[data-admin-more]');
	const detail = $('[data-admin-detail]');
	const filters = $('[data-admin-filters]');
	const customerForm = $('[data-admin-customer-form]');
	const editToggle = $('[data-admin-edit-toggle]');
	const confirmBox = $('[data-admin-confirm]');
	let next = null;
	let current = null;

	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};
	const fail = (error) => showAdminError(status, error);

	api('/api/admin/me')
		.then(({ email, role }) => ($('[data-admin-who]').textContent = `Signed in as ${email} (${role}).`))
		.catch(fail);

	function row(order) {
		const open = el('button', { class: 'link-button', type: 'button' }, `#${order.number}`);
		open.addEventListener('click', () => showOrder(order.number));
		return el(
			'tr',
			{ 'data-number': String(order.number) },
			el('th', { scope: 'row' }, open),
			el('td', {}, formatDate(order.createdAt)),
			el('td', {}, order.name ? `${order.name} · ${order.email}` : order.email),
			el('td', {}, formatMoney(order.total, order.currency)),
			el('td', { class: 'admin__status' }, order.status),
		);
	}

	async function loadOrders({ append = false } = {}) {
		if (append && !next) return;
		const params = new URLSearchParams(new FormData(filters));
		if (append) params.set('before', next);
		try {
			const data = await api(`/api/admin/orders?${params}`);
			next = data.next;
			if (append) {
				const shown = new Set([...rows.children].map((tr) => tr.dataset.number));
				rows.append(...data.orders.filter((order) => !shown.has(String(order.number))).map(row));
			} else {
				rows.replaceChildren(...data.orders.map(row));
			}
			$('[data-admin-empty]').hidden = rows.children.length > 0;
			more.hidden = !next;
		} catch (error) {
			fail(error);
		}
	}

	function setEditing(editing) {
		customerForm.hidden = !editing;
		editToggle.setAttribute('aria-expanded', String(editing));
		editToggle.hidden = editing;
		if (!editing) return;
		const address = toAddress(current.shipping);
		customerForm.elements.name.value = current.name || address.name || '';
		customerForm.elements.email.value = current.email;
		ADDRESS_FIELDS.forEach((field) => (customerForm.elements[field].value = address[field] || ''));
		customerForm.elements.confirmed.checked = false;
		confirmBox.hidden = true;
		customerForm.elements.name.focus();
	}

	async function showOrder(number, { focus = true } = {}) {
		try {
			const { order, messages, notes, history } = await api(`/api/admin/orders/${number}`);
			current = order;
			window.history.replaceState(null, '', `#order-${order.number}`);
			$('[data-admin-detail-title]').textContent = `Order #${order.number}`;
			$('[data-admin-summary]').replaceChildren(
				el(
					'dl',
					{ class: 'admin__meta' },
					el('dt', {}, 'Placed'), el('dd', {}, formatDateTime(order.createdAt)),
					el('dt', {}, 'Total'), el('dd', {}, formatMoney(order.total, order.currency)),
					el('dt', {}, 'Payment'), el('dd', {}, `${order.provider} · ${order.providerRef}`),
				),
				el('ul', { class: 'admin__list' }, ...order.items.map((item) => el('li', {}, `${item.qty} × ${item.name} · ${formatMoney(item.price * item.qty, order.currency)}`))),
			);

			const address = toAddress(order.shipping);
			$('[data-admin-customer]').replaceChildren(
				el(
					'dl',
					{ class: 'admin__meta' },
					el('dt', {}, 'Name'), el('dd', {}, order.name || address.name || '—'),
					el('dt', {}, 'Email'), el('dd', {}, order.email),
					el('dt', {}, 'Ship to'), el('dd', {}, describeAddress(address) || '—'),
				),
			);
			setEditing(false);

			$('[data-admin-thread]').replaceChildren(
				messages.length
					? el(
							'ol',
							{ class: 'thread' },
							...messages.map((m) =>
								el(
									'li',
									{ class: `thread__message thread__message--${m.role === 'customer' ? 'theirs' : 'mine'}` },
									el('p', { class: 'thread__meta' }, `${m.role === 'customer' ? 'Customer' : `${m.author} (${m.role})`} · ${formatDateTime(m.createdAt)}`),
									el('p', { class: 'thread__body' }, m.body),
								),
							),
						)
					: el('p', {}, 'No messages yet.'),
			);
			$('[data-admin-notes]').replaceChildren(list(notes, 'No notes yet.', (n) => el('li', {}, el('strong', {}, `${n.author}, ${formatDateTime(n.createdAt)}: `), n.body)));
			$('[data-admin-history]').replaceChildren(list(history, 'No changes yet.', (h) => el('li', {}, `${formatDateTime(h.createdAt)} · ${h.actor} · ${describeHistory(h)}`)));

			const update = $('[data-admin-update]');
			update.elements.status.value = order.status;
			update.elements.tracking.value = order.tracking;
			detail.hidden = false;
			if (focus) detail.focus();
		} catch (error) {
			fail(error);
		}
	}

	const handle = (selector, action) =>
		$(selector).addEventListener('submit', async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const button = form.querySelector('[type="submit"]');
			button.disabled = true;
			try {
				await action(form);
			} catch (error) {
				fail(error);
			} finally {
				button.disabled = false;
			}
		});

	filters.addEventListener('submit', (event) => {
		event.preventDefault();
		loadOrders();
	});
	more.addEventListener('click', () => loadOrders({ append: true }));
	editToggle.addEventListener('click', () => setEditing(true));
	$('[data-admin-edit-cancel]').addEventListener('click', () => {
		setEditing(false);
		editToggle.focus();
	});
	customerForm.elements.email.addEventListener('input', (event) => {
		confirmBox.hidden = event.target.value.trim().toLowerCase() === current.email;
	});

	handle('[data-admin-customer-form]', async (form) => {
		const emailChanged = form.elements.email.value.trim().toLowerCase() !== current.email;
		if (emailChanged && !form.elements.confirmed.checked) {
			setStatus('Tick the confirmation before changing the customer’s email.', 'error');
			form.elements.confirmed.focus();
			return;
		}
		const shipping = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, form.elements[field].value]));
		shipping.name = form.elements.name.value;
		await api(`/api/admin/orders/${current.number}/customer`, jsonBody({ name: form.elements.name.value, email: form.elements.email.value, shipping, confirmed: form.elements.confirmed.checked }, 'PATCH'));
		setStatus(emailChanged ? 'Customer saved. Their orders moved to the new email and both addresses were notified.' : 'Customer saved.', 'success');
		await Promise.all([showOrder(current.number, { focus: false }), loadOrders()]);
		editToggle.focus();
	});

	handle('[data-admin-message]', async (form) => {
		await api(`/api/admin/orders/${current.number}/messages`, jsonBody({ body: form.elements.body.value }));
		form.reset();
		setStatus('Message sent. The customer was emailed.', 'success');
		await showOrder(current.number, { focus: false });
	});

	handle('[data-admin-update]', async (form) => {
		await api(`/api/admin/orders/${current.number}`, jsonBody({ status: form.elements.status.value, tracking: form.elements.tracking.value, notify: form.elements.notify.checked }, 'PATCH'));
		setStatus(`Order #${current.number} saved.`, 'success');
		await Promise.all([showOrder(current.number, { focus: false }), loadOrders()]);
	});

	handle('[data-admin-note]', async (form) => {
		await api(`/api/admin/orders/${current.number}/notes`, jsonBody({ body: form.elements.body.value }));
		form.reset();
		setStatus('Note added.', 'success');
		await showOrder(current.number, { focus: false });
	});

	loadOrders();
	const linked = window.location.hash.match(/^#order-(\d+)$/);
	if (linked) showOrder(linked[1]);
}
