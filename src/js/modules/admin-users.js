import { el, fetchJson as api, showAdminError } from './util.js';

export default function initAdminUsers() {
	const root = document.querySelector('[data-admin-users]');
	if (!root) return;

	const status = root.querySelector('[data-admin-status]');
	const listEl = root.querySelector('[data-admin-users-list]');
	const form = root.querySelector('[data-admin-users-add]');
	let you = null;

	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};
	const fail = (error) => showAdminError(status, error);
	const send = (method, email) => api('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });

	function render(users) {
		listEl.replaceChildren(
			...users.map((user) => {
				const item = el('li', { class: 'admin__user' }, el('span', {}, `${user.email} (${user.role})`));
				if (user.email === you?.email) {
					item.append(el('span', { class: 'form__optional' }, 'you'));
				} else if (user.role !== 'provider' || you?.role === 'provider') {
					const remove = el('button', { class: 'link-button', type: 'button' }, 'Remove');
					remove.setAttribute('aria-label', `Remove ${user.email}`);
					remove.addEventListener('click', async () => {
						if (!window.confirm(`Remove ${user.email} from the admin?`)) return;
						try {
							render((await send('DELETE', user.email)).users);
							setStatus(`${user.email} removed.`, 'success');
						} catch (error) {
							fail(error);
						}
					});
					item.append(remove);
				}
				return item;
			}),
		);
	}

	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const button = form.querySelector('[type="submit"]');
		button.disabled = true;
		try {
			const email = form.elements.email.value;
			render((await send('POST', email)).users);
			form.reset();
			setStatus(`${email} added and emailed.`, 'success');
		} catch (error) {
			fail(error);
		} finally {
			button.disabled = false;
		}
	});

	api('/api/admin/users')
		.then((data) => {
			you = data.you;
			render(data.users);
		})
		.catch((error) => {
			form.hidden = true;
			fail(error);
		});
}
