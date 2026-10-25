import {
  readCart,
  setFurniture,
  setHall,
  setServices,
  setStage,
  type CartFurniture,
  type CartService,
} from './cart';
import { mountSummary } from './summary';

const root = document.querySelector<HTMLElement>('[data-hall-detail]');

if (root) {
  const hall = {
    id: root.dataset.id ?? '',
    name: root.dataset.name ?? 'Selected hall',
    price: Number(root.dataset.price ?? 0),
    capacity: root.dataset.capacity,
  };

  if (readCart().hall?.id !== hall.id) setHall(hall);

  const furnitureCards = Array.from(document.querySelectorAll<HTMLElement>('[data-furniture-card]'));

  function syncFurniture(): void {
    const items: CartFurniture[] = [];
    for (const card of furnitureCards) {
      const quantity = Number(card.querySelector<HTMLElement>('[data-furniture-qty]')?.textContent ?? 0);
      if (quantity > 0) {
        items.push({
          id: card.dataset.id ?? '',
          name: card.dataset.name ?? 'Furniture',
          price: Number(card.dataset.price ?? 0),
          quantity,
          total: Number(card.dataset.price ?? 0) * quantity,
        });
      }
    }
    setFurniture(items);
  }

  function setCardQuantity(card: HTMLElement, quantity: number): void {
    const min = Number(card.dataset.min ?? 0);
    const max = Number(card.dataset.max ?? 100);
    const next = Math.max(min, Math.min(max, quantity));
    const display = card.querySelector<HTMLElement>('[data-furniture-qty]');
    if (display) display.textContent = String(next);
  }

  for (const card of furnitureCards) {
    const stored = readCart().furniture.find((item) => item.id === card.dataset.id);
    setCardQuantity(card, stored?.quantity ?? Number(card.dataset.default ?? 0));

    card.querySelector('[data-furniture-plus]')?.addEventListener('click', () => {
      const current = Number(card.querySelector<HTMLElement>('[data-furniture-qty]')?.textContent ?? 0);
      setCardQuantity(card, current + 1);
      syncFurniture();
    });

    card.querySelector('[data-furniture-minus]')?.addEventListener('click', () => {
      const current = Number(card.querySelector<HTMLElement>('[data-furniture-qty]')?.textContent ?? 0);
      setCardQuantity(card, current - 1);
      syncFurniture();
    });
  }

  const stageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-stage-select]'));

  function paintStageSelection(selectedId: string | null): void {
    for (const button of stageButtons) {
      const selected = button.dataset.id === selectedId;
      button.classList.toggle('selected', selected);
      button.closest('.stage-card')?.classList.toggle('selected', selected);
      button.textContent = selected ? 'Selected ✓' : 'Select stage';
    }
  }

  paintStageSelection(readCart().stage?.id ?? null);

  for (const button of stageButtons) {
    button.addEventListener('click', () => {
      const current = readCart().stage;
      if (current?.id === button.dataset.id) {
        setStage(null);
        paintStageSelection(null);
        return;
      }
      setStage({
        id: button.dataset.id ?? '',
        name: button.dataset.name ?? 'Stage',
        price: Number(button.dataset.price ?? 0),
      });
      paintStageSelection(button.dataset.id ?? null);
    });
  }

  const serviceCheckboxes = Array.from(document.querySelectorAll<HTMLInputElement>('[data-service-checkbox]'));

  function syncServices(): void {
    const services: CartService[] = [];
    for (const checkbox of serviceCheckboxes) {
      if (!checkbox.checked) continue;
      services.push({
        id: checkbox.dataset.id ?? '',
        name: checkbox.dataset.name ?? 'Service',
        category: checkbox.dataset.category ?? 'Additional services',
        price: Number(checkbox.dataset.price ?? 0),
      });
    }
    setServices(services);
  }

  const storedServices = new Set(readCart().services.map((service) => service.id));
  for (const checkbox of serviceCheckboxes) {
    checkbox.checked = storedServices.has(checkbox.dataset.id ?? '');
    checkbox.addEventListener('change', syncServices);
  }

  mountSummary({ primary: 'hall' });
}
