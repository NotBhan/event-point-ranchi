if (!(window as any).__catalogue_admin_initialized) {
  (window as any).__catalogue_admin_initialized = true;

  document.querySelectorAll<HTMLFormElement>('.catalogue-editor').forEach((form) => {
    const name = form.querySelector<HTMLInputElement>('[name="name"]');
    const slug = form.querySelector<HTMLInputElement>('[name="slug"]');
    let slugTouched = Boolean(slug?.value);

    slug?.addEventListener('input', () => {
      slugTouched = true;
    });
    name?.addEventListener('input', () => {
      if (!slug || slugTouched) return;
      slug.value = name.value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    });

    const price = form.querySelector<HTMLInputElement>('[name="price"]');
    const modes = form.querySelectorAll<HTMLInputElement>('[name="pricing_mode"]');
    const syncPriceMode = () => {
      const selected = form.querySelector<HTMLInputElement>('[name="pricing_mode"]:checked')?.value;
      if (!price) return;
      price.disabled = selected === 'on_request';
      if (selected === 'on_request') price.value = '';
    };
    modes.forEach((mode) => mode.addEventListener('change', syncPriceMode));
    syncPriceMode();

    let dirty = false;
    form.addEventListener('input', () => {
      dirty = true;
    });
    form.addEventListener('submit', () => {
      dirty = false;
    });
    window.addEventListener('beforeunload', (event) => {
      if (dirty) event.preventDefault();
    });
  });
}
