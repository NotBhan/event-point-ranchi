import { addRoom, readCart, removeRoom, setRoomQuantity } from './cart';
import { mountSummary } from './summary';

const root = document.querySelector<HTMLElement>('[data-rooms]');

if (root) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-room-card]'));
  const cart = readCart();

  for (const card of cards) {
    const id = card.dataset.id ?? '';
    const name = card.dataset.name ?? 'Room';
    const price = Number(card.dataset.price ?? 0);
    const max = Number(card.dataset.total ?? 99);
    const display = card.querySelector<HTMLElement>('[data-room-qty]');
    const stored = cart.rooms.find((room) => room.id === id);
    let quantity = stored?.quantity ?? 0;
    if (display) display.textContent = String(quantity);

    const update = (delta: number): void => {
      quantity = Math.max(0, Math.min(max, quantity + delta));
      if (display) display.textContent = String(quantity);

      const current = readCart().rooms.find((room) => room.id === id);
      if (quantity === 0) {
        if (current) removeRoom(id);
      } else if (current) {
        setRoomQuantity(id, quantity);
      } else {
        addRoom({ id, name, price, quantity });
      }

      card.classList.toggle('selected', quantity > 0);
    };

    card.querySelector('[data-room-plus]')?.addEventListener('click', () => update(1));
    card.querySelector('[data-room-minus]')?.addEventListener('click', () => update(-1));
    card.classList.toggle('selected', quantity > 0);
  }

  mountSummary({ primary: 'room' });
}
