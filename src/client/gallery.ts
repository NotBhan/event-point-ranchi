const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gallery-filter]'));
const items = Array.from(document.querySelectorAll<HTMLElement>('[data-gallery-item]'));

for (const button of buttons) {
  button.addEventListener('click', () => {
    const filter = button.dataset.galleryFilter ?? 'all';

    for (const entry of buttons) entry.classList.toggle('active', entry === button);

    for (const item of items) {
      const visible = filter === 'all' || item.dataset.galleryCategory === filter;
      item.hidden = !visible;
    }
  });
}
