import { runDatabaseIntegrityAudit } from '../src/core/operational/db-integrity-service';

async function main() {
  console.log('====================================================');
  console.log('  Event Point Ranchi — Database & Ledger Integrity Audit');
  console.log('====================================================\n');

  try {
    const report = await runDatabaseIntegrityAudit();

    console.log(`Audit Timestamp: ${report.timestamp}`);
    console.log(`Overall Health Status: [${report.status}]\n`);

    console.log('Entity Counts:');
    console.log(`- Enquiries:           ${report.counts.enquiries}`);
    console.log(`- Enquiry Line Items:  ${report.counts.enquiryLineItems}`);
    console.log(`- Customers:           ${report.counts.customers}`);
    console.log(`- Bookings:            ${report.counts.bookings}`);
    console.log(`- Booking Items:       ${report.counts.bookingItems}`);
    console.log(`- Payments:            ${report.counts.payments}`);
    console.log(`- Payment Receipts:    ${report.counts.receipts}`);
    console.log(`- Storage Objects:     ${report.counts.storageObjects}\n`);

    if (report.issues.length === 0) {
      console.log('✔ All integrity constraints verified. No anomalies detected across D1, Neon, and storage ledgers.');
      process.exit(0);
    } else {
      console.log(`⚠ Found ${report.issues.length} integrity issue(s):`);
      for (const issue of report.issues) {
        console.log(`  [${issue.severity}] [${issue.category}] ${issue.message} (Count: ${issue.count})`);
        if (issue.sampleIds && issue.sampleIds.length > 0) {
          console.log(`     Sample references/IDs: ${issue.sampleIds.join(', ')}`);
        }
      }
      process.exit(report.status === 'CRITICAL' ? 1 : 0);
    }
  } catch (error: any) {
    console.error('Audit execution error:', error?.message || error);
    process.exit(1);
  }
}

main();
