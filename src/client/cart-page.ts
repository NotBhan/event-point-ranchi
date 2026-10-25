import { CART_EVENT, cartCount, cartTotal, formatPaise, readCart, type CartState } from './cart';

const rootElement = document.querySelector<HTMLElement>('[data-cart-page]');

if (rootElement) {
  const root: HTMLElement = rootElement;
  function esc(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function line(
    kind: string,
    id: string,
    title: string,
    sub: string,
    price: number,
    controls: string,
  ): string {
    return `
      <div class="cart-line">
        <div class="cart-line-main">
          <span class="cart-line-kind">${esc(kind)}</span>
          <h3>${esc(title)}</h3>
          ${sub ? `<p>${esc(sub)}</p>` : ''}
        </div>
        <div class="cart-line-controls">
          ${controls}
          <div class="cart-line-price">${formatPaise(price)}</div>
          <button type="button" class="icon-btn danger" data-remove-kind="${esc(kind)}" data-remove-id="${esc(id)}" aria-label="Remove ${esc(title)}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`;
  }

  function section(title: string, body: string): string {
    return `
      <section class="cart-group">
        <h2>${esc(title)}</h2>
        <div class="cart-group-body">${body}</div>
      </section>`;
  }

  function stepper(kind: string, id: string, quantity: number, step = 1): string {
    const attr = kind === 'room' ? 'data-room-step' : kind === 'furniture' ? 'data-furniture-step' : 'data-catering-step';
    const idAttr = kind === 'room' ? `data-room-id="${esc(id)}"` : kind === 'furniture' ? `data-furniture-id="${esc(id)}"` : '';
    return `
      <div class="qty">
        <button type="button" ${attr}="${-step}" ${idAttr} aria-label="Decrease">−</button>
        <span>${quantity}</span>
        <button type="button" ${attr}="${step}" ${idAttr} aria-label="Increase">+</button>
      </div>`;
  }

  function render(cart: CartState): void {
    if (cartCount(cart) === 0) {
      root.innerHTML = `
        <div class="empty-state" style="padding:80px 24px;">
          <div class="empty-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>
          </div>
          <h3>Your event cart is empty</h3>
          <p>Browse our venues, rooms and menus to start building your celebration.</p>
          <div class="flex-center gap-3 mt-6 wrap">
            <a href="/halls" class="btn btn-primary">Browse halls</a>
            <a href="/catering" class="btn btn-secondary">View catering</a>
          </div>
        </div>`;
      return;
    }

    let items = '';

    if (cart.hall) {
      items += section(
        'Hall',
        line(
          'Hall',
          cart.hall.id,
          cart.hall.name,
          cart.hall.capacity ? `Capacity ${cart.hall.capacity} guests` : 'Venue reservation',
          cart.hall.price,
          '',
        ),
      );
    }

    if (cart.rooms.length) {
      items += section(
        'Rooms & suites',
        cart.rooms
          .map((room) =>
            line(
              'Room',
              room.id,
              room.name,
              `${room.quantity} night${room.quantity > 1 ? 's' : ''} × ${formatPaise(room.price)}`,
              room.price * room.quantity,
              stepper('room', room.id, room.quantity),
            ),
          )
          .join(''),
      );
    }

    if (cart.catering) {
      const grouped = new Map<string, string[]>();
      cart.catering.selectedItems.forEach((item) => {
        if (!grouped.has(item.section)) grouped.set(item.section, []);
        grouped.get(item.section)?.push(item.item);
      });
      const menu = Array.from(grouped.entries())
        .map(([sectionName, entries]) => `<li><strong>${esc(sectionName)}</strong> — ${esc(entries.join(', '))}</li>`)
        .join('');
      items += section(
        'Catering',
        `${line(
          'Catering',
          cart.catering.id,
          cart.catering.name,
          `${cart.catering.guestCount} plates × ${formatPaise(cart.catering.pricePerPlate)}`,
          cart.catering.total,
          stepper('catering', cart.catering.id, cart.catering.guestCount, 10),
        )}${menu ? `<ul class="cart-menu-list">${menu}</ul>` : ''}`,
      );
    }

    if (cart.stage) {
      items += section(
        'Stage decoration',
        line('Stage', cart.stage.id, cart.stage.name, 'Stage design & setup', cart.stage.price, ''),
      );
    }

    if (cart.furniture.length) {
      items += section(
        'Furniture & seating',
        cart.furniture
          .map((item) =>
            line(
              'Furniture',
              item.id,
              item.name,
              `${item.quantity} × ${formatPaise(item.price)}`,
              item.price * item.quantity,
              stepper('furniture', item.id, item.quantity),
            ),
          )
          .join(''),
      );
    }

    if (cart.services.length) {
      items += section(
        'Additional services',
        cart.services
          .map((service) => line('Service', service.id, service.name, service.category, service.price, ''))
          .join(''),
      );
    }

    const total = cartTotal(cart);

    root.innerHTML = `
      <div class="cart-page-grid">
        <div class="cart-page-items">${items}</div>
        <aside class="cart-page-summary">
          <h2>Order summary</h2>
          <div class="summary-row">
            <div class="summary-left"><h4>Items</h4></div>
            <div class="summary-price">${cartCount(cart)}</div>
          </div>
          <div class="summary-row">
            <div class="summary-left"><h4>Subtotal</h4></div>
            <div class="summary-price">${formatPaise(total)}</div>
          </div>
          <div class="cart-summary-note">
            Final pricing is verified against our live catalogue when you submit the booking.
          </div>
          <div class="summary-total">
            <span>Total estimate</span>
            <strong>${formatPaise(total)}</strong>
          </div>
          <div class="cart-actions mt-4">
            <a href="/booking/overview" class="btn btn-primary btn-block">Continue to booking</a>
            <a href="/halls" class="btn btn-secondary btn-block">Keep browsing</a>
          </div>
          <button type="button" class="btn-clear" data-clear-cart>Clear entire cart</button>
        </aside>
      </div>`;
  }

  render(readCart());
  window.addEventListener(CART_EVENT, () => render(readCart()));
  window.addEventListener('storage', (event) => {
    if (event.key === 'royalEventCart:v2') render(readCart());
  });
}
