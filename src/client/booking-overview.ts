import { cartTotal, formatPaise, readCart } from './cart';

interface Prefill {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

const root = document.querySelector<HTMLElement>('[data-booking-overview]');

if (root) {
  const csrf = root.dataset.csrf ?? '';
  const itemsRoot = document.querySelector<HTMLElement>('[data-overview-items]');
  const summaryRoot = document.querySelector<HTMLElement>('[data-overview-summary]');
  const errorBox = document.querySelector<HTMLElement>('[data-overview-error]');
  const submitButton = document.querySelector<HTMLButtonElement>('[data-submit-booking]');
  const form = document.querySelector<HTMLFormElement>('[data-booking-form]');

  let prefill: Prefill = {};
  try {
    prefill = JSON.parse(root.dataset.prefill ?? '{}') as Prefill;
  } catch {
    prefill = {};
  }

  const nameInput = document.querySelector<HTMLInputElement>('#customerName');
  const phoneInput = document.querySelector<HTMLInputElement>('#customerPhone');
  const emailInput = document.querySelector<HTMLInputElement>('#customerEmail');
  const addressInput = document.querySelector<HTMLTextAreaElement>('#customerAddress');
  const dateInput = document.querySelector<HTMLInputElement>('#eventDate');
  const timeInput = document.querySelector<HTMLInputElement>('#eventTime');
  const typeInput = document.querySelector<HTMLSelectElement>('#eventType');
  const guestInput = document.querySelector<HTMLInputElement>('#expectedGuests');
  const requestInput = document.querySelector<HTMLTextAreaElement>('#specialRequest');

  if (nameInput && prefill.name) nameInput.value = prefill.name;
  if (phoneInput && prefill.phone) phoneInput.value = prefill.phone;
  if (emailInput && prefill.email) emailInput.value = prefill.email;
  if (addressInput && prefill.address) addressInput.value = prefill.address;

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

  function card(label: string, iconName: string, body: string): string {
    return `
      <article class="overview-card">
        <div class="overview-card-head">
          <span class="overview-card-icon">${icon(iconName)}</span>
          <h2>${esc(label)}</h2>
        </div>
        <div class="overview-card-body">${body}</div>
      </article>`;
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
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths[name] ?? paths.building}</svg>`;
  }

  function render(): void {
    const cart = readCart();
    const empty = cartTotal(cart) === 0;

    if (itemsRoot) {
      if (empty) {
        itemsRoot.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>
            </div>
            <h3>Your cart is empty</h3>
            <p>Choose a hall or catering before checking out.</p>
            <a href="/halls" class="btn btn-primary mt-4">Browse halls</a>
          </div>`;
      } else {
        let html = '';
        if (cart.hall) {
          html += card('Hall', 'building', row(cart.hall.name, cart.hall.capacity ? `${cart.hall.capacity} guests` : '', cart.hall.price));
        }
        if (cart.rooms.length) {
          html += card(
            'Rooms & suites',
            'bed',
            cart.rooms
              .map((room) => row(room.name, `${room.quantity} × ${formatPaise(room.price)} per night`, room.price * room.quantity))
              .join(''),
          );
        }
        if (cart.catering) {
          const grouped = new Map<string, string[]>();
          cart.catering.selectedItems.forEach((item) => {
            if (!grouped.has(item.section)) grouped.set(item.section, []);
            grouped.get(item.section)?.push(item.item);
          });
          const menuText = Array.from(grouped.entries())
            .map(([section, items]) => `${section}: ${items.join(', ')}`)
            .join(' · ');
          html += card(
            'Catering',
            'utensils',
            row(
              cart.catering.name,
              `${cart.catering.guestCount} plates × ${formatPaise(cart.catering.pricePerPlate)}${menuText ? ` — ${menuText}` : ''}`,
              cart.catering.total,
            ),
          );
        }
        if (cart.furniture.length) {
          html += card(
            'Furniture & seating',
            'chair',
            cart.furniture
              .map((item) => row(item.name, `${item.quantity} × ${formatPaise(item.price)}`, item.price * item.quantity))
              .join(''),
          );
        }
        if (cart.stage) {
          html += card('Stage decoration', 'theater', row(cart.stage.name, '', cart.stage.price));
        }
        if (cart.services.length) {
          html += card(
            'Additional services',
            'bell',
            cart.services.map((service) => row(service.name, service.category, service.price)).join(''),
          );
        }
        itemsRoot.innerHTML = html;
      }
    }

    if (summaryRoot) {
      const rows = [
        ['Hall', cart.hall?.price ?? 0],
        ['Rooms', cart.rooms.reduce((sum, room) => sum + room.price * room.quantity, 0)],
        ['Catering', cart.catering?.total ?? 0],
        ['Furniture', cart.furniture.reduce((sum, item) => sum + item.price * item.quantity, 0)],
        ['Stage', cart.stage?.price ?? 0],
        ['Services', cart.services.reduce((sum, service) => sum + service.price, 0)],
      ] as const;

      summaryRoot.innerHTML = `
        <div class="overview-summary-head">
          <h2>Booking summary</h2>
          <p>We recalculate every price on our server before saving.</p>
        </div>
        <div class="overview-summary-rows">
          ${rows
            .filter(([, value]) => value > 0)
            .map(
              ([label, value]) => `
              <div class="summary-row">
                <div class="summary-left"><h4>${label}</h4></div>
                <div class="summary-price">${formatPaise(value)}</div>
              </div>`,
            )
            .join('') || '<p class="text-sm text-muted">No selections yet.</p>'}
        </div>
        <div class="overview-total">
          <span>Grand total</span>
          <strong>${formatPaise(cartTotal(cart))}</strong>
        </div>`;
    }

    if (submitButton) {
      submitButton.disabled = empty;
      if (empty) submitButton.textContent = 'Add selections to continue';
    }
  }

  function showError(message: string): void {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (errorBox) errorBox.hidden = true;

    const cart = readCart();
    if (cartTotal(cart) === 0) {
      showError('Your cart is empty. Add a hall, room or catering package first.');
      return;
    }

    const name = nameInput?.value.trim() ?? '';
    const phone = phoneInput?.value.trim() ?? '';
    const email = emailInput?.value.trim() ?? '';
    const eventDate = dateInput?.value ?? '';
    const eventType = typeInput?.value ?? '';

    if (!name || !phone || !email || !eventDate || !eventType) {
      showError('Please complete all required customer and event fields.');
      return;
    }

    if (!/^[0-9]{10}$/.test(phone.replace(/\D/g, ''))) {
      showError('Please enter a valid 10-digit phone number.');
      return;
    }

    const payload = {
      hall: cart.hall ? { id: cart.hall.id } : null,
      rooms: cart.rooms.map((room) => ({ id: room.id, quantity: room.quantity })),
      furniture: cart.furniture.map((item) => ({ id: item.id, quantity: item.quantity })),
      stage: cart.stage ? { id: cart.stage.id } : null,
      services: cart.services.map((service) => ({ id: service.id })),
      catering: cart.catering
        ? {
            id: cart.catering.id,
            guestCount: cart.catering.guestCount,
            selectedItems: cart.catering.selectedItems,
          }
        : null,
      customer: {
        name,
        phone,
        email,
        address: addressInput?.value.trim() ?? '',
        event_date: eventDate,
        event_time: timeInput?.value ?? '',
        event_type: eventType,
        guests: Number(guestInput?.value ?? 0) || undefined,
        special_request: requestInput?.value.trim() ?? '',
      },
    };

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Creating your booking…';
    }

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { status: string; message?: string; quotationUrl?: string };

      if (!response.ok || result.status !== 'success' || !result.quotationUrl) {
        throw new Error(result.message ?? 'We could not create your booking. Please try again.');
      }

      localStorage.removeItem('royalEventCart:v2');
      window.location.href = result.quotationUrl;
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unexpected error. Please try again.');
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Confirm & submit booking';
      }
    }
  });

  render();
  window.addEventListener('cart:change', render);
}
