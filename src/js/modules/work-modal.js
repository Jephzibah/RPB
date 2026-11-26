// Without JS (or <dialog> support) each card keeps its summary visible under the screenshot.
export default function initWorkModal() {
	const grid = document.querySelector('[data-work-grid]');
	const dialog = document.querySelector('[data-work-modal]');
	if (!grid || !dialog || typeof dialog.showModal !== 'function') return;

	const title = dialog.querySelector('[data-work-modal-title]');
	const media = dialog.querySelector('[data-work-modal-media]');
	const body = dialog.querySelector('[data-work-modal-body]');
	let opener = null;

	grid.querySelectorAll('.work-card').forEach((card) => {
		const name = card.querySelector('.work-card__title').textContent.trim();
		const detail = card.querySelector('.work-card__detail');
		const shot = card.querySelector('picture') || card.querySelector('img');

		const button = document.createElement('button');
		button.className = 'work-card__open';
		button.type = 'button';
		button.setAttribute('aria-haspopup', 'dialog');
		button.setAttribute('aria-label', `View details for ${name}`);
		shot.replaceWith(button);
		button.append(shot);
		detail.hidden = true;

		button.addEventListener('click', () => {
			title.textContent = name;
			media.replaceChildren(shot.cloneNode(true));
			body.replaceChildren(...[...detail.children].map((node) => node.cloneNode(true)));
			opener = button;
			dialog.showModal();
		});
	});

	// Safari doesn't focus buttons on click, so the browser can't be relied on to restore focus
	dialog.addEventListener('close', () => opener?.focus());
	dialog.querySelector('[data-work-modal-close]').addEventListener('click', () => dialog.close());
	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) dialog.close();
	});
}
