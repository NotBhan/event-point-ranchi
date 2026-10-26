function initGalleryFilters() {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gallery-filter]'));
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-gallery-item]'));
  if (!buttons.length || !items.length) return;

  function applyFilter(filter: string) {
    for (const entry of buttons) {
      const match = entry.dataset.galleryFilter === filter || entry.dataset.categorySlug === filter;
      entry.classList.toggle('active', match || (filter === 'all' && entry.dataset.galleryFilter === 'all'));
    }

    for (const item of items) {
      const visible =
        filter === 'all' ||
        item.dataset.galleryCategory === filter ||
        item.dataset.gallerySlug === filter;
      item.hidden = !visible;
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const filter = button.dataset.galleryFilter ?? 'all';
      applyFilter(filter);
    });
  }

  // Check URL query parameters (e.g. ?category=mandap-designs or ?category=1)
  const urlParams = new URLSearchParams(window.location.search);
  const requestedCategory = urlParams.get('category');
  if (requestedCategory) {
    applyFilter(requestedCategory);
  }
}

initGalleryFilters();
document.addEventListener('astro:page-load', initGalleryFilters);
