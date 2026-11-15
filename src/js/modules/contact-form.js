import { loadScript } from './util.js';

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export default function initContactForm() {
	const form = document.getElementById('contact-form');
	if (!form) return;

	const status = form.querySelector('[data-form-status]');
	const button = form.querySelector('[type="submit"]');
	const setStatus = (message, state = '') => {
		status.textContent = message;
		status.dataset.state = state;
	};

	// Turnstile auto-renders every .cf-turnstile element once loaded
	loadScript(TURNSTILE_SRC).catch(() => setStatus('Spam protection failed to load. Please refresh the page.', 'error'));

	form.addEventListener('submit', async (event) => {
		event.preventDefault();

		const invalid = [...form.elements].filter((el) => el.willValidate && !el.checkValidity());
		form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
		if (invalid.length) {
			invalid.forEach((el) => el.setAttribute('aria-invalid', 'true'));
			invalid[0].focus();
			setStatus('Please complete the highlighted fields.', 'error');
			return;
		}

		button.disabled = true;
		setStatus('Sending…');
		try {
			const response = await fetch(form.action, {
				method: 'POST',
				body: new FormData(form),
				headers: { Accept: 'application/json' },
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || 'Something went wrong.');
			form.reset();
			setStatus(data.message || 'Thanks! Your message has been sent.', 'success');
		} catch (error) {
			setStatus(`${error.message} Please try again.`, 'error');
		} finally {
			window.turnstile?.reset();
			button.disabled = false;
		}
	});
}
