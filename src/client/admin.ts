function campaignRoot(node: Element | null): HTMLElement | null {
  return node?.closest<HTMLElement>('[data-campaign-builder]') ?? null;
}

function campaignFieldValue(root: HTMLElement, selector: string): string {
  const field = root.querySelector<HTMLInputElement>(selector);
  return field?.value.trim() ?? '';
}

function syncCampaign(root: HTMLElement): string {
  const origin = root.dataset.origin || window.location.origin;
  const path = root.querySelector<HTMLSelectElement>('[data-campaign-path]')?.value || '/';
  const params = new URLSearchParams();
  const source = campaignFieldValue(root, '[data-campaign-source]');
  const medium = campaignFieldValue(root, '[data-campaign-medium]');
  const name = campaignFieldValue(root, '[data-campaign-name]');

  if (source) params.set('utm_source', source);
  if (medium) params.set('utm_medium', medium);
  if (name) params.set('utm_campaign', name);

  const query = params.toString();
  const url = `${origin}${path}${query ? `?${query}` : ''}`;
  const output = root.querySelector<HTMLInputElement>('[data-campaign-output]');
  if (output) output.value = url;
  return url;
}

function applyCampaignPreset(preset: HTMLElement): void {
  const root = campaignRoot(preset);
  if (!root) return;

  const source = root.querySelector<HTMLInputElement>('[data-campaign-source]');
  const medium = root.querySelector<HTMLInputElement>('[data-campaign-medium]');
  if (source && preset.dataset.source) source.value = preset.dataset.source;
  if (medium && preset.dataset.medium) medium.value = preset.dataset.medium;

  root.querySelectorAll<HTMLElement>('[data-campaign-preset]').forEach((chip) => {
    chip.classList.toggle('is-active', chip === preset);
  });

  syncCampaign(root);
}

function copyCampaignLink(button: HTMLElement): void {
  const root = campaignRoot(button);
  if (!root) return;

  const url = syncCampaign(root);
  const output = root.querySelector<HTMLInputElement>('[data-campaign-output]');
  const label = button.querySelector<HTMLElement>('[data-copy-label]');

  const showLabel = (text: string, delay: number) => {
    if (label) label.textContent = text;
    window.setTimeout(() => {
      if (label) label.textContent = 'Copy link';
    }, delay);
  };

  const confirmCopy = () => {
    button.classList.add('is-copied');
    showLabel('Copied!', 1800);
    window.setTimeout(() => button.classList.remove('is-copied'), 1800);
  };

  const selectForManualCopy = () => {
    output?.focus();
    output?.select();
    showLabel('Press Ctrl+C', 3000);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(confirmCopy).catch(selectForManualCopy);
  } else {
    selectForManualCopy();
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const toggle = target.closest<HTMLElement>('[data-admin-toggle]');
  if (toggle) {
    document.getElementById('adminShell')?.classList.toggle('sidebar-open');
    return;
  }

  const funnelStage = target.closest<HTMLElement>('[data-funnel-stage]');
  if (funnelStage) {
    const open = funnelStage.classList.toggle('is-open');
    funnelStage.setAttribute('aria-expanded', open ? 'true' : 'false');
    return;
  }

  const preset = target.closest<HTMLElement>('[data-campaign-preset]');
  if (preset) {
    applyCampaignPreset(preset);
    return;
  }

  const copyButton = target.closest<HTMLElement>('[data-campaign-copy]');
  if (copyButton) {
    copyCampaignLink(copyButton);
    return;
  }

  const navLink = target.closest<HTMLElement>('.admin-nav a');
  if (navLink && window.innerWidth <= 860) {
    document.getElementById('adminShell')?.classList.remove('sidebar-open');
  }

  const confirmTarget = target.closest<HTMLElement>('[data-confirm]');
  if (confirmTarget) {
    const message = confirmTarget.dataset.confirm || 'Are you sure?';
    if (!window.confirm(message)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  // Dropzone clear
  const clearBtn = target.closest<HTMLElement>('[data-dropzone-clear]');
  if (clearBtn) {
    const dropzone = clearBtn.closest<HTMLElement>('[data-image-dropzone]');
    if (dropzone) resetDropzone(dropzone);
    return;
  }

  // Menu section edit toggle
  const editSectionBtn = target.closest<HTMLElement>('[data-edit-section-btn]');
  if (editSectionBtn) {
    const section = editSectionBtn.closest<HTMLElement>('.menu-admin-section');
    section?.classList.toggle('is-editing-section');
    const input = section?.querySelector<HTMLInputElement>('.menu-admin-edit-form input[name="title"]');
    if (section?.classList.contains('is-editing-section')) input?.focus();
    return;
  }

  const cancelSectionBtn = target.closest<HTMLElement>('[data-cancel-section-btn]');
  if (cancelSectionBtn) {
    const section = cancelSectionBtn.closest<HTMLElement>('.menu-admin-section');
    section?.classList.remove('is-editing-section');
    return;
  }

  // Menu item edit toggle
  const editItemBtn = target.closest<HTMLElement>('[data-edit-item-btn]');
  if (editItemBtn) {
    const item = editItemBtn.closest<HTMLElement>('.menu-admin-item');
    item?.classList.toggle('is-editing-item');
    const input = item?.querySelector<HTMLInputElement>('.item-edit-input');
    if (item?.classList.contains('is-editing-item')) {
      input?.focus();
      input?.select();
    }
    return;
  }

  const cancelItemBtn = target.closest<HTMLElement>('[data-cancel-item-btn]');
  if (cancelItemBtn) {
    const item = cancelItemBtn.closest<HTMLElement>('.menu-admin-item');
    item?.classList.remove('is-editing-item');
    return;
  }

  // Copy compliance links for payment gateway
  const copyComplianceBtn = target.closest<HTMLElement>('[data-copy-compliance-links]');
  if (copyComplianceBtn) {
    const origin = window.location.origin;
    const text = [
      `Terms of Service: ${origin}/policies#terms`,
      `Privacy Policy: ${origin}/policies#privacy`,
      `Refund & Cancellation Policy (5-7 business days): ${origin}/policies#cancellations`,
      `Service Delivery & Fulfillment: ${origin}/policies#fulfillment`,
      `Grievance Redressal Officer: ${origin}/policies#grievance`,
    ].join('\n');
    const label = copyComplianceBtn.querySelector<HTMLElement>('[data-copy-pg-label]');
    navigator.clipboard?.writeText(text).then(() => {
      if (label) {
        const orig = label.textContent;
        label.textContent = 'Copied 5 PG URLs to clipboard!';
        window.setTimeout(() => {
          label.textContent = orig;
        }, 2500);
      }
    });
    return;
  }
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedDropzoneFiles(dropzone: HTMLElement, files: FileList | null): File[] {
  if (!files || files.length === 0) return [];

  const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
  if (dropzone.dataset.multiple !== 'true') return images.slice(0, 1);

  const maxFiles = Number.parseInt(dropzone.dataset.maxFiles ?? '', 10);
  return Number.isFinite(maxFiles) && maxFiles > 0 ? images.slice(0, maxFiles) : images;
}

function renderDropzoneFileList(dropzone: HTMLElement, files: File[]): void {
  const list = dropzone.querySelector<HTMLElement>('[data-multi-list]');
  if (!list) return;

  list.replaceChildren();

  if (dropzone.dataset.multiple !== 'true' || files.length <= 1) {
    list.style.display = 'none';
    return;
  }

  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'admin-dropzone-file';

    const thumb = document.createElement('img');
    thumb.className = 'admin-dropzone-file-thumb';
    thumb.src = URL.createObjectURL(file);
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'admin-dropzone-file-name';
    name.textContent = file.name;

    const size = document.createElement('span');
    size.className = 'admin-dropzone-file-size';
    size.textContent = formatFileSize(file.size);

    row.append(thumb, name, size);
    list.append(row);
  }

  list.style.display = 'flex';
}

function handleDropzoneFiles(dropzone: HTMLElement, files: FileList | null): void {
  const selected = selectedDropzoneFiles(dropzone, files);
  if (selected.length === 0) return;

  const fileInput = dropzone.querySelector<HTMLInputElement>('.admin-dropzone-input');
  if (fileInput) {
    const dataTransfer = new DataTransfer();
    for (const file of selected) dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
  }

  const previewContainer = dropzone.querySelector<HTMLElement>('[data-preview-container]');
  const previewImg = dropzone.querySelector<HTMLImageElement>('[data-preview-img]');
  const promptContainer = dropzone.querySelector<HTMLElement>('[data-prompt-container]');
  const statusBar = dropzone.querySelector<HTMLElement>('[data-status-bar]');
  const statusName = dropzone.querySelector<HTMLElement>('[data-status-name]');
  const statusSize = dropzone.querySelector<HTMLElement>('[data-status-size]');
  const previewBadge = dropzone.querySelector<HTMLElement>('[data-preview-badge]');
  const totalSize = selected.reduce((sum, file) => sum + file.size, 0);

  if (previewImg) {
    previewImg.src = URL.createObjectURL(selected[0]);
  }

  if (previewBadge) {
    previewBadge.textContent = selected.length > 1 ? `${selected.length} photos selected` : 'Selected photo';
  }
  if (previewContainer) previewContainer.style.display = 'block';
  if (promptContainer) promptContainer.style.display = 'none';

  if (statusBar && statusName && statusSize) {
    statusName.textContent = selected.length > 1 ? `${selected.length} images` : selected[0].name;
    statusSize.textContent = formatFileSize(totalSize);
    statusBar.style.display = 'flex';
  }

  renderDropzoneFileList(dropzone, selected);
}

function resetDropzone(dropzone: HTMLElement): void {
  const fileInput = dropzone.querySelector<HTMLInputElement>('.admin-dropzone-input');
  if (fileInput) fileInput.value = '';

  const previewImg = dropzone.querySelector<HTMLImageElement>('[data-preview-img]');
  const initialSrc = previewImg?.dataset.initialSrc;
  const previewContainer = dropzone.querySelector<HTMLElement>('[data-preview-container]');
  const promptContainer = dropzone.querySelector<HTMLElement>('[data-prompt-container]');
  const statusBar = dropzone.querySelector<HTMLElement>('[data-status-bar]');
  const previewBadge = dropzone.querySelector<HTMLElement>('[data-preview-badge]');
  const fileList = dropzone.querySelector<HTMLElement>('[data-multi-list]');

  if (fileList) {
    fileList.replaceChildren();
    fileList.style.display = 'none';
  }

  if (initialSrc) {
    if (previewImg) previewImg.src = initialSrc;
    if (previewBadge) previewBadge.textContent = 'Current photo';
    if (previewContainer) previewContainer.style.display = 'block';
    if (promptContainer) promptContainer.style.display = 'none';
  } else {
    if (previewImg) previewImg.src = '';
    if (previewContainer) previewContainer.style.display = 'none';
    if (promptContainer) promptContainer.style.display = 'flex';
  }

  if (statusBar) statusBar.style.display = 'none';
}

['dragenter', 'dragover'].forEach((eventName) => {
  document.addEventListener(eventName, (e) => {
    const dropzone = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone]');
    if (dropzone) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    }
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  document.addEventListener(eventName, (e) => {
    const dropzone = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone]');
    if (dropzone) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
      if (eventName === 'drop') {
        const dt = (e as DragEvent).dataTransfer;
        if (dt?.files) handleDropzoneFiles(dropzone, dt.files);
      }
    }
  });
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement | null;
  const root = target?.closest<HTMLElement>('[data-campaign-builder]') ?? null;
  if (root) syncCampaign(root);
});

document.addEventListener('submit', async (event) => {
  const form = (event.target as HTMLElement | null)?.closest?.('form[data-ajax]') as HTMLFormElement | null;
  if (!form) return;
  event.preventDefault();

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) submit.disabled = true;

  try {
    const response = await fetch(form.getAttribute('action') ?? window.location.href, {
      method: 'POST',
      body: new FormData(form),
      headers: { accept: 'application/json' },
    });
    const payload = (await response.json()) as {
      status?: string;
      message?: string;
      data?: { active?: boolean; title?: string };
    };
    if (!response.ok || payload.status !== 'ok') {
      throw new Error(payload.message ?? 'The change could not be saved.');
    }

    const badge = form.closest('.admin-row-actions')?.querySelector<HTMLElement>('.badge');
    if (badge && typeof payload.data?.active === 'boolean') {
      const active = payload.data.active;
      badge.textContent = active ? 'live' : 'hidden';
      badge.classList.toggle('badge-success', active);
      badge.classList.toggle('badge-muted', !active);
    }

    if (typeof payload.data?.title === 'string') {
      const caption = form.querySelector<HTMLInputElement>('input[name="title"]');
      if (caption) caption.value = payload.data.title;
      form.classList.add('is-saved');
      window.setTimeout(() => form.classList.remove('is-saved'), 1600);
    }
  } catch {
    window.location.reload();
    return;
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  const campaign = target.closest<HTMLElement>('[data-campaign-builder]');
  if (campaign) syncCampaign(campaign);

  if (target instanceof HTMLInputElement && target.type === 'file') {
    const dropzone = target.closest<HTMLElement>('[data-image-dropzone]');
    if (dropzone) {
      handleDropzoneFiles(dropzone, target.files);
    } else {
      const label = target.closest('.field')?.querySelector<HTMLElement>('[data-file-name]');
      if (label) label.textContent = target.files?.[0]?.name ?? 'No file chosen';
    }
  }

  if (target instanceof HTMLSelectElement && target.hasAttribute('data-auto-submit')) {
    target.form?.submit();
  }
});
