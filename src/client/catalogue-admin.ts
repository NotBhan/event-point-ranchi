function initCatalogueEditors() {
  document.querySelectorAll<HTMLFormElement>('.catalogue-editor').forEach((form) => {
    if (form.dataset.catalogueInitialized === 'true') return;
    form.dataset.catalogueInitialized = 'true';

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

    window.addEventListener('beforeunload', (event) => {
      if (dirty) event.preventDefault();
    });

    const showError = (message: string) => {
      let alert = form.querySelector<HTMLDivElement>('.catalogue-form-alert');
      if (!alert) {
        alert = document.createElement('div');
        alert.className = 'catalogue-form-alert alert alert-error';
        alert.setAttribute('role', 'alert');
        form.prepend(alert);
      }
      alert.textContent = message;
      alert.style.display = 'flex';
      alert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const clearError = () => {
      const alert = form.querySelector<HTMLDivElement>('.catalogue-form-alert');
      if (alert) {
        alert.textContent = '';
        alert.style.display = 'none';
      }
    };

    form.addEventListener('submit', async (event) => {
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const actionValue = submitter?.getAttribute('value') ?? form.querySelector<HTMLInputElement>('input[name="action"]')?.value ?? 'save';

      // For actions other than save (e.g. duplicate or archive buttons), bypass AJAX handler
      if (actionValue !== 'save') {
        dirty = false;
        return;
      }

      event.preventDefault();

      if (form.dataset.submitting === 'true') {
        return;
      }

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      clearError();
      form.dataset.submitting = 'true';

      const submitBtn = submitter || form.querySelector<HTMLButtonElement>('button[type="submit"][value="save"]') || form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const originalText = submitBtn?.textContent ?? 'Save';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
        submitBtn.classList.add('is-loading');
      }

      const progressBar = document.getElementById('pageProgressBar');
      if (progressBar) {
        progressBar.classList.remove('is-finished');
        progressBar.classList.add('is-loading');
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);

      try {
        const formData = new FormData(form);
        if (!formData.has('action')) {
          formData.set('action', 'save');
        }

        const actionTarget = form.getAttribute('action') || window.location.href;
        const response = await fetch(actionTarget, {
          method: 'POST',
          body: formData,
          headers: {
            accept: 'application/json',
          },
          signal: controller.signal,
        });

        window.clearTimeout(timeoutId);

        let data: any = null;
        try {
          data = await response.json();
        } catch {
          throw new Error(`Server returned unexpected response (${response.status})`);
        }

        if (!response.ok || data.status !== 'ok') {
          throw new Error(data.message || 'Could not save the catalogue item.');
        }

        dirty = false;
        if (data.data?.redirect) {
          window.location.href = data.data.redirect;
        } else {
          window.location.reload();
        }
      } catch (err: any) {
        window.clearTimeout(timeoutId);
        const isAbort = err.name === 'AbortError';
        const msg = isAbort
          ? 'The request timed out. Please check your connection and try again.'
          : (err instanceof Error ? err.message : 'Could not save the catalogue item.');
        showError(msg);

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
          submitBtn.classList.remove('is-loading');
        }
        delete form.dataset.submitting;
        if (progressBar) {
          progressBar.classList.remove('is-loading');
          progressBar.classList.add('is-finished');
        }
      }
    });
  });
}

initCatalogueEditors();
document.addEventListener('astro:page-load', initCatalogueEditors);
