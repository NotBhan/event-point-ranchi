import {
  REQUIREMENTS_EVENT,
  REQUIREMENTS_STORAGE_KEY,
  addEquipment,
  addMandap,
  addStage,
  getRequirementsCount,
  type DimensionSet,
} from './requirements';

function updateCounts(): void {
  const count = getRequirementsCount();
  document.querySelectorAll<HTMLElement>('[data-requirements-count]').forEach((element) => {
    element.textContent = count > 99 ? '99+' : String(count);
    element.classList.toggle('is-empty', count === 0);
  });
}

function toast(message: string): void {
  const stack = document.getElementById('toastStack');
  if (!stack) return;

  const element = document.createElement('div');
  element.className = 'toast success';
  element.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';

  const text = document.createElement('span');
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = '&times;';

  element.append(icon, text, close);
  stack.append(element);

  const dismiss = (): void => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(-6px)';
    element.style.transition = 'opacity .18s ease, transform .18s ease';
    window.setTimeout(() => element.remove(), 190);
  };

  close.addEventListener('click', dismiss);
  window.setTimeout(dismiss, 4200);
}

function markAdded(button: HTMLElement): void {
  if (button.dataset.adding === 'true') return;
  button.dataset.adding = 'true';
  button.classList.add('is-added');
  const original = button.innerHTML;
  button.textContent = 'Added to requirements';
  button.setAttribute('aria-pressed', 'true');

  window.setTimeout(() => {
    button.classList.remove('is-added');
    button.innerHTML = original;
    button.setAttribute('aria-pressed', 'false');
    button.dataset.adding = 'false';
  }, 2200);
}

function readDimensions(button: HTMLElement): DimensionSet | null {
  const scope = button.closest<HTMLElement>('[data-requirement-form]') ?? document;
  const length = Number(scope.querySelector<HTMLInputElement>('[data-dim-length]')?.value ?? 0);
  const width = Number(scope.querySelector<HTMLInputElement>('[data-dim-width]')?.value ?? 0);
  const height = Number(scope.querySelector<HTMLInputElement>('[data-dim-height]')?.value ?? 0);

  if (length > 0 && width > 0 && height > 0) {
    return { length, width, height, unit: 'ft' };
  }
  return null;
}

function noteFor(button: HTMLElement): string {
  const scope = button.closest<HTMLElement>('[data-requirement-form]') ?? document;
  return scope.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-dimension-note]')?.value.trim() ?? '';
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  const stepButton = target.closest<HTMLElement>('[data-qty-step]');
  if (stepButton) {
    const card = stepButton.closest<HTMLElement>('[data-equipment-card]');
    const input = card?.querySelector<HTMLInputElement>('[data-equipment-qty]');
    if (input) {
      const min = Math.max(1, Number(input.min || 1));
      const max = input.max ? Number(input.max) : Number.POSITIVE_INFINITY;
      const next = Number(input.value || min) + Number(stepButton.dataset.qtyStep ?? 0);
      input.value = String(Math.min(max, Math.max(min, next)));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    event.preventDefault();
    return;
  }

  const mandapButton = target.closest<HTMLElement>('[data-add-mandap]');
  if (mandapButton) {
    event.preventDefault();
    const dataset = mandapButton.dataset;
    addMandap({
      id: dataset.id ?? '',
      slug: dataset.slug ?? '',
      name: dataset.name ?? 'Selected mandap',
      category: dataset.category ?? 'Mandap',
      image: dataset.image ?? '',
      standard: {
        length: Number(dataset.length ?? 0),
        width: Number(dataset.width ?? 0),
        height: Number(dataset.height ?? 0),
        unit: dataset.unit ?? 'ft',
      },
      requested: readDimensions(mandapButton),
      note: noteFor(mandapButton),
    });
    updateCounts();
    markAdded(mandapButton);
    toast(`${dataset.name ?? 'Mandap'} added to your requirements.`);
    return;
  }

  const stageButton = target.closest<HTMLElement>('[data-add-stage]');
  if (stageButton) {
    event.preventDefault();
    const dataset = stageButton.dataset;
    addStage({
      id: dataset.id ?? '',
      slug: dataset.slug ?? '',
      name: dataset.name ?? 'Selected stage',
      category: dataset.category ?? 'Stage',
      image: dataset.image ?? '',
      standard: {
        length: Number(dataset.length ?? 0),
        width: Number(dataset.width ?? 0),
        height: Number(dataset.height ?? 0),
        unit: dataset.unit ?? 'ft',
      },
      requested: readDimensions(stageButton),
      note: noteFor(stageButton),
    });
    updateCounts();
    markAdded(stageButton);
    toast(`${dataset.name ?? 'Stage design'} added to your requirements.`);
    return;
  }

  const equipmentButton = target.closest<HTMLElement>('[data-add-equipment]');
  if (equipmentButton) {
    event.preventDefault();
    const dataset = equipmentButton.dataset;
    const card = equipmentButton.closest<HTMLElement>('[data-equipment-card]');
    const quantityInput = card?.querySelector<HTMLInputElement>('[data-equipment-qty]');
    const minQuantity = Math.max(1, Number(dataset.min ?? 1));
    const requestedQuantity = quantityInput ? Number(quantityInput.value) : Number(dataset.quantity ?? minQuantity);
    const quantity = Math.max(minQuantity, Number.isFinite(requestedQuantity) ? requestedQuantity : minQuantity);

    addEquipment({
      id: dataset.id ?? '',
      slug: dataset.slug ?? '',
      name: dataset.name ?? 'Equipment item',
      category: dataset.category ?? 'Equipment',
      categorySlug: dataset.categorySlug ?? '',
      unit: dataset.unit ?? 'piece',
      specifications: dataset.specifications ?? '',
      image: dataset.image ?? '',
      minQuantity,
      quantity,
    });
    updateCounts();
    markAdded(equipmentButton);
    toast(`${quantity} × ${dataset.name ?? 'Equipment'} added to your requirements.`);
  }
});

window.addEventListener(REQUIREMENTS_EVENT, updateCounts);
window.addEventListener('storage', (event) => {
  if (event.key === REQUIREMENTS_STORAGE_KEY) updateCounts();
});

document.addEventListener('DOMContentLoaded', updateCounts);
document.addEventListener('astro:page-load', updateCounts);
updateCounts();
