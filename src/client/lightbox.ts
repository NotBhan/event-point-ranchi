function getLightboxElements() {
  const root = document.querySelector<HTMLElement>('[data-lightbox-root]');
  const image = document.querySelector<HTMLImageElement>('[data-lightbox-image]');
  const caption = document.querySelector<HTMLElement>('[data-lightbox-caption]');
  return { root, image, caption };
}

export function openLightbox(src: string, text = ''): void {
  const { root, image, caption } = getLightboxElements();
  if (!root || !image) return;

  image.src = src;
  image.alt = text || 'Event design preview';
  if (caption) caption.textContent = text;
  root.classList.add('open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

export function closeLightbox(): void {
  const { root, image } = getLightboxElements();
  if (!root) return;

  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  if (image) image.src = '';
  document.body.classList.remove('no-scroll');
}

// Global click listener for [data-lightbox] elements and dismissals
document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  if (!target) return;

  const trigger = target.closest<HTMLElement>('[data-lightbox]');
  if (trigger) {
    event.preventDefault();
    const src = trigger.dataset.src ?? '';
    if (src) {
      openLightbox(src, trigger.dataset.caption ?? '');
    }
    return;
  }

  const { root } = getLightboxElements();
  if (target.closest('[data-lightbox-close]') || target === root) {
    event.preventDefault();
    closeLightbox();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLightbox();
});
