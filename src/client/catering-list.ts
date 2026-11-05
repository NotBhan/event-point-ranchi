const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-package-card-href]'));

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('a, button, input, select, textarea, label'));
}

for (const card of cards) {
  card.addEventListener('click', (event) => {
    if (isInteractive(event.target)) return;
    const href = card.dataset.packageCardHref;
    if (href) window.location.assign(href);
  });

  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const href = card.dataset.packageCardHref;
    if (href) window.location.assign(href);
  });
}
