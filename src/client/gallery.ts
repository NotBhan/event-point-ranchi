interface GalleryState {
  currentFilter: string;
  currentPage: number;
  pageSize: number | 'all';
}

function initGallery() {
  const filterBar = document.querySelector<HTMLElement>('[data-gallery-filters]');
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gallery-filter]'));
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-gallery-item]'));
  const pagination = document.querySelector<HTMLElement>('[data-gallery-pagination]');
  const prevBtn = document.querySelector<HTMLButtonElement>('[data-page-prev]');
  const nextBtn = document.querySelector<HTMLButtonElement>('[data-page-next]');
  const pagesContainer = document.querySelector<HTMLElement>('[data-page-numbers]');
  const rangeStart = document.querySelector<HTMLElement>('[data-range-start]');
  const rangeEnd = document.querySelector<HTMLElement>('[data-range-end]');
  const totalCount = document.querySelector<HTMLElement>('[data-total-count]');
  const pageSizeSelect = document.querySelector<HTMLSelectElement>('[data-page-size-select]');
  const emptyState = document.querySelector<HTMLElement>('[data-gallery-empty]');
  const resetBtn = document.querySelector<HTMLButtonElement>('[data-reset-filter]');
  const masonry = document.querySelector<HTMLElement>('[data-gallery-masonry]');

  if (!items.length) return;

  // Read URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const paramFilter = urlParams.get('category') || 'all';
  const paramPage = parseInt(urlParams.get('page') || '1', 10);
  const paramPageSize = urlParams.get('size');

  let defaultPageSize: number | 'all' = 8;
  if (paramPageSize === 'all') {
    defaultPageSize = 'all';
  } else if (paramPageSize && !isNaN(parseInt(paramPageSize, 10))) {
    defaultPageSize = parseInt(paramPageSize, 10);
  }

  const state: GalleryState = {
    currentFilter: paramFilter,
    currentPage: isNaN(paramPage) || paramPage < 1 ? 1 : paramPage,
    pageSize: defaultPageSize,
  };

  if (pageSizeSelect) {
    pageSizeSelect.value = state.pageSize === 'all' ? 'all' : String(state.pageSize);
  }

  function getFilteredItems(): HTMLElement[] {
    return items.filter((item) => {
      if (state.currentFilter === 'all') return true;
      return (
        item.dataset.galleryCategory === state.currentFilter ||
        item.dataset.gallerySlug === state.currentFilter
      );
    });
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    if (state.currentFilter !== 'all') {
      url.searchParams.set('category', state.currentFilter);
    } else {
      url.searchParams.delete('category');
    }

    if (state.currentPage > 1) {
      url.searchParams.set('page', String(state.currentPage));
    } else {
      url.searchParams.delete('page');
    }

    if (state.pageSize !== 8) {
      url.searchParams.set('size', String(state.pageSize));
    } else {
      url.searchParams.delete('size');
    }

    window.history.replaceState({}, '', url.toString());
  }

  function scrollToGallery() {
    const target = filterBar || masonry;
    if (target) {
      const headerOffset = 90;
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  function renderPagination(totalPages: number) {
    if (!pagination) return;

    if (totalPages <= 1) {
      pagination.style.display = 'none';
      return;
    }

    pagination.style.display = 'flex';

    if (prevBtn) {
      prevBtn.disabled = state.currentPage <= 1;
    }
    if (nextBtn) {
      nextBtn.disabled = state.currentPage >= totalPages;
    }

    if (!pagesContainer) return;
    pagesContainer.innerHTML = '';

    // Render page buttons with ellipses if more than 7 pages
    const pagesToRender: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pagesToRender.push(i);
    } else {
      pagesToRender.push(1);
      if (state.currentPage > 3) pagesToRender.push('...');
      const start = Math.max(2, state.currentPage - 1);
      const end = Math.min(totalPages - 1, state.currentPage + 1);
      for (let i = start; i <= end; i++) pagesToRender.push(i);
      if (state.currentPage < totalPages - 2) pagesToRender.push('...');
      pagesToRender.push(totalPages);
    }

    for (const p of pagesToRender) {
      if (p === '...') {
        const span = document.createElement('span');
        span.className = 'page-ellipsis';
        span.textContent = '…';
        pagesContainer.appendChild(span);
      } else {
        const pageNum = p as number;
        const pageBtn = document.createElement('button');
        pageBtn.type = 'button';
        pageBtn.className = `page-num-btn ${pageNum === state.currentPage ? 'active' : ''}`;
        pageBtn.textContent = String(pageNum);
        pageBtn.dataset.page = String(pageNum);
        pageBtn.setAttribute('aria-label', `Go to page ${pageNum}`);
        if (pageNum === state.currentPage) {
          pageBtn.setAttribute('aria-current', 'page');
        }
        pageBtn.addEventListener('click', () => {
          if (state.currentPage !== pageNum) {
            state.currentPage = pageNum;
            render();
            updateUrl();
            scrollToGallery();
          }
        });
        pagesContainer.appendChild(pageBtn);
      }
    }
  }

  function render() {
    const filtered = getFilteredItems();
    const total = filtered.length;

    // Filter button active toggling
    for (const btn of buttons) {
      const match =
        btn.dataset.galleryFilter === state.currentFilter ||
        btn.dataset.categorySlug === state.currentFilter ||
        (state.currentFilter === 'all' && btn.dataset.galleryFilter === 'all');
      btn.classList.toggle('active', match);
    }

    // Check if category has 0 matching items
    if (total === 0) {
      items.forEach((item) => (item.hidden = true));
      if (emptyState) emptyState.style.display = 'block';
      if (masonry) masonry.style.display = 'none';
      if (pagination) pagination.style.display = 'none';
      if (rangeStart) rangeStart.textContent = '0';
      if (rangeEnd) rangeEnd.textContent = '0';
      if (totalCount) totalCount.textContent = '0';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (masonry) masonry.style.display = '';

    // Calculate pagination slices
    const perPage = state.pageSize === 'all' ? total : state.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    if (state.currentPage > totalPages) {
      state.currentPage = totalPages;
    }

    const startIndex = (state.currentPage - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, total);

    // Show/hide items for current page
    const visibleSet = new Set(filtered.slice(startIndex, endIndex));
    for (const item of items) {
      item.hidden = !visibleSet.has(item);
    }

    // Update range stats
    if (rangeStart) rangeStart.textContent = String(total > 0 ? startIndex + 1 : 0);
    if (rangeEnd) rangeEnd.textContent = String(endIndex);
    if (totalCount) totalCount.textContent = String(total);

    // Render pagination controls
    renderPagination(totalPages);
  }

  // Filter button click event
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const filter = button.dataset.galleryFilter ?? 'all';
      if (state.currentFilter !== filter) {
        state.currentFilter = filter;
        state.currentPage = 1;
        render();
        updateUrl();
      }
    });
  }

  // Previous page button click
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage--;
        render();
        updateUrl();
        scrollToGallery();
      }
    });
  }

  // Next page button click
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const filtered = getFilteredItems();
      const perPage = state.pageSize === 'all' ? filtered.length : state.pageSize;
      const totalPages = Math.ceil(filtered.length / perPage);
      if (state.currentPage < totalPages) {
        state.currentPage++;
        render();
        updateUrl();
        scrollToGallery();
      }
    });
  }

  // Per page select dropdown
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      const val = pageSizeSelect.value;
      state.pageSize = val === 'all' ? 'all' : parseInt(val, 10);
      state.currentPage = 1;
      render();
      updateUrl();
    });
  }

  // Reset filter button
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.currentFilter = 'all';
      state.currentPage = 1;
      render();
      updateUrl();
    });
  }

  // Keyboard accessibility: Enter or Space opens lightbox on focused pin
  for (const item of items) {
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
      }
    });
  }

  // Handle browser Back / Forward buttons
  window.addEventListener('popstate', () => {
    const newParams = new URLSearchParams(window.location.search);
    state.currentFilter = newParams.get('category') || 'all';
    const newPage = parseInt(newParams.get('page') || '1', 10);
    state.currentPage = isNaN(newPage) || newPage < 1 ? 1 : newPage;
    const newSize = newParams.get('size');
    state.pageSize = newSize === 'all' ? 'all' : (newSize && !isNaN(parseInt(newSize, 10)) ? parseInt(newSize, 10) : 8);
    if (pageSizeSelect) {
      pageSizeSelect.value = state.pageSize === 'all' ? 'all' : String(state.pageSize);
    }
    render();
  });

  // Initial render
  render();
}

// Initial invocation and Astro page load listener
initGallery();
document.addEventListener('astro:page-load', initGallery);
