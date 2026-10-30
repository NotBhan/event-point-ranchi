import {
  CART_EVENT,
  addRoom,
  cartCount,
  cartTotal,
  clearCart,
  formatPaise,
  readCart,
  removeCatering,
  removeFurniture,
  removeHall,
  removeRoom,
  removeService,
  setFurniture,
  setHall,
  setRoomQuantity,
  setStage,
  updateCateringGuests,
} from './cart';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sidebarItem(kind: string, id: string, title: string, sub: string, price: number, qtyHtml = ''): string {
  return `
    <div class="cart-item">
      <button type="button" class="cart-item-remove" data-remove-kind="${esc(kind)}" data-remove-id="${esc(id)}" aria-label="Remove ${esc(title)}">&times;</button>
      <div class="cart-item-kind">${esc(kind)}</div>
      <div class="cart-item-title">${esc(title)}</div>
      ${sub ? `<div class="cart-item-sub">${esc(sub)}</div>` : ''}
      <div class="cart-item-row">
        ${qtyHtml}
        <div class="cart-item-price">${formatPaise(price)}</div>
      </div>
    </div>`;
}

function updateCounts(): void {
  const count = cartCount();
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((element) => {
    element.textContent = String(count);
  });
}

function renderSidebar(): void {
  const body = document.querySelector<HTMLElement>('[data-cart-body]');
  const footer = document.querySelector<HTMLElement>('[data-cart-footer]');
  const total = document.querySelector<HTMLElement>('[data-cart-total]');
  if (!body) return;

  const cart = readCart();

  if (total) total.textContent = formatPaise(cartTotal(cart));
  if (footer) footer.hidden = cartCount(cart) === 0;

  if (cartCount(cart) === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>
        <p>Your cart is empty</p>
        <small>Browse halls, catering and decor to build your event.</small>
      </div>`;
    return;
  }

  let html = '';

  if (cart.hall) {
    html += sidebarItem(
      'Hall',
      cart.hall.id,
      cart.hall.name,
      cart.hall.capacity ? `Capacity ${cart.hall.capacity} guests` : '',
      cart.hall.price,
    );
  }

  for (const room of cart.rooms) {
    html += sidebarItem(
      'Room',
      room.id,
      room.name,
      `${room.quantity} night${room.quantity > 1 ? 's' : ''} × ${formatPaise(room.price)}`,
      room.price * room.quantity,
      `<div class="qty">
        <button type="button" data-room-step="-1" data-room-id="${esc(room.id)}" aria-label="One less room">−</button>
        <span>${room.quantity}</span>
        <button type="button" data-room-step="1" data-room-id="${esc(room.id)}" aria-label="One more room">+</button>
      </div>`,
    );
  }

  if (cart.catering) {
    html += sidebarItem(
      'Catering',
      cart.catering.id,
      cart.catering.name,
      `${cart.catering.guestCount} plates × ${formatPaise(cart.catering.pricePerPlate)}`,
      cart.catering.total,
      `<div class="qty">
        <button type="button" data-catering-step="-10" aria-label="Ten fewer plates">−10</button>
        <button type="button" data-catering-step="-1" aria-label="One fewer plate">−</button>
        <span>${cart.catering.guestCount}</span>
        <button type="button" data-catering-step="1" aria-label="One more plate">+</button>
        <button type="button" data-catering-step="10" aria-label="Ten more plates">+10</button>
      </div>`,
    );
  }

  if (cart.stage) {
    html += sidebarItem('Stage', cart.stage.id, cart.stage.name, 'Stage decoration', cart.stage.price);
  }

  for (const item of cart.furniture) {
    html += sidebarItem(
      'Furniture',
      item.id,
      item.name,
      `${item.quantity} × ${formatPaise(item.price)}`,
      item.price * item.quantity,
      `<div class="qty">
        <button type="button" data-furniture-step="-1" data-furniture-id="${esc(item.id)}" aria-label="One fewer">−</button>
        <span>${item.quantity}</span>
        <button type="button" data-furniture-step="1" data-furniture-id="${esc(item.id)}" aria-label="One more">+</button>
      </div>`,
    );
  }

  for (const service of cart.services) {
    html += sidebarItem('Service', service.id, service.name, service.category, service.price);
  }

  body.innerHTML = html;
}

function openSidebar(): void {
  document.getElementById('cartSidebar')?.classList.add('open');
  document.querySelector('[data-cart-backdrop]')?.classList.add('open');
  document.getElementById('cartSidebar')?.setAttribute('aria-hidden', 'false');
}

function closeSidebar(): void {
  document.getElementById('cartSidebar')?.classList.remove('open');
  document.querySelector('[data-cart-backdrop]')?.classList.remove('open');
  document.getElementById('cartSidebar')?.setAttribute('aria-hidden', 'true');
}

function handleRemove(kind: string, id: string): void {
  if (kind === 'Hall') removeHall();
  if (kind === 'Room') removeRoom(id);
  if (kind === 'Catering') removeCatering();
  if (kind === 'Stage') setStage(null);
  if (kind === 'Furniture') removeFurniture(id);
  if (kind === 'Service') removeService(id);
}

function refresh(): void {
  updateCounts();
  renderSidebar();
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;

  if (target.closest('[data-open-cart]')) {
    event.preventDefault();
    openSidebar();
    return;
  }

  if (target.closest('[data-close-cart]')) {
    event.preventDefault();
    closeSidebar();
    return;
  }

  if (target.closest('[data-clear-cart]')) {
    event.preventDefault();
    if (window.confirm('Clear your event cart?')) clearCart();
    return;
  }

  const removeButton = target.closest<HTMLElement>('[data-remove-kind]');
  if (removeButton) {
    handleRemove(removeButton.dataset.removeKind ?? '', removeButton.dataset.removeId ?? '');
    return;
  }

  const roomButton = target.closest<HTMLElement>('[data-room-step]');
  if (roomButton) {
    const cart = readCart();
    const room = cart.rooms.find((entry) => entry.id === roomButton.dataset.roomId);
    if (room) setRoomQuantity(room.id, room.quantity + Number(roomButton.dataset.roomStep));
    return;
  }

  const cateringButton = target.closest<HTMLElement>('[data-catering-step]');
  if (cateringButton) {
    const cart = readCart();
    if (cart.catering) updateCateringGuests(cart.catering.guestCount + Number(cateringButton.dataset.cateringStep));
    return;
  }

  const furnitureButton = target.closest<HTMLElement>('[data-furniture-step]');
  if (furnitureButton) {
    const cart = readCart();
    const item = cart.furniture.find((entry) => entry.id === furnitureButton.dataset.furnitureId);
    if (item) {
      const next = item.quantity + Number(furnitureButton.dataset.furnitureStep);
      const updated = cart.furniture
        .map((entry) => (entry.id === item.id ? { ...entry, quantity: next } : entry))
        .filter((entry) => entry.quantity > 0);
      setFurniture(updated);
    }
    return;
  }

  const addHallButton = target.closest<HTMLElement>('[data-add-hall]');
  if (addHallButton) {
    event.preventDefault();
    setHall({
      id: addHallButton.dataset.id ?? '',
      name: addHallButton.dataset.name ?? 'Selected hall',
      price: Number(addHallButton.dataset.price ?? 0),
      capacity: addHallButton.dataset.capacity,
    });
    openSidebar();
    return;
  }

  const addRoomButton = target.closest<HTMLElement>('[data-add-room]');
  if (addRoomButton) {
    event.preventDefault();
    addRoom({
      id: addRoomButton.dataset.id ?? '',
      name: addRoomButton.dataset.name ?? 'Room',
      price: Number(addRoomButton.dataset.price ?? 0),
      quantity: 1,
    });
    openSidebar();
    return;
  }

  const accordionTitle = target.closest<HTMLElement>('.accordion-title');
  if (accordionTitle) {
    const box = accordionTitle.closest<HTMLElement>('.summary-box');
    box?.classList.toggle('active');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSidebar();
});

window.addEventListener(CART_EVENT, refresh);
window.addEventListener('storage', (event) => {
  if (event.key === 'royalEventCart:v2') refresh();
});

document.addEventListener('DOMContentLoaded', refresh);
refresh();
