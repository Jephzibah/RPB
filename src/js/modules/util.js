const loaded = new Map();

export function loadScript(src, attrs = {}) {
	if (!loaded.has(src)) {
		loaded.set(
			src,
			new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = src;
				script.async = true;
				Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
				script.onload = resolve;
				script.onerror = () => reject(new Error(`Failed to load ${src}`));
				document.head.append(script);
			}),
		);
	}
	return loaded.get(src);
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || '';

export const formatMoney = (cents, currency) =>
	new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

export const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const formatDateTime = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	Object.entries(attrs).forEach(([key, value]) => (key === 'class' ? (node.className = value) : node.setAttribute(key, value)));
	node.append(...children.filter((child) => child !== null && child !== undefined));
	return node;
}

export async function fetchJson(path, options = {}) {
	const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...options.headers } });
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status, errorId: data.errorId, detail: data.detail });
	return data;
}

const detailText = (error) =>
	[
		`Error ID: ${error.detail.id}`,
		`Time: ${error.detail.time}`,
		`Page: ${window.location.href}`,
		`Request: ${error.detail.request} → ${error.detail.status}`,
		`Message: ${error.message}`,
		`Cause: ${error.detail.cause}`,
		error.detail.stack ? `Stack:\n${error.detail.stack}` : '',
	]
		.filter(Boolean)
		.join('\n');

/** Admin error message: the real cause plus "Copy details" and "Send to support" when the Worker returned details. */
export function showAdminError(status, error) {
	status.dataset.state = 'error';
	if (error.status === 401) {
		status.replaceChildren('Your session has expired. Reload the page to sign in again.');
		return;
	}
	if (!error.detail) {
		status.replaceChildren(error.errorId ? `${error.message} (error ID ${error.errorId})` : error.message);
		return;
	}

	const text = detailText(error);
	const feedback = el('span', { class: 'admin-error__feedback', role: 'status' });
	const copy = el('button', { class: 'link-button', type: 'button' }, 'Copy details');
	const report = el('button', { class: 'link-button', type: 'button' }, 'Send to support');
	copy.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			feedback.textContent = 'Copied.';
		} catch {
			feedback.textContent = 'Copy failed. Select the details below and copy them manually.';
		}
	});
	report.addEventListener('click', async () => {
		report.disabled = true;
		feedback.textContent = 'Sending…';
		try {
			const { to } = await fetchJson('/api/admin/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ details: text, page: window.location.href }),
			});
			// feedback.textContent = `Sent to ${to}.`;
			feedback.textContent = `Sent to support.`;
		} catch {
			report.disabled = false;
			feedback.textContent = 'Sending failed. Use "Copy details" and email them instead.';
		}
	});

	status.replaceChildren(
		el(
			'div',
			{ class: 'admin-error' },
			el('p', { class: 'admin-error__title' }, `${error.message} Error ID ${error.detail.id}: ${error.detail.cause}`),
			el('p', { class: 'admin-error__actions' }, copy, ' ', report, ' ', feedback),
			el('details', {}, el('summary', {}, 'Technical details'), el('pre', { class: 'admin-error__details' }, text)),
		),
	);
}
