const root = document.querySelector<HTMLElement>('[data-lightbox-root]');
const image = document.querySelector<HTMLImageElement>('[data-lightbox-image]');
const caption = document.querySelector<HTMLElement>('[data-lightbox-caption]');

function openLightbox(src: string, text: string): void {
  if (!root || !image) return;
  image.src = src;
  image.alt = text || 'Image preview';
  if (caption) caption.textContent = text;
  root.classList.add('open');
  document.body.classList.add('no-scroll');
}

function closeLightbox(): void {
  if (!root) return;
  root.classList.remove('open');
  if (image) image.src = '';
  document.body.classList.remove('no-scroll');
}

document.addEventListener('click', (event) => {
  const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-lightbox]');
  if (trigger) {
    event.preventDefault();
    const src = trigger.dataset.src ?? '';
    if (src) openLightbox(src, trigger.dataset.caption ?? '');
    return;
  }

  if ((event.target as HTMLElement).closest('[data-lightbox-close]')) {
    event.preventDefault();
    closeLightbox();
    return;
  }

  if (event.target === root) closeLightbox();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLightbox();
});

export { openLightbox, closeLightbox };
