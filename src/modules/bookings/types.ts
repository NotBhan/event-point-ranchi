export interface CartPayload {
  hall?: { id: string | number } | null;
  rooms?: Array<{ id: string | number; quantity: number }>;
  furniture?: Array<{ id: string | number; quantity: number }>;
  stage?: { id: string | number } | null;
  services?: Array<{ id: string | number }>;
  catering?: {
    id: string | number;
    guestCount: number;
    selectedItems?: Array<{ section: string; item: string }>;
  } | null;
  customer?: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    event_date?: string;
    event_time?: string;
    event_type?: string;
    guests?: number;
    special_request?: string;
  };
}
