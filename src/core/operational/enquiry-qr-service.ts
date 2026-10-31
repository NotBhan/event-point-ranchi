import { createHash, randomBytes } from 'node:crypto';
import {
  createEnquiryQrTokenRecord,
  getEnquiryQrTokenByHash,
  getEnquiryQrTokenByReference,
  getEnquiryQrTokenByEnquiryId,
  type EventEnquiryRow,
} from './service';
import { getNeonClient } from './neon-client';

// qrcode is only needed when a QR is actually generated.
type QrCodeLib = typeof import('qrcode');
let qrCodePromise: Promise<QrCodeLib> | null = null;
function loadQrCode(): Promise<QrCodeLib> {
  if (!qrCodePromise) {
    qrCodePromise = import('qrcode').then(
      (module) => ((module as { default?: QrCodeLib }).default ?? module) as QrCodeLib,
    );
  }
  return qrCodePromise;
}

export interface EnquiryLookupResult {
  found: boolean;
  enquiry?: {
    id: number;
    referenceCode: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    eventType: string;
    eventDate: string;
    endDate: string | null;
    eventTime: string | null;
    venueLocation: string;
    guestCount: number;
    budgetRange: string;
    requiresRooms: boolean;
    roomCount: number;
    accommodationNotes: string;
    decorationNotes: string;
    preferredContact: string;
    status: string;
    createdAt: string;
    items?: Array<{
      itemType: string;
      name: string;
      quantity: number;
      dimensions?: string;
    }>;
    linkedBooking?: {
      id: number;
      status: string;
      totalAmount: number;
      amountPaid: number;
      outstandingBalance: number;
      paymentStatus: string;
    } | null;
  };
  qrToken?: string;
  error?: string;
}

export class EnquiryQrService {
  private defaultBaseUrl: string;

  constructor(defaultBaseUrl?: string) {
    this.defaultBaseUrl = defaultBaseUrl || process.env.PUBLIC_SITE_URL || 'https://eventpointranchi.com';
  }

  /**
   * Get or generate a secure QR token and image for an event enquiry
   */
  public async getOrCreateEnquiryQr(
    enquiryId: number,
    referenceCode: string,
    baseUrl?: string
  ): Promise<{
    token: string;
    qrDataUrl: string;
    scanUrl: string;
    referenceCode: string;
  }> {
    const host = baseUrl || this.defaultBaseUrl;
    let record = await getEnquiryQrTokenByEnquiryId(enquiryId);

    if (!record) {
      const token = randomBytes(24).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');

      record = await createEnquiryQrTokenRecord({
        enquiryId,
        referenceCode,
        token,
        tokenHash,
      });
    }

    const scanUrl = `${host.replace(/\/+$/, '')}/admin/enquiries/scan?token=${record.token}`;
    const QRCode = await loadQrCode();
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 250,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });

    return {
      token: record.token,
      qrDataUrl,
      scanUrl,
      referenceCode,
    };
  }

  /**
   * Look up an enquiry by QR raw input (URL, token, or reference code)
   */
  public async lookupEnquiry(rawInput: string): Promise<EnquiryLookupResult> {
    if (!rawInput || typeof rawInput !== 'string') {
      return { found: false, error: 'Empty QR code payload.' };
    }

    const trimmed = rawInput.trim();
    let token = '';
    let referenceCode = '';

    // Check if input is a URL containing ?token=... or ?ref=...
    if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('/admin/enquiries/scan')) {
      try {
        const dummyBase = 'https://eventpointranchi.com';
        const parsedUrl = new URL(trimmed.startsWith('http') ? trimmed : `${dummyBase}${trimmed}`);
        token = parsedUrl.searchParams.get('token') || '';
        referenceCode = parsedUrl.searchParams.get('ref') || '';
      } catch {
        // Fallback: regex search
        const tokenMatch = trimmed.match(/[?&]token=([a-f0-9]{32,64})/i);
        if (tokenMatch) token = tokenMatch[1];
        const refMatch = trimmed.match(/[?&]ref=([A-Za-z0-9_-]+)/i);
        if (refMatch) referenceCode = refMatch[1];
      }
    } else if (trimmed.startsWith('EPR-ENQ:')) {
      token = trimmed.replace('EPR-ENQ:', '').trim();
    } else if (/^[a-f0-9]{40,64}$/i.test(trimmed)) {
      token = trimmed;
    } else if (/^(EP|EPR)-/i.test(trimmed)) {
      referenceCode = trimmed;
    } else {
      // Could be reference code or token
      if (trimmed.length > 30) {
        token = trimmed;
      } else {
        referenceCode = trimmed;
      }
    }

    const neon = getNeonClient();
    let enquiryId: number | null = null;
    let foundRefCode: string = referenceCode;

    // 1. Try token lookup
    if (token) {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const tokenRow = await getEnquiryQrTokenByHash(tokenHash);
      if (tokenRow) {
        enquiryId = tokenRow.enquiry_id;
        foundRefCode = tokenRow.reference_code;
      }
    }

    // 2. Try reference code lookup if not resolved by token
    if (!enquiryId && referenceCode) {
      const tokenRow = await getEnquiryQrTokenByReference(referenceCode.toUpperCase());
      if (tokenRow) {
        enquiryId = tokenRow.enquiry_id;
        foundRefCode = tokenRow.reference_code;
      }
    }

    // 3. Query event_enquiries table
    let enquiryRow: EventEnquiryRow | null = null;
    if (enquiryId) {
      const res = await neon.query<EventEnquiryRow>(
        'SELECT * FROM event_enquiries WHERE id = $1 LIMIT 1',
        [enquiryId]
      );
      enquiryRow = res.rows[0] || null;
    } else if (foundRefCode) {
      const res = await neon.query<EventEnquiryRow>(
        'SELECT * FROM event_enquiries WHERE reference_code = $1 LIMIT 1',
        [foundRefCode]
      );
      enquiryRow = res.rows[0] || null;
    }

    if (!enquiryRow) {
      return {
        found: false,
        error: `No enquiry found for "${rawInput.slice(0, 50)}". Please verify the QR code or reference code.`,
      };
    }

    // 4. Fetch line items
    let lineItems: Array<{ itemType: string; name: string; quantity: number; dimensions?: string }> = [];
    try {
      const itemsRes = await neon.query<{
        item_type: string;
        item_name_snapshot: string;
        quantity: number;
        standard_dimensions_snapshot: string;
      }>(
        'SELECT item_type, item_name_snapshot, quantity, standard_dimensions_snapshot FROM enquiry_line_items WHERE enquiry_id = $1',
        [enquiryRow.id]
      );
      lineItems = itemsRes.rows.map((row) => ({
        itemType: row.item_type,
        name: row.item_name_snapshot,
        quantity: row.quantity,
        dimensions: row.standard_dimensions_snapshot || undefined,
      }));
    } catch {
      // Table or line items optional
    }

    // 5. Check if converted to booking
    let linkedBooking: {
      id: number;
      status: string;
      totalAmount: number;
      amountPaid: number;
      outstandingBalance: number;
      paymentStatus: string;
    } | null = null;
    try {
      const bookingRes = await neon.query<{
        id: number;
        status: string;
        total_amount: number;
        amount_paid: number;
        outstanding_balance: number;
        payment_status: string;
      }>(
        `SELECT b.id, b.status, b.total_amount, b.amount_paid, b.outstanding_balance, b.payment_status 
         FROM bookings b
         JOIN customers c ON c.id = b.customer_id
         WHERE c.phone = $1 OR c.email = $2
         ORDER BY b.id DESC LIMIT 1`,
        [enquiryRow.customer_phone, enquiryRow.customer_email || '']
      );
      if (bookingRes.rows[0]) {
        const b = bookingRes.rows[0];
        linkedBooking = {
          id: b.id,
          status: b.status,
          totalAmount: Number(b.total_amount),
          amountPaid: Number(b.amount_paid),
          outstandingBalance: Number(b.outstanding_balance),
          paymentStatus: b.payment_status,
        };
      }
    } catch {
      // Optional check
    }

    return {
      found: true,
      enquiry: {
        id: enquiryRow.id,
        referenceCode: enquiryRow.reference_code,
        customerName: enquiryRow.customer_name,
        customerPhone: enquiryRow.customer_phone,
        customerEmail: enquiryRow.customer_email,
        eventType: enquiryRow.event_type,
        eventDate: enquiryRow.event_date,
        endDate: enquiryRow.end_date || null,
        eventTime: enquiryRow.event_time || null,
        venueLocation: enquiryRow.venue_location,
        guestCount: enquiryRow.guest_count,
        budgetRange: enquiryRow.budget_range,
        requiresRooms: Boolean(enquiryRow.requires_rooms),
        roomCount: enquiryRow.room_count,
        accommodationNotes: enquiryRow.accommodation_notes,
        decorationNotes: enquiryRow.decoration_notes,
        preferredContact: enquiryRow.preferred_contact,
        status: enquiryRow.status,
        createdAt: enquiryRow.created_at,
        items: lineItems,
        linkedBooking,
      },
      qrToken: token || undefined,
    };
  }
}

let enquiryQrServiceInstance: EnquiryQrService | null = null;

export function getEnquiryQrService(baseUrl?: string): EnquiryQrService {
  if (!enquiryQrServiceInstance) {
    enquiryQrServiceInstance = new EnquiryQrService(baseUrl);
  }
  return enquiryQrServiceInstance;
}
