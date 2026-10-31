import { getEnquiryQrService, type EnquiryLookupResult } from './enquiry-qr-service';
import { getSiteSettings } from '../content/service';
import { one, all } from '../db';

// pdf-lib and qrcode are heavy and only needed when a receipt is generated.
type PdfLib = typeof import('pdf-lib');
let pdfLibPromise: Promise<PdfLib> | null = null;
function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) pdfLibPromise = import('pdf-lib');
  return pdfLibPromise;
}

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

export interface EnquiryReceiptItem {
  itemType: string;
  name: string;
  quantity: number;
  dimensions?: string;
}

export interface EnquiryReceiptData {
  enquiry: {
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
    items: EnquiryReceiptItem[];
  };
  token: string;
  qrDataUrl: string;
  verificationUrl: string;
  businessInfo: {
    brandName: string;
    legalName: string;
    tagline: string;
    phone: string;
    email: string;
    address: string;
    website: string;
  };
}

export function cleanPdfText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/₹/g, 'Rs. ')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim();
}

export class EnquiryReceiptService {
  private defaultBaseUrl: string;

  constructor(defaultBaseUrl?: string) {
    this.defaultBaseUrl = defaultBaseUrl || process.env.PUBLIC_SITE_URL || 'https://eventpointranchi.com';
  }

  /**
   * Fetch enquiry acknowledgement receipt data by token or reference code.
   */
  public async getEnquiryReceiptData(
    refOrToken: string,
    baseUrl?: string
  ): Promise<EnquiryReceiptData | null> {
    const host = baseUrl || this.defaultBaseUrl;
    const qrService = getEnquiryQrService(host);

    let lookup: EnquiryLookupResult;
    try {
      lookup = await qrService.lookupEnquiry(refOrToken);
    } catch {
      lookup = { found: false };
    }

    // Fallback: If not found in Neon (e.g. offline dev or SQLite fallback), check local SQLite
    if (!lookup.found || !lookup.enquiry) {
      try {
        const trimmed = refOrToken.trim();
        const row = one<{
          id: number;
          reference_code: string;
          customer_name: string;
          customer_phone: string;
          customer_email: string | null;
          event_type: string;
          event_date: string;
          end_date: string | null;
          event_time: string | null;
          venue_location: string;
          guest_count: number;
          budget_range: string;
          requires_rooms: number;
          room_count: number;
          accommodation_notes: string;
          decoration_notes: string;
          preferred_contact: string;
          status: string;
          created_at: string;
        }>(
          'SELECT * FROM event_enquiries WHERE reference_code = ? OR CAST(id AS TEXT) = ? LIMIT 1',
          [trimmed, trimmed]
        );

        if (row) {
          const itemsRows = all<{
            item_type: string;
            item_name_snapshot: string;
            quantity: number;
            standard_dimensions_snapshot: string;
          }>(
            'SELECT item_type, item_name_snapshot, quantity, standard_dimensions_snapshot FROM enquiry_line_items WHERE enquiry_id = ?',
            [row.id]
          );

          lookup = {
            found: true,
            enquiry: {
              id: row.id,
              referenceCode: row.reference_code,
              customerName: row.customer_name,
              customerPhone: row.customer_phone,
              customerEmail: row.customer_email,
              eventType: row.event_type,
              eventDate: row.event_date,
              endDate: row.end_date,
              eventTime: row.event_time,
              venueLocation: row.venue_location,
              guestCount: row.guest_count,
              budgetRange: row.budget_range,
              requiresRooms: Boolean(row.requires_rooms),
              roomCount: row.room_count,
              accommodationNotes: row.accommodation_notes || '',
              decorationNotes: row.decoration_notes || '',
              preferredContact: row.preferred_contact || 'Phone',
              status: row.status,
              createdAt: row.created_at || new Date().toISOString(),
              items: itemsRows.map((it) => ({
                itemType: it.item_type,
                name: it.item_name_snapshot,
                quantity: it.quantity,
                dimensions: it.standard_dimensions_snapshot || undefined,
              })),
            },
          };
        }
      } catch (err) {
        console.warn('[EnquiryReceipt fallback query error]:', err);
      }
    }

    if (!lookup.found || !lookup.enquiry) {
      return null;
    }

    const enq = lookup.enquiry;
    const qrInfo = await qrService.getOrCreateEnquiryQr(enq.id, enq.referenceCode, host);
    const token = qrInfo.token;
    const verificationUrl = `${host.replace(/\/+$/, '')}/receipts/enquiry/${enq.referenceCode}?token=${token}`;

    // Generate fresh QR pointing directly to the public receipt with verification token
    const QRCode = await loadQrCode();
    const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 250,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });

    const settings = await getSiteSettings();

    return {
      enquiry: {
        ...enq,
        items: enq.items || [],
      },
      token,
      qrDataUrl,
      verificationUrl,
      businessInfo: {
        brandName: settings.name || 'Event Point Ranchi',
        legalName: settings.legalName || 'Event Point Ranchi Pvt. Ltd.',
        tagline: settings.tagline || 'Bespoke Wedding Mandaps, Stages & Luxury Celebrations',
        phone: settings.phone || '+91 98765 43210',
        email: settings.email || 'contact@eventpoint.in',
        address: settings.address || 'Main Road, Ranchi, Jharkhand 834001',
        website: host,
      },
    };
  }

  /**
   * Generate an official, print-optimised A4 PDF enquiry acknowledgement receipt.
   */
  public async generateEnquiryReceiptPdf(data: EnquiryReceiptData): Promise<Uint8Array> {
    const { PDFDocument, rgb, StandardFonts } = await loadPdfLib();
    const pdfDoc = await PDFDocument.create();
    // A4 Portrait: 595.28 x 841.89 points
    const page = pdfDoc.addPage([595.28, 841.89]);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    // Brand color palette
    const maroonColor = rgb(114 / 255, 18 / 255, 36 / 255); // #721224
    const goldColor = rgb(200 / 255, 162 / 255, 81 / 255); // #c8a251
    const darkInk = rgb(17 / 255, 24 / 255, 39 / 255); // #111827
    const bodyInk = rgb(55 / 255, 65 / 255, 81 / 255); // #374151
    const lightGray = rgb(107 / 255, 114 / 255, 128 / 255); // #6b7280
    const cardBg = rgb(250 / 255, 248 / 255, 245 / 255); // #faf8f5 warm canvas
    const borderGray = rgb(229 / 255, 231 / 255, 235 / 255); // #e5e7eb

    let y = pageHeight - 45;

    // 1. Header: Brand Information
    page.drawText(cleanPdfText(data.businessInfo.brandName.toUpperCase()), {
      x: 40,
      y,
      size: 17,
      font: fontBold,
      color: maroonColor,
    });

    page.drawText(cleanPdfText(data.businessInfo.tagline), {
      x: 40,
      y: y - 14,
      size: 8.5,
      font: fontItalic,
      color: lightGray,
    });

    page.drawText(cleanPdfText(`${data.businessInfo.address} | Phone: ${data.businessInfo.phone}`), {
      x: 40,
      y: y - 27,
      size: 8,
      font: fontRegular,
      color: lightGray,
    });

    // Right side: Official Enquiry Acknowledgement Banner
    page.drawText('ENQUIRY ACKNOWLEDGEMENT', {
      x: pageWidth - 230,
      y,
      size: 11,
      font: fontBold,
      color: goldColor,
    });

    page.drawText('(Not a Confirmed Booking or GST Invoice)', {
      x: pageWidth - 230,
      y: y - 14,
      size: 7.5,
      font: fontRegular,
      color: lightGray,
    });

    y -= 42;

    // Gold accent separator bar
    page.drawRectangle({
      x: 40,
      y,
      width: pageWidth - 80,
      height: 2.5,
      color: goldColor,
    });

    y -= 20;

    // 2. Metadata Box (Enquiry Reference, Date, Status, Event Details)
    const metaBoxHeight = 88;
    page.drawRectangle({
      x: 40,
      y: y - metaBoxHeight,
      width: pageWidth - 80,
      height: metaBoxHeight,
      color: cardBg,
      borderColor: borderGray,
      borderWidth: 1,
    });

    // Column 1: Enquiry Reference & Submission Date
    page.drawText('Enquiry Reference:', { x: 55, y: y - 14, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(data.enquiry.referenceCode), { x: 155, y: y - 14, size: 9.5, font: fontBold, color: maroonColor });

    page.drawText('Submitted On:', { x: 55, y: y - 30, size: 8.5, font: fontRegular, color: lightGray });
    const formattedDate = new Date(data.enquiry.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' IST';
    page.drawText(cleanPdfText(formattedDate), { x: 155, y: y - 30, size: 8.5, font: fontRegular, color: darkInk });

    page.drawText('Submission Status:', { x: 55, y: y - 46, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText('Awaiting Coordinator Review', { x: 155, y: y - 46, size: 8.5, font: fontBold, color: goldColor });

    page.drawText('Preferred Contact:', { x: 55, y: y - 62, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(data.enquiry.preferredContact || 'Phone / WhatsApp'), { x: 155, y: y - 62, size: 8.5, font: fontRegular, color: bodyInk });

    // Column 2: Event Details & Customer
    page.drawText('Customer Name:', { x: 310, y: y - 14, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(data.enquiry.customerName), { x: 410, y: y - 14, size: 9, font: fontBold, color: darkInk });

    page.drawText('Phone Number:', { x: 310, y: y - 30, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(data.enquiry.customerPhone), { x: 410, y: y - 30, size: 8.5, font: fontRegular, color: darkInk });

    page.drawText('Event Type & Date:', { x: 310, y: y - 46, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(`${data.enquiry.eventType} - ${data.enquiry.eventDate}`), { x: 410, y: y - 46, size: 8.5, font: fontBold, color: darkInk });

    page.drawText('Venue & Guests:', { x: 310, y: y - 62, size: 8.5, font: fontRegular, color: lightGray });
    const rawVenue = data.enquiry.venueLocation || '';
    const venueShort = rawVenue.length > 22
      ? rawVenue.slice(0, 20) + '...'
      : rawVenue;
    page.drawText(cleanPdfText(`${venueShort} (${data.enquiry.guestCount} guests)`), { x: 410, y: y - 62, size: 8.5, font: fontRegular, color: bodyInk });

    page.drawText('Approx. Budget:', { x: 310, y: y - 76, size: 8.5, font: fontRegular, color: lightGray });
    page.drawText(cleanPdfText(data.enquiry.budgetRange || 'To be discussed'), { x: 410, y: y - 76, size: 8.5, font: fontRegular, color: bodyInk });

    y -= (metaBoxHeight + 24);

    // 3. Section Title: Requested Event Blueprint & Line Items
    page.drawText('SPECIFIED BLUEPRINT & SELECTIONS', {
      x: 40,
      y,
      size: 10,
      font: fontBold,
      color: darkInk,
    });

    y -= 14;

    // Table Header
    page.drawRectangle({
      x: 40,
      y: y - 18,
      width: pageWidth - 80,
      height: 20,
      color: rgb(243 / 255, 244 / 255, 246 / 255),
    });

    page.drawText('Category', { x: 50, y: y - 13, size: 8.5, font: fontBold, color: bodyInk });
    page.drawText('Requested Item / Snapshot Description', { x: 150, y: y - 13, size: 8.5, font: fontBold, color: bodyInk });
    page.drawText('Dimensions / Specifications', { x: 370, y: y - 13, size: 8.5, font: fontBold, color: bodyInk });
    page.drawText('Qty', { x: 515, y: y - 13, size: 8.5, font: fontBold, color: bodyInk });

    y -= 24;

    // Table Rows
    const items = data.enquiry.items && data.enquiry.items.length > 0
      ? data.enquiry.items
      : [
          {
            itemType: 'Event Planning',
            name: `${data.enquiry.eventType} Consultation & Blueprint Setup`,
            quantity: 1,
            dimensions: `Estimated for ${data.enquiry.guestCount} guests`,
          },
        ];

    // Show up to 10 items in PDF
    const displayItems = items.slice(0, 10);
    for (const item of displayItems) {
      page.drawText(cleanPdfText(item.itemType.toUpperCase()), { x: 50, y, size: 8, font: fontBold, color: maroonColor });

      const rawName = cleanPdfText(item.name);
      const itemName = rawName.length > 38 ? rawName.slice(0, 35) + '...' : rawName;
      page.drawText(itemName, { x: 150, y, size: 8.5, font: fontRegular, color: darkInk });

      const rawDims = cleanPdfText(item.dimensions);
      const dims = rawDims ? (rawDims.length > 25 ? rawDims.slice(0, 23) + '...' : rawDims) : 'Standard';
      page.drawText(dims, { x: 370, y, size: 8, font: fontRegular, color: lightGray });

      page.drawText(cleanPdfText(String(item.quantity || 1)), { x: 520, y, size: 8.5, font: fontBold, color: darkInk });

      // Subtle row border
      page.drawRectangle({
        x: 40,
        y: y - 6,
        width: pageWidth - 80,
        height: 0.5,
        color: borderGray,
      });

      y -= 19;
    }

    if (items.length > 10) {
      page.drawText(`+ ${items.length - 10} additional equipment items recorded in digital database`, {
        x: 50,
        y,
        size: 7.5,
        font: fontItalic,
        color: lightGray,
      });
      y -= 16;
    }

    y -= 10;

    // 4. Accommodation & Styling Notes (if any)
    if (data.enquiry.requiresRooms || data.enquiry.accommodationNotes || data.enquiry.decorationNotes) {
      page.drawRectangle({
        x: 40,
        y: y - 42,
        width: pageWidth - 80,
        height: 44,
        color: cardBg,
        borderColor: borderGray,
        borderWidth: 0.8,
      });

      page.drawText('Special Requirements & Guest Accommodation:', {
        x: 52,
        y: y - 12,
        size: 8,
        font: fontBold,
        color: darkInk,
      });

      const noteStr = [
        data.enquiry.requiresRooms ? `Rooms: ${data.enquiry.roomCount} guest rooms requested.` : '',
        data.enquiry.accommodationNotes ? data.enquiry.accommodationNotes.replace(/\n+/g, ' ') : '',
        data.enquiry.decorationNotes ? data.enquiry.decorationNotes.replace(/\n+/g, ' ') : '',
      ]
        .filter(Boolean)
        .join(' - ');

      const truncatedNote = noteStr.length > 130 ? noteStr.slice(0, 127) + '...' : noteStr || 'Standard event layout.';
      page.drawText(cleanPdfText(truncatedNote), {
        x: 52,
        y: y - 28,
        size: 7.5,
        font: fontRegular,
        color: bodyInk,
      });

      y -= 54;
    }

    // 5. Verification QR Code & Official Check-in Stamp Box
    const qrBoxHeight = 110;
    page.drawRectangle({
      x: 40,
      y: y - qrBoxHeight,
      width: pageWidth - 80,
      height: qrBoxHeight,
      color: rgb(255 / 255, 255 / 255, 255 / 255),
      borderColor: goldColor,
      borderWidth: 1.2,
    });

    // Embed QR Image
    try {
      const qrBase64 = data.qrDataUrl.replace(/^data:image\/png;base64,/, '');
      const qrImageBytes = Buffer.from(qrBase64, 'base64');
      const qrImage = await pdfDoc.embedPng(qrImageBytes);

      page.drawImage(qrImage, {
        x: 52,
        y: y - qrBoxHeight + 10,
        width: 90,
        height: 90,
      });
    } catch (err) {
      console.warn('[PDF QR embed error]:', err);
    }

    // QR Explanatory copy
    page.drawText('OFFICIAL COORDINATOR RETRIEVAL QR', {
      x: 156,
      y: y - 20,
      size: 9.5,
      font: fontBold,
      color: maroonColor,
    });

    page.drawText('Present this QR code when visiting our Ranchi studio or on-site meeting.', {
      x: 156,
      y: y - 36,
      size: 8.5,
      font: fontRegular,
      color: darkInk,
    });

    page.drawText('Our event team will scan this code to retrieve your full specification and allocate items.', {
      x: 156,
      y: y - 48,
      size: 8,
      font: fontRegular,
      color: lightGray,
    });

    page.drawText(cleanPdfText(`Direct Verification URL: ${data.verificationUrl}`), {
      x: 156,
      y: y - 64,
      size: 7.5,
      font: fontItalic,
      color: lightGray,
    });

    page.drawText(cleanPdfText(`Unique Token: ${data.token.slice(0, 16)}...`), {
      x: 156,
      y: y - 78,
      size: 7.5,
      font: fontRegular,
      color: lightGray,
    });

    y -= (qrBoxHeight + 22);

    // 6. Terms, Important Notice & Next Steps
    page.drawRectangle({
      x: 40,
      y: y - 46,
      width: pageWidth - 80,
      height: 48,
      color: rgb(254 / 255, 242 / 255, 242 / 255), // light reddish-pink soft alert
      borderColor: rgb(254 / 255, 202 / 255, 202 / 255),
      borderWidth: 0.8,
    });

    page.drawText('IMPORTANT NOTICE & NEXT STEPS:', {
      x: 52,
      y: y - 12,
      size: 7.5,
      font: fontBold,
      color: maroonColor,
    });

    page.drawText('1. This acknowledgement confirms safe receipt of your requirements. No money has been charged.', {
      x: 52,
      y: y - 22,
      size: 7,
      font: fontRegular,
      color: darkInk,
    });

    page.drawText('2. Our senior wedding coordinator will review inventory availability and contact you within 24 hours.', {
      x: 52,
      y: y - 31,
      size: 7,
      font: fontRegular,
      color: darkInk,
    });

    page.drawText('3. Formal booking confirmation and date locks require signing the master service agreement & paying the agreed deposit.', {
      x: 52,
      y: y - 40,
      size: 7,
      font: fontRegular,
      color: darkInk,
    });

    y -= 74;

    // 7. Signature placeholders and footer
    page.drawRectangle({
      x: 40,
      y: y + 8,
      width: 170,
      height: 0.5,
      color: borderGray,
    });
    page.drawText('Customer Signature', { x: 75, y: y - 2, size: 7.5, font: fontRegular, color: lightGray });

    page.drawRectangle({
      x: pageWidth - 210,
      y: y + 8,
      width: 170,
      height: 0.5,
      color: borderGray,
    });
    page.drawText('For Event Point Ranchi', { x: pageWidth - 175, y: y - 2, size: 7.5, font: fontRegular, color: lightGray });

    // Footer timestamp & copyright
    page.drawText(cleanPdfText(`Generated on ${new Date().toUTCString()} - Official Document - Event Point Ranchi`), {
      x: 40,
      y: 24,
      size: 7,
      font: fontRegular,
      color: lightGray,
    });

    page.drawText('Page 1 of 1', {
      x: pageWidth - 80,
      y: 24,
      size: 7,
      font: fontRegular,
      color: lightGray,
    });

    return pdfDoc.save();
  }
}

let enquiryReceiptServiceInstance: EnquiryReceiptService | null = null;

export function getEnquiryReceiptService(baseUrl?: string): EnquiryReceiptService {
  if (!enquiryReceiptServiceInstance) {
    enquiryReceiptServiceInstance = new EnquiryReceiptService(baseUrl);
  }
  return enquiryReceiptServiceInstance;
}

export async function getEnquiryReceiptData(refOrToken: string, baseUrl?: string): Promise<EnquiryReceiptData | null> {
  return getEnquiryReceiptService(baseUrl).getEnquiryReceiptData(refOrToken, baseUrl);
}

export async function generateEnquiryReceiptPdf(data: EnquiryReceiptData): Promise<Uint8Array> {
  return getEnquiryReceiptService().generateEnquiryReceiptPdf(data);
}

