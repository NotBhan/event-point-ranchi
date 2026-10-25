import { CART_EVENT, cartTotal, formatPaise, readCart, type CartState } from './cart';

type Primary = 'hall' | 'room' | 'catering' | 'all';

interface SummaryOptions {
  primary?: Primary;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(title: string, sub: string, price: number): string {
  return `
    <div class="summary-row">
      <div class="summary-left">
        <h4>${esc(title)}</h4>
        ${sub ? `<small>${esc(sub)}</small>` : ''}
      </div>
      <div class="summary-price">${formatPaise(price)}</div>
    </div>`;
}

interface Group {
  key: string;
  label: string;
  icon: string;
  total: number;
  body: string;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M2 21h20"/>',
    bed: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M2 16h20"/><path d="M6 10V6h5v4"/>',
    utensils: '<path d="M7 3v8a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3"/><path d="M9 13v8"/><path d="M17 3c-1.5 2-2 4-2 6a3 3 0 0 0 3 3V3"/><path d="M18 12v9"/>',
    chair: '<path d="M6 19v-4h12v4"/><path d="M6 15V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/><path d="M8 19v2M16 19v2"/>',
    theater: '<path d="M4 5h16v8a8 8 0 0 1-16 0z"/><path d="M8 9h.01M16 9h.01"/><path d="M8 14c1 1 2 1.5 4 1.5s3-.5 4-1.5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  };
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths[name] ?? paths.building}</svg>`;
}

function groupsFor(cart: CartState): Record<string, Group> {
  const hallBody = cart.hall
    ? row(cart.hall.name, cart.hall.capacity ? `${cart.hall.capacity} guests` : 'Hall reservation', cart.hall.price)
    : '<div class="summary-row"><div class="summary-left"><small>No hall selected</small></div></div>';

  const roomBody = cart.rooms.length
    ? cart.rooms
        .map((room) => row(room.name, `${room.quantity} × ${formatPaise(room.price)}`, room.price * room.quantity))
        .join('')
    : '<div class="summary-row"><div class="summary-left"><small>No rooms selected</small></div></div>';

  const furnitureBody = cart.furniture.length
    ? cart.furniture
        .map((item) => row(item.name, `${item.quantity} × ${formatPaise(item.price)}`, item.price * item.quantity))
        .join('')
    : '<div class="summary-row"><div class="summary-left"><small>No furniture selected</small></div></div>';

  const stageBody = cart.stage
    ? row(cart.stage.name, 'Stage decoration', cart.stage.price)
    : '<div class="summary-row"><div class="summary-left"><small>No stage selected</small></div></div>';

  const serviceBody = cart.services.length
    ? cart.services.map((service) => row(service.name, service.category, service.price)).join('')
    : '<div class="summary-row"><div class="summary-left"><small>No additional services</small></div></div>';

  const menuGroups = new Map<string, string[]>();
  cart.catering?.selectedItems.forEach((item) => {
    if (!menuGroups.has(item.section)) menuGroups.set(item.section, []);
    menuGroups.get(item.section)?.push(item.item);
  });
  const menuText = Array.from(menuGroups.entries())
    .map(([section, items]) => `${section}: ${items.join(', ')}`)
    .join(' · ');

  const cateringBody = cart.catering
    ? row(
        cart.catering.name,
        `${cart.catering.guestCount} plates × ${formatPaise(cart.catering.pricePerPlate)}${menuText ? ` — ${menuText}` : ''}`,
        cart.catering.total,
      )
    : '<div class="summary-row"><div class="summary-left"><small>No catering selected</small></div></div>';

  return {
    hall: {
      key: 'hall',
      label: 'Hall booking',
      icon: 'building',
      total: cart.hall?.price ?? 0,
      body: hallBody,
    },
    rooms: {
      key: 'rooms',
      label: 'Rooms & suites',
      icon: 'bed',
      total: cart.rooms.reduce((sum, room) => sum + room.price * room.quantity, 0),
      body: roomBody,
    },
    catering: {
      key: 'catering',
      label: 'Catering package',
      icon: 'utensils',
      total: cart.catering?.total ?? 0,
      body: cateringBody,
    },
    furniture: {
      key: 'furniture',
      label: 'Furniture & seating',
      icon: 'chair',
      total: cart.furniture.reduce((sum, item) => sum + item.price * item.quantity, 0),
      body: furnitureBody,
    },
    stage: {
      key: 'stage',
      label: 'Stage decoration',
      icon: 'theater',
      total: cart.stage?.price ?? 0,
      body: stageBody,
    },
    services: {
      key: 'services',
      label: 'Additional services',
      icon: 'bell',
      total: cart.services.reduce((sum, service) => sum + service.price, 0),
      body: serviceBody,
    },
  };
}

const ORDER: Record<Primary, string[]> = {
  hall: ['hall', 'furniture', 'stage', 'services', 'rooms', 'catering'],
  room: ['rooms', 'hall', 'furniture', 'stage', 'services', 'catering'],
  catering: ['catering', 'hall', 'rooms', 'furniture', 'stage', 'services'],
  all: ['hall', 'rooms', 'catering', 'furniture', 'stage', 'services'],
};

function render(card: HTMLElement, options: SummaryOptions): void {
  const cart = readCart();
  const groups = groupsFor(cart);
  const primary = options.primary ?? 'all';
  const order = ORDER[primary];
  const hasAnything = cartTotal(cart) > 0;
  const primaryKey = primary === 'room' ? 'rooms' : primary;

  let body = '';
  for (const key of order) {
    const group = groups[key];
    const active = group.total > 0 || key === primaryKey;
    body += `
      <div class="summary-box ${active ? 'active' : ''}">
        <div class="summary-title accordion-title">
          <div>${icon(group.icon)} ${esc(group.label)}</div>
          <div class="accordion-right">
            <strong>${formatPaise(group.total)}</strong>
            <svg class="accordion-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
        <div class="summary-body">${group.body}</div>
      </div>`;
  }

  card.innerHTML = `
    <div class="summary-header">
      <h2>Event summary</h2>
      <p>${hasAnything ? 'Your selections update as you explore.' : 'Start by choosing a hall, room or catering package.'}</p>
    </div>
    ${body}
    <div class="summary-total">
      <span>Total estimate</span>
      <strong>${formatPaise(cartTotal(cart))}</strong>
    </div>
    <div class="summary-actions">
      <a href="/booking/overview" class="btn btn-primary btn-block ${hasAnything ? '' : 'is-disabled'}">Confirm booking</a>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        <a href="/halls" class="btn btn-secondary btn-sm">Halls</a>
        <a href="/rooms" class="btn btn-secondary btn-sm">Rooms</a>
        <a href="/catering" class="btn btn-secondary btn-sm">Menu</a>
      </div>
    </div>`;
}

export function mountSummary(options: SummaryOptions = {}): void {
  const card = document.querySelector<HTMLElement>('[data-event-summary]');
  if (!card) return;

  render(card, options);

  window.addEventListener(CART_EVENT, () => render(card, options));
}
