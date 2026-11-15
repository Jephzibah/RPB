import { el, fetchJson as api, formatDate, formatMoney, showAdminError } from './util.js';

export default function initAdminCustomers() {
	const root = document.querySelector('[data-admin-customers]');
	if (!root) return;

	const $ = (selector) => root.querySelector(selector);
	const status = $('[data-admin-status]');
	const rows = $('[data-admin-rows]');
	const detail = $('[data-admin-detail]');
	const filters = $('[data-admin-filters]');
	const emailForm = $('[data-admin-email]');
	let current = null;

	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};
	const fail = (error) => showAdminError(status, error);

	async function loadCustomers() {
		try {
			const { customers } = await api(`/api/admin/customers?${new URLSearchParams(new FormData(filters))}`);
			rows.replaceChildren(
				...customers.map((customer) => {
					const open = el('button', { class: 'link-button', type: 'button' }, customer.name ? `${customer.name} · ${customer.email}` : customer.email);
					open.addEventListener('click', () => showCustomer(customer));
					return el(
						'tr',
						{},
						el('th', { scope: 'row' }, open),
						el('td', {}, String(customer.orders)),
						el('td', {}, formatMoney(customer.spent, customer.currency)),
						el('td', {}, formatDate(customer.lastOrder)),
					);
				}),
			);
			$('[data-admin-empty]').hidden = customers.length > 0;
		} catch (error) {
			fail(error);
		}
	}

	async function showCustomer(customer) {
		try {
			const { orders } = await api(`/api/admin/orders?${new URLSearchParams({ email: customer.email })}`);
			current = customer;
			$('[data-admin-detail-title]').textContent = customer.name ? `${customer.name} (${customer.email})` : customer.email;
			$('[data-admin-customer-orders]').replaceChildren(
				el(
					'ul',
					{ class: 'admin__list' },
					...orders.map((order) =>
						el('li', {}, el('a', { href: `/admin#order-${order.number}` }, `#${order.number}`), ` · ${formatDate(order.createdAt)} · ${formatMoney(order.total, order.currency)} · ${order.status}`),
					),
				),
			);
			emailForm.reset();
			detail.hidden = false;
			detail.focus();
		} catch (error) {
			fail(error);
		}
	}

	filters.addEventListener('submit', (event) => {
		event.preventDefault();
		loadCustomers();
	});

	emailForm.addEventListener('submit', async (event) => {
		event.preventDefault();
		const to = emailForm.elements.to.value;
		if (!window.confirm(`Move all of ${current.email}'s orders to ${to}?`)) return;
		const button = emailForm.querySelector('[type="submit"]');
		button.disabled = true;
		try {
			const { moved } = await api('/api/admin/customers/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ from: current.email, to, confirmed: emailForm.elements.confirmed.checked }),
			});
			setStatus(`${moved} order${moved === 1 ? '' : 's'} moved to ${to}. Both addresses were notified.`, 'success');
			detail.hidden = true;
			await loadCustomers();
		} catch (error) {
			fail(error);
		} finally {
			button.disabled = false;
		}
	});

	loadCustomers();
}
