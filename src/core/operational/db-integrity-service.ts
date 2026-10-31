import { getNeonClient } from './neon-client';
import { one } from '../db';
import { imageStorage } from '../storage/service';

export interface IntegrityIssue {
  category: 'ENQUIRIES' | 'BOOKINGS' | 'PAYMENTS' | 'STORAGE';
  severity: 'CRITICAL' | 'WARNING';
  message: string;
  count: number;
  sampleIds?: Array<number | string>;
}

export interface IntegrityAuditReport {
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  timestamp: string;
  counts: {
    enquiries: number;
    enquiryLineItems: number;
    customers: number;
    bookings: number;
    bookingItems: number;
    payments: number;
    receipts: number;
    storageObjects: number;
  };
  issues: IntegrityIssue[];
}

export async function runDatabaseIntegrityAudit(): Promise<IntegrityAuditReport> {
  const issues: IntegrityIssue[] = [];
  const timestamp = new Date().toISOString();
  const counts = {
    enquiries: 0,
    enquiryLineItems: 0,
    customers: 0,
    bookings: 0,
    bookingItems: 0,
    payments: 0,
    receipts: 0,
    storageObjects: 0,
  };

  const neon = getNeonClient();

  // 1. Audit Enquiries & Line Items (Neon + SQLite)
  try {
    const enqCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM event_enquiries');
    counts.enquiries = Number(enqCountRes.rows[0]?.count || 0);

    // Duplicate Reference Codes in Enquiries
    const dupEnqRes = await neon.query<{ reference_code: string; c: string }>(
      'SELECT reference_code, COUNT(*) AS c FROM event_enquiries GROUP BY reference_code HAVING COUNT(*) > 1'
    );
    if (dupEnqRes.rows.length > 0) {
      issues.push({
        category: 'ENQUIRIES',
        severity: 'CRITICAL',
        message: 'Duplicate enquiry reference codes detected in event_enquiries table.',
        count: dupEnqRes.rows.length,
        sampleIds: dupEnqRes.rows.map((r) => r.reference_code),
      });
    }

    // Enquiry Line Items
    const itemsCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM enquiry_line_items');
    counts.enquiryLineItems = Number(itemsCountRes.rows[0]?.count || 0);

    // Orphaned Line Items
    const orphanItemsRes = await neon.query<{ id: number }>(
      'SELECT id FROM enquiry_line_items WHERE enquiry_id NOT IN (SELECT id FROM event_enquiries)'
    );
    if (orphanItemsRes.rows.length > 0) {
      issues.push({
        category: 'ENQUIRIES',
        severity: 'CRITICAL',
        message: 'Orphaned line items found referencing non-existent enquiries.',
        count: orphanItemsRes.rows.length,
        sampleIds: orphanItemsRes.rows.slice(0, 5).map((r) => r.id),
      });
    }
  } catch (err: any) {
    console.warn('[Integrity Audit] Neon enquiry audit error, checking local fallback:', err?.message);
    try {
      const row = one<{ count: number }>('SELECT COUNT(*) AS count FROM event_enquiries');
      counts.enquiries = row?.count || 0;
    } catch {
      // Ignore
    }
  }

  // 2. Audit Customers & Bookings
  try {
    const custCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM customers');
    counts.customers = Number(custCountRes.rows[0]?.count || 0);

    const bookCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM bookings');
    counts.bookings = Number(bookCountRes.rows[0]?.count || 0);

    // Orphaned Bookings
    const orphanBookRes = await neon.query<{ id: number }>(
      'SELECT id FROM bookings WHERE customer_id NOT IN (SELECT id FROM customers)'
    );
    if (orphanBookRes.rows.length > 0) {
      issues.push({
        category: 'BOOKINGS',
        severity: 'CRITICAL',
        message: 'Bookings found referencing non-existent customer IDs.',
        count: orphanBookRes.rows.length,
        sampleIds: orphanBookRes.rows.slice(0, 5).map((r) => r.id),
      });
    }

    // Booking Items
    try {
      const bookItemsCount = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM booking_items');
      counts.bookingItems = Number(bookItemsCount.rows[0]?.count || 0);

      const orphanBItems = await neon.query<{ id: number }>(
        'SELECT id FROM booking_items WHERE booking_id NOT IN (SELECT id FROM bookings)'
      );
      if (orphanBItems.rows.length > 0) {
        issues.push({
          category: 'BOOKINGS',
          severity: 'CRITICAL',
          message: 'Orphaned booking_items found referencing non-existent bookings.',
          count: orphanBItems.rows.length,
          sampleIds: orphanBItems.rows.slice(0, 5).map((r) => r.id),
        });
      }
    } catch {
      // Table may be empty
    }

    // Financial Math Inconsistencies: total_amount != amount_paid + outstanding_balance
    const mathMismatchRes = await neon.query<{ id: number; total_amount: string; amount_paid: string; outstanding_balance: string }>(
      'SELECT id, total_amount, amount_paid, outstanding_balance FROM bookings WHERE (amount_paid + outstanding_balance) != total_amount'
    );
    if (mathMismatchRes.rows.length > 0) {
      issues.push({
        category: 'BOOKINGS',
        severity: 'CRITICAL',
        message: 'Ledger discrepancy detected: total_amount does not match amount_paid + outstanding_balance.',
        count: mathMismatchRes.rows.length,
        sampleIds: mathMismatchRes.rows.slice(0, 5).map((r) => r.id),
      });
    }

    // Fully paid bookings with non-zero outstanding balance
    const statusMismatchRes = await neon.query<{ id: number }>(
      "SELECT id FROM bookings WHERE payment_status = 'paid' AND outstanding_balance > 0"
    );
    if (statusMismatchRes.rows.length > 0) {
      issues.push({
        category: 'BOOKINGS',
        severity: 'WARNING',
        message: 'Bookings marked with status "paid" but retaining positive outstanding balance.',
        count: statusMismatchRes.rows.length,
        sampleIds: statusMismatchRes.rows.slice(0, 5).map((r) => r.id),
      });
    }
  } catch (err: any) {
    console.warn('[Integrity Audit] Neon booking audit warning:', err?.message);
  }

  // 3. Audit Payments & Receipts
  try {
    const payCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM payments');
    counts.payments = Number(payCountRes.rows[0]?.count || 0);

    const rcptCountRes = await neon.query<{ count: string }>('SELECT COUNT(*) AS count FROM payment_receipts');
    counts.receipts = Number(rcptCountRes.rows[0]?.count || 0);

    // Duplicate Receipt Numbers
    const dupReceipts = await neon.query<{ receipt_number: string; c: string }>(
      'SELECT receipt_number, COUNT(*) AS c FROM payment_receipts GROUP BY receipt_number HAVING COUNT(*) > 1'
    );
    if (dupReceipts.rows.length > 0) {
      issues.push({
        category: 'PAYMENTS',
        severity: 'CRITICAL',
        message: 'Duplicate payment receipt numbers detected.',
        count: dupReceipts.rows.length,
        sampleIds: dupReceipts.rows.map((r) => r.receipt_number),
      });
    }

    // Orphaned Receipts
    const orphanRcptRes = await neon.query<{ id: number }>(
      'SELECT id FROM payment_receipts WHERE payment_id NOT IN (SELECT id FROM payments)'
    );
    if (orphanRcptRes.rows.length > 0) {
      issues.push({
        category: 'PAYMENTS',
        severity: 'CRITICAL',
        message: 'Orphaned payment receipts referencing non-existent payments.',
        count: orphanRcptRes.rows.length,
        sampleIds: orphanRcptRes.rows.slice(0, 5).map((r) => r.id),
      });
    }
  } catch (err: any) {
    console.warn('[Integrity Audit] Neon payment audit warning:', err?.message);
  }

  // 4. Audit Storage Ledger
  try {
    const storageStats = imageStorage.getStorageUsage();
    counts.storageObjects = storageStats.objectCount;

    if (storageStats.gallery.usedBytes > storageStats.gallery.limitBytes) {
      issues.push({
        category: 'STORAGE',
        severity: 'CRITICAL',
        message: `Gallery storage exceeds allocated quota (${(storageStats.gallery.usedBytes / (1024 * 1024)).toFixed(1)} MB used / ${(storageStats.gallery.limitBytes / (1024 * 1024)).toFixed(1)} MB limit).`,
        count: 1,
      });
    }

    if (storageStats.asset.usedBytes > storageStats.asset.limitBytes) {
      issues.push({
        category: 'STORAGE',
        severity: 'CRITICAL',
        message: `Asset storage exceeds allocated quota (${(storageStats.asset.usedBytes / (1024 * 1024)).toFixed(1)} MB used / ${(storageStats.asset.limitBytes / (1024 * 1024)).toFixed(1)} MB limit).`,
        count: 1,
      });
    }
  } catch (err: any) {
    console.warn('[Integrity Audit] Storage audit warning:', err?.message);
  }

  const hasCritical = issues.some((i) => i.severity === 'CRITICAL');
  const hasWarning = issues.some((i) => i.severity === 'WARNING');
  const status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = hasCritical ? 'CRITICAL' : hasWarning ? 'WARNING' : 'HEALTHY';

  return {
    status,
    timestamp,
    counts,
    issues,
  };
}

/**
 * Automatically reconcile booking ledger math discrepancies.
 */
export async function reconcileBookingBalances(): Promise<number> {
  const neon = getNeonClient();
  try {
    const res = await neon.query(
      `UPDATE bookings
       SET outstanding_balance = GREATEST(0, total_amount - amount_paid),
           payment_status = CASE 
             WHEN amount_paid >= total_amount AND total_amount > 0 THEN 'paid'
             WHEN amount_paid > 0 THEN 'partially_paid'
             ELSE 'unpaid'
           END
       WHERE (amount_paid + outstanding_balance) != total_amount`
    );
    return res.rowCount || 0;
  } catch (err) {
    console.warn('[Reconcile Booking Balances error]:', err);
    return 0;
  }
}
