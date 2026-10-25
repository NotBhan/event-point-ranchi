export interface CartHall {
  id: string;
  name: string;
  price: number;
  capacity?: number | string;
}

export interface CartRoom {
  id: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
}

export interface CartFurniture {
  id: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
}

export interface CartStage {
  id: string;
  name: string;
  price: number;
}

export interface CartService {
  id: string;
  name: string;
  category: string;
  price: number;
}

export interface CartMenuItem {
  section: string;
  item: string;
}

export interface CartCatering {
  id: string;
  name: string;
  guestCount: number;
  pricePerPlate: number;
  selectedItems: CartMenuItem[];
  total: number;
}

export interface CartState {
  hall: CartHall | null;
  rooms: CartRoom[];
  furniture: CartFurniture[];
  stage: CartStage | null;
  services: CartService[];
  catering: CartCatering | null;
}

export const CART_EVENT = 'cart:change';
const STORAGE_KEY = 'royalEventCart:v2';

export function emptyCart(): CartState {
  return {
    hall: null,
    rooms: [],
    furniture: [],
    stage: null,
    services: [],
    catering: null,
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(raw: unknown): CartState {
  const base = emptyCart();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, unknown>;

  if (value.hall && typeof value.hall === 'object') {
    const hall = value.hall as Record<string, unknown>;
    if (hall.id) {
      base.hall = {
        id: String(hall.id),
        name: String(hall.name ?? 'Selected hall'),
        price: toNumber(hall.price),
        capacity: hall.capacity as string | number | undefined,
      };
    }
  }

  if (Array.isArray(value.rooms)) {
    base.rooms = value.rooms
      .map((item) => {
        const room = item as Record<string, unknown>;
        if (!room.id) return null;
        const quantity = Math.max(1, toNumber(room.quantity));
        const price = toNumber(room.price);
        return { id: String(room.id), name: String(room.name ?? 'Room'), price, quantity, total: price * quantity };
      })
      .filter((item): item is CartRoom => Boolean(item));
  }

  if (Array.isArray(value.furniture)) {
    base.furniture = value.furniture
      .map((item) => {
        const piece = item as Record<string, unknown>;
        if (!piece.id) return null;
        const quantity = Math.max(0, toNumber(piece.quantity));
        const price = toNumber(piece.price);
        if (quantity <= 0) return null;
        return { id: String(piece.id), name: String(piece.name ?? 'Furniture'), price, quantity, total: price * quantity };
      })
      .filter((item): item is CartFurniture => Boolean(item));
  }

  if (value.stage && typeof value.stage === 'object') {
    const stage = value.stage as Record<string, unknown>;
    if (stage.id) {
      base.stage = { id: String(stage.id), name: String(stage.name ?? 'Stage'), price: toNumber(stage.price) };
    }
  }

  if (Array.isArray(value.services)) {
    base.services = value.services
      .map((item) => {
        const service = item as Record<string, unknown>;
        if (!service.id) return null;
        return {
          id: String(service.id),
          name: String(service.name ?? 'Service'),
          category: String(service.category ?? 'Additional services'),
          price: toNumber(service.price),
        };
      })
      .filter((item): item is CartService => Boolean(item));
  }

  if (value.catering && typeof value.catering === 'object') {
    const catering = value.catering as Record<string, unknown>;
    if (catering.id) {
      const guestCount = Math.max(1, toNumber(catering.guestCount));
      const pricePerPlate = toNumber(catering.pricePerPlate ?? catering.price);
      const selectedItems = Array.isArray(catering.selectedItems)
        ? catering.selectedItems.map((entry) => {
            const item = entry as Record<string, unknown>;
            return { section: String(item.section ?? ''), item: String(item.item ?? '') };
          })
        : [];
      base.catering = {
        id: String(catering.id),
        name: String(catering.name ?? 'Catering package'),
        guestCount,
        pricePerPlate,
        selectedItems,
        total: guestCount * pricePerPlate,
      };
    }
  }

  return base;
}

export function readCart(): CartState {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return emptyCart();
  }
}

function commit(state: CartState): CartState {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: state }));
  return state;
}

export function cartCount(state: CartState = readCart()): number {
  let count = 0;
  if (state.hall) count += 1;
  if (state.catering) count += 1;
  if (state.stage) count += 1;
  count += state.rooms.reduce((sum, room) => sum + room.quantity, 0);
  count += state.furniture.reduce((sum, item) => sum + item.quantity, 0);
  count += state.services.length;
  return count;
}

export function cartTotal(state: CartState = readCart()): number {
  let total = 0;
  if (state.hall) total += state.hall.price;
  if (state.catering) total += state.catering.total;
  if (state.stage) total += state.stage.price;
  total += state.rooms.reduce((sum, room) => sum + room.price * room.quantity, 0);
  total += state.furniture.reduce((sum, item) => sum + item.price * item.quantity, 0);
  total += state.services.reduce((sum, service) => sum + service.price, 0);
  return total;
}

export function setHall(hall: CartHall): void {
  const state = readCart();
  state.hall = hall;
  commit(state);
}

export function removeHall(): void {
  const state = readCart();
  state.hall = null;
  commit(state);
}

export function addRoom(room: Omit<CartRoom, 'quantity' | 'total'> & { quantity?: number }): void {
  const state = readCart();
  const existing = state.rooms.find((entry) => entry.id === room.id);
  if (existing) {
    existing.quantity += room.quantity ?? 1;
  } else {
    const quantity = Math.max(1, room.quantity ?? 1);
    state.rooms.push({ ...room, quantity, total: room.price * quantity });
  }
  commit(state);
}

export function setRoomQuantity(roomId: string, quantity: number): void {
  const state = readCart();
  const room = state.rooms.find((entry) => entry.id === String(roomId));
  if (room) {
    room.quantity = Math.max(0, quantity);
    if (room.quantity === 0) {
      state.rooms = state.rooms.filter((entry) => entry.id !== String(roomId));
    }
  }
  commit(state);
}

export function removeRoom(roomId: string): void {
  const state = readCart();
  state.rooms = state.rooms.filter((entry) => entry.id !== String(roomId));
  commit(state);
}

export function setFurniture(items: CartFurniture[]): void {
  const state = readCart();
  state.furniture = items.filter((item) => item.quantity > 0);
  commit(state);
}

export function removeFurniture(itemId: string): void {
  const state = readCart();
  state.furniture = state.furniture.filter((entry) => entry.id !== String(itemId));
  commit(state);
}

export function setStage(stage: CartStage | null): void {
  const state = readCart();
  state.stage = stage;
  commit(state);
}

export function setServices(services: CartService[]): void {
  const state = readCart();
  state.services = services;
  commit(state);
}

export function removeService(serviceId: string): void {
  const state = readCart();
  state.services = state.services.filter((entry) => entry.id !== String(serviceId));
  commit(state);
}

export function setCatering(catering: CartCatering | null): void {
  const state = readCart();
  state.catering = catering;
  commit(state);
}

export function updateCateringGuests(guestCount: number): void {
  const state = readCart();
  if (!state.catering) return;
  const next = Math.max(1, Math.floor(guestCount));
  state.catering.guestCount = next;
  state.catering.total = next * state.catering.pricePerPlate;
  commit(state);
}

export function removeCatering(): void {
  const state = readCart();
  state.catering = null;
  commit(state);
}

export function clearCart(): void {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(CART_EVENT, { detail: emptyCart() }));
}

export function formatPaise(paise: number): string {
  const amount = (Number(paise) || 0) / 100;
  const decimals = Math.abs(amount % 1) > 0.001;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
