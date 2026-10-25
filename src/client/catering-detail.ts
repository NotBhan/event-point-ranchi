import { readCart, setCatering, type CartMenuItem } from './cart';
import { mountSummary } from './summary';

const root = document.querySelector<HTMLElement>('[data-catering-detail]');

if (root) {
  const packageId = root.dataset.id ?? '';
  const packageName = root.dataset.name ?? 'Catering package';
  const basePrice = Number(root.dataset.price ?? 0);

  const tierCards = Array.from(document.querySelectorAll<HTMLElement>('[data-tier]'));
  const guestInput = document.querySelector<HTMLInputElement>('[data-guest-input]');
  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-menu-checkbox]'));

  const stored = readCart().catering;
  let guestCount = stored?.id === packageId ? stored.guestCount : Number(tierCards[0]?.dataset.guest ?? 100);
  let pricePerPlate = stored?.id === packageId ? stored.pricePerPlate : Number(tierCards[0]?.dataset.price ?? basePrice);

  function paintTiers(): void {
    let matchedPrice: number | null = null;
    for (const card of tierCards) {
      const active = Number(card.dataset.guest) === guestCount;
      card.classList.toggle('active', active);
      if (active) matchedPrice = Number(card.dataset.price ?? basePrice);
    }
    pricePerPlate = matchedPrice ?? basePrice;
    if (guestInput) guestInput.value = String(guestCount);
  }

  function selectedItems(): CartMenuItem[] {
    return checkboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => ({
        section: checkbox.dataset.section ?? '',
        item: checkbox.dataset.item ?? '',
      }));
  }

  function updateCounts(): void {
    const sections = new Set(checkboxes.map((checkbox) => checkbox.dataset.section ?? ''));
    for (const section of sections) {
      const sectionBoxes = checkboxes.filter((checkbox) => checkbox.dataset.section === section);
      const checked = sectionBoxes.filter((checkbox) => checkbox.checked).length;
      const max = Number(sectionBoxes[0]?.dataset.max ?? 0);
      const badge = document.querySelector<HTMLElement>(`[data-section-count="${CSS.escape(section)}"]`);
      if (badge) {
        badge.textContent = `${checked} / ${max} selected`;
        badge.classList.toggle('limit-reached', max > 0 && checked >= max);
      }
    }
  }

  function syncCatering(): void {
    const items = selectedItems();
    setCatering({
      id: packageId,
      name: packageName,
      guestCount,
      pricePerPlate,
      selectedItems: items,
      total: guestCount * pricePerPlate,
    });
    updateCounts();
  }

  function setGuestCount(next: number): void {
    guestCount = Math.max(1, Math.min(10000, Math.floor(next) || 1));
    paintTiers();
    syncCatering();
  }

  for (const card of tierCards) {
    card.addEventListener('click', () => {
      guestCount = Number(card.dataset.guest ?? 100);
      pricePerPlate = Number(card.dataset.price ?? basePrice);
      paintTiers();
      syncCatering();
    });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-guest-step]').forEach((button) => {
    button.addEventListener('click', () => setGuestCount(guestCount + Number(button.dataset.guestStep ?? 0)));
  });

  guestInput?.addEventListener('input', () => {
    const next = Number.parseInt(guestInput.value, 10);
    if (Number.isFinite(next)) setGuestCount(next);
  });

  if (stored?.id === packageId && stored.selectedItems.length > 0) {
    const selection = new Set(stored.selectedItems.map((item) => `${item.section}|${item.item}`));
    for (const checkbox of checkboxes) {
      checkbox.checked = selection.has(`${checkbox.dataset.section}|${checkbox.dataset.item}`);
      checkbox.closest('.menu-item-tile')?.classList.toggle('checked', checkbox.checked);
    }
  }

  for (const checkbox of checkboxes) {
    checkbox.addEventListener('change', () => {
      const section = checkbox.dataset.section ?? '';
      const max = Number(checkbox.dataset.max ?? 0);
      const checkedInSection = checkboxes.filter(
        (entry) => entry.dataset.section === section && entry.checked,
      ).length;

      if (checkbox.checked && max > 0 && checkedInSection > max) {
        checkbox.checked = false;
        window.alert(`You can select up to ${max} item${max === 1 ? '' : 's'} from "${section}".`);
      }

      checkbox.closest('.menu-item-tile')?.classList.toggle('checked', checkbox.checked);
      syncCatering();
    });
  }

  paintTiers();
  updateCounts();
  syncCatering();
  mountSummary({ primary: 'catering' });
}
