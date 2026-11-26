// Without JS the tabs are plain anchor links and every panel stays visible, stacked.
function setup(root) {
	const list = root.querySelector('.tabs__list');
	const tabs = [...list.querySelectorAll('.tabs__tab')];
	const panels = tabs.map((tab) => document.getElementById(tab.hash.slice(1)));

	const select = (index, { focus = false, updateHash = true } = {}) => {
		tabs.forEach((tab, i) => {
			const selected = i === index;
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
			panels[i].hidden = !selected;
		});
		if (focus) tabs[index].focus();
		if (updateHash) window.history.replaceState(null, '', `#${panels[index].id}`);
	};

	list.setAttribute('role', 'tablist');
	list.querySelectorAll('li').forEach((li) => li.setAttribute('role', 'presentation'));
	tabs.forEach((tab, i) => {
		tab.id ||= `${panels[i].id}-tab`;
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-controls', panels[i].id);
		panels[i].setAttribute('role', 'tabpanel');
		panels[i].setAttribute('aria-labelledby', tab.id);
		panels[i].tabIndex = 0;

		tab.addEventListener('click', (event) => {
			event.preventDefault();
			select(i);
		});
		tab.addEventListener('keydown', (event) => {
			const last = tabs.length - 1;
			const target = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
			if (event.key === ' ') {
				event.preventDefault();
				select(i);
			} else if (target !== undefined) {
				event.preventDefault();
				select(target, { focus: true });
			}
		});
	});

	const linked = panels.findIndex((panel) => `#${panel.id}` === window.location.hash);
	select(Math.max(linked, 0), { updateHash: false });
}

export default function initTabs() {
	document.querySelectorAll('[data-tabs]').forEach(setup);
}
