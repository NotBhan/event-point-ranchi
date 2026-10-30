import {
  CART_EVENT,
  cartTotal,
  clearCart,
  formatPaise,
  readCart,
  type CartState,
} from './cart';

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

function icon(name: string, size = 15): string {
  const paths: Record<string, string> = {
    utensils: '<path d="M7 3v8a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3"/><path d="M9 13v8"/><path d="M17 3c-1.5 2-2 4-2 6a3 3 0 0 0 3 3V3"/><path d="M18 12v9"/>',
    building: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M2 21h20"/>',
    chair: '<path d="M6 19v-4h12v4"/><path d="M6 15V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8"/><path d="M8 19v2M16 19v2"/>',
    theater: '<path d="M4 5h16v8a8 8 0 0 1-16 0z"/><path d="M8 9h.01M16 9h.01"/><path d="M8 14c1 1 2 1.5 4 1.5s3-.5 4-1.5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    chevron: '<polyline points="6 9 12 15 18 9"/>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    whatsapp: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.building}</svg>`;
}

function render(card: HTMLElement, options: SummaryOptions): void {
  const cart: CartState = readCart();
  const primary = options.primary ?? 'all';
  const totalPaise = cartTotal(cart);
  const hasAnything = totalPaise > 0;
  const advancePaise = Math.round(totalPaise * 0.25);
  const balancePaise = totalPaise - advancePaise;

  let activeItemsHtml = '';

  // 1. Catering
  if (cart.catering) {
    const selectedCount = cart.catering.selectedItems.length;
    const menuGroups = new Map<string, string[]>();
    for (const item of cart.catering.selectedItems) {
      if (!menuGroups.has(item.section)) menuGroups.set(item.section, []);
      menuGroups.get(item.section)?.push(item.item);
    }

    let menuGroupHtml = '';
    if (selectedCount > 0) {
      menuGroupHtml = Array.from(menuGroups.entries())
        .map(
          ([section, items]) => `
          <div class="summary-menu-group">
            <span class="summary-menu-section-label">${esc(section)}</span>
            <span class="summary-menu-section-items">${esc(items.join(', '))}</span>
          </div>
        `,
        )
        .join('');
    }

    activeItemsHtml += `
      <div class="summary-active-item" data-category="catering">
        <div class="summary-item-top">
          <div class="summary-item-badge">
            ${icon('utensils', 13)}
            <span>Catering Package</span>
          </div>
          <span class="summary-item-price">${formatPaise(cart.catering.total)}</span>
        </div>
        <h3 class="summary-item-title">${esc(cart.catering.name)}</h3>
        <div class="summary-item-pills">
          <span class="summary-pill">
            ${icon('users', 12)}
            <strong>${cart.catering.guestCount}</strong> Guests
          </span>
          <span class="summary-pill">
            <strong>${formatPaise(cart.catering.pricePerPlate)}</strong> / plate
          </span>
          ${
            selectedCount > 0
              ? `
            <span class="summary-pill summary-pill-gold">
              ${icon('check', 11)}
              <strong>${selectedCount}</strong> dishes selected
            </span>
          `
              : `
            <span class="summary-pill summary-pill-muted">0 dishes chosen</span>
          `
          }
        </div>

        ${
          selectedCount > 0
            ? `
          <details class="summary-menu-details" open>
            <summary class="summary-menu-summary">
              <span>Selected menu items (${selectedCount})</span>
              <span class="summary-chevron">${icon('chevron', 12)}</span>
            </summary>
            <div class="summary-menu-dropdown">
              ${menuGroupHtml}
            </div>
          </details>
        `
            : `
          <p class="summary-item-note">Choose dishes below to customize your banquet feast.</p>
        `
        }
      </div>
    `;
  }

  // 2. Hall
  if (cart.hall) {
    activeItemsHtml += `
      <div class="summary-active-item" data-category="hall">
        <div class="summary-item-top">
          <div class="summary-item-badge">
            ${icon('building', 13)}
            <span>Banquet Hall</span>
          </div>
          <span class="summary-item-price">${formatPaise(cart.hall.price)}</span>
        </div>
        <h3 class="summary-item-title">${esc(cart.hall.name)}</h3>
        <div class="summary-item-pills">
          ${
            cart.hall.capacity
              ? `
            <span class="summary-pill">
              ${icon('users', 12)}
              Capacity: <strong>${esc(cart.hall.capacity)}</strong> guests
            </span>
          `
              : ''
          }
          <span class="summary-pill summary-pill-gold">
            Venue Reservation
          </span>
        </div>
      </div>
    `;
  }

  // 3. Stage
  if (cart.stage) {
    activeItemsHtml += `
      <div class="summary-active-item" data-category="stage">
        <div class="summary-item-top">
          <div class="summary-item-badge">
            ${icon('theater', 13)}
            <span>Stage Decoration</span>
          </div>
          <span class="summary-item-price">${formatPaise(cart.stage.price)}</span>
        </div>
        <h3 class="summary-item-title">${esc(cart.stage.name)}</h3>
        <div class="summary-item-pills">
          <span class="summary-pill summary-pill-gold">Floral Setup & Backdrop</span>
        </div>
      </div>
    `;
  }

  // 4. Furniture
  if (cart.furniture.length > 0) {
    const fTotal = cart.furniture.reduce((sum, item) => sum + item.price * item.quantity, 0);
    activeItemsHtml += `
      <div class="summary-active-item" data-category="furniture">
        <div class="summary-item-top">
          <div class="summary-item-badge">
            ${icon('chair', 13)}
            <span>Furniture & Seating</span>
          </div>
          <span class="summary-item-price">${formatPaise(fTotal)}</span>
        </div>
        <div class="summary-subitems-list">
          ${cart.furniture
            .map(
              (f) => `
            <div class="summary-subitem-row">
              <span>${esc(f.name)} (${f.quantity})</span>
              <strong>${formatPaise(f.price * f.quantity)}</strong>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  // 5. Additional Services
  if (cart.services.length > 0) {
    const sTotal = cart.services.reduce((sum, s) => sum + s.price, 0);
    activeItemsHtml += `
      <div class="summary-active-item" data-category="services">
        <div class="summary-item-top">
          <div class="summary-item-badge">
            ${icon('bell', 13)}
            <span>Additional Services</span>
          </div>
          <span class="summary-item-price">${formatPaise(sTotal)}</span>
        </div>
        <div class="summary-subitems-list">
          ${cart.services
            .map(
              (s) => `
            <div class="summary-subitem-row">
              <span>${esc(s.name)}</span>
              <strong>${formatPaise(s.price)}</strong>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  // Complementary Add-ons (unselected categories)
  const unselectedAddons: Array<{ key: string; label: string; desc: string; icon: string; url: string }> = [];
  if (!cart.hall && primary !== 'hall') {
    unselectedAddons.push({
      key: 'hall',
      label: 'Banquet Hall',
      desc: 'Indoor halls & open lawn venues',
      icon: 'building',
      url: '/halls',
    });
  }
  if (!cart.catering && primary !== 'catering') {
    unselectedAddons.push({
      key: 'catering',
      label: 'Catering Package',
      desc: 'Royal banquet menus & live counters',
      icon: 'utensils',
      url: '/catering',
    });
  }
  if (!cart.stage) {
    unselectedAddons.push({
      key: 'stage',
      label: 'Stage & Mandap Decor',
      desc: 'Artisanal carved mandaps & floral stages',
      icon: 'theater',
      url: '/stages',
    });
  }
  if (cart.furniture.length === 0) {
    unselectedAddons.push({
      key: 'furniture',
      label: 'Furniture & Seating',
      desc: 'Chairs, banquet tables & lounge sets',
      icon: 'chair',
      url: '/equipment',
    });
  }

  let addonsHtml = '';
  if (unselectedAddons.length > 0) {
    addonsHtml = `
      <div class="summary-addons-box">
        <div class="summary-addons-header">
          <span class="summary-addons-title">
            ${icon('sparkles', 13)}
            <span>Complement your event</span>
          </span>
          <span class="summary-addons-subtitle">Available add-ons</span>
        </div>
        <div class="summary-addons-list">
          ${unselectedAddons
            .map(
              (addon) => `
            <a href="${addon.url}" class="summary-addon-card" title="Explore ${esc(addon.label)}">
              <div class="addon-icon-circle">${icon(addon.icon, 13)}</div>
              <div class="addon-info">
                <strong>${esc(addon.label)}</strong>
                <small>${esc(addon.desc)}</small>
              </div>
              <span class="addon-badge">+ Explore</span>
            </a>
          `,
            )
            .join('')}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="summary-header">
      <div class="summary-header-meta">
        <div class="summary-live-badge">
          <span class="summary-live-dot"></span>
          <span>LIVE ESTIMATE</span>
        </div>
        ${
          hasAnything
            ? `
          <button type="button" class="summary-reset-btn" data-reset-summary title="Reset all event selections">
            ${icon('trash', 12)} Reset
          </button>
        `
            : ''
        }
      </div>
      <h2>Event Quotation Summary</h2>
      <p>${hasAnything ? 'Real-time pricing for your Ranchi celebration.' : 'Select package options to see an instant quotation.'}</p>
    </div>

    <div class="summary-content">
      ${
        hasAnything
          ? `
        <div class="summary-active-section">
          ${activeItemsHtml}
        </div>
        ${addonsHtml}
      `
          : `
        <div class="summary-empty-state">
          <div class="summary-empty-icon">${icon('utensils', 24)}</div>
          <h3>No services selected yet</h3>
          <p>Pick your guest count or select menu courses to generate a real-time quotation.</p>
          <div class="summary-empty-links">
            <a href="/catering" class="btn btn-secondary btn-sm">Explore Menus</a>
            <a href="/halls" class="btn btn-secondary btn-sm">Browse Halls</a>
          </div>
        </div>
        ${addonsHtml}
      `
      }
    </div>

    ${
      hasAnything
        ? `
      <div class="summary-financials">
        <div class="summary-fin-row">
          <span>Package Subtotal</span>
          <strong>${formatPaise(totalPaise)}</strong>
        </div>
        <div class="summary-fin-row summary-fin-advance">
          <span>Date Booking Advance (25%)</span>
          <strong>${formatPaise(advancePaise)}</strong>
        </div>
        <div class="summary-fin-row">
          <span>Remaining Balance at Event</span>
          <strong>${formatPaise(balancePaise)}</strong>
        </div>
        <div class="summary-fin-note">
          ${icon('shield', 12)}
          <span>Transparent pricing · No hidden surcharge</span>
        </div>
      </div>
    `
        : ''
    }

    <div class="summary-total">
      <div class="summary-total-left">
        <span class="summary-total-label">Total Estimate</span>
        <span class="summary-total-sub">All-inclusive package</span>
      </div>
      <strong class="summary-total-amount">${formatPaise(totalPaise)}</strong>
    </div>

    <div class="summary-actions">
      <a href="/booking/overview" class="btn btn-primary btn-block summary-cta-btn ${hasAnything ? '' : 'is-disabled'}">
        <span>Proceed to Booking</span>
        ${icon('arrowRight', 14)}
      </a>
      <div class="summary-quick-nav">
        <a href="/halls" class="summary-nav-chip">${icon('building', 12)} Halls</a>
        <a href="/catering" class="summary-nav-chip">${icon('utensils', 12)} Menus</a>
        <a href="/gallery" class="summary-nav-chip">${icon('sparkles', 12)} Gallery</a>
      </div>
      <div class="summary-concierge">
        <a href="https://wa.me/919876543210?text=Hello%20Event%20Point%20Ranchi%2C%20I%20would%20like%20to%20customize%20my%20event%20package."
           target="_blank"
           rel="noopener noreferrer"
           class="summary-wa-btn">
          ${icon('whatsapp', 14)}
          <span>Custom menu or date query? WhatsApp Us</span>
        </a>
      </div>
    </div>
  `;

  // Attach reset listener
  card.querySelector('[data-reset-summary]')?.addEventListener('click', () => {
    if (confirm('Clear your current event selections?')) {
      clearCart();
    }
  });
}

export function mountSummary(options: SummaryOptions = {}): void {
  const card = document.querySelector<HTMLElement>('[data-event-summary]');
  if (!card) return;

  render(card, options);

  window.addEventListener(CART_EVENT, () => render(card, options));
}
