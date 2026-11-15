// Mobile menu. Without JS the links simply stay visible (see parts/_nav.scss).
export default function initNav() {
	const nav = document.querySelector('[data-nav]');
	const toggle = nav?.querySelector('[data-nav-toggle]');
	if (!nav || !toggle) return;

	const menu = document.getElementById(toggle.getAttribute('aria-controls'));
	nav.toggleAttribute('data-enhanced', true);

	const setOpen = (open) => {
		toggle.setAttribute('aria-expanded', String(open));
		nav.classList.toggle('is-open', open);
	};

	toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
	menu?.addEventListener('click', (event) => {
		if (event.target.closest('a')) setOpen(false);
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && nav.classList.contains('is-open')) {
			setOpen(false);
			toggle.focus();
		}
	});
}
