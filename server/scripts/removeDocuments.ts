import "dotenv/config";
import { PrismaClient } from "@prisma/client";
// Looks redundant (process is a Node global) but is NOT: tsconfig only includes
// src/**, so this file is outside the TS project and the editor loads it without
// @types/node. Without this import you get "Cannot find name 'process'".
import process from "process";

// ----------------------------------------------------------------------------
//  ADMIN TOOL - remove ingested documents by file name.
//
//  This is NOT a product feature. The product has no delete by design: invoices
//  are financial records and the audit trail is append-only. This exists for the
//  one legitimate case that design does not cover - material that should never
//  have been ingested in the first place, such as personal documents an email
//  poller picked up by accident.
//
//  Dry run by default. Nothing is touched unless you pass --confirm.
//
//    npx tsx scripts/removeDocuments.ts "Receipt-1234.pdf" "Invoice-5678.pdf"
//    npx tsx scripts/removeDocuments.ts "Receipt-1234.pdf" --confirm
//
//  Point DATABASE_URL at whichever database you mean (local or the deployed
//  one) BEFORE running it.
// ----------------------------------------------------------------------------

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirm = args.includes("--confirm");
const names = args.filter((a) => !a.startsWith("--"));

async function main() {
  if (names.length === 0) {
    console.error('Give at least one file name, e.g. "Receipt-2235-1866-8171.pdf"');
    process.exit(1);
  }

  const docs = await prisma.ingestedDocument.findMany({
    where: { fileName: { in: names } },
    include: { extraction: true, approval: true, events: true },
  });

  if (docs.length === 0) {
    console.log("No documents matched those file names. Nothing to do.");
    return;
  }

  console.log(`${confirm ? "REMOVING" : "WOULD REMOVE"} ${docs.length} document(s):\n`);
  for (const d of docs) {
    console.log(`  ${d.fileName}`);
    console.log(`    id          : ${d.id}`);
    console.log(`    status      : ${d.status}`);
    console.log(`    org         : ${d.organizationId}`);
    console.log(`    storage key : ${d.storageKey}   <-- delete this object from S3 too`);
    console.log(`    also removes: ${d.events.length} audit event(s)` +
      `, ${d.extraction ? "1 extraction" : "no extraction"}` +
      `, ${d.approval ? "1 approval task" : "no approval task"}`);
    if (d.erpInvoiceId) {
      console.log(`    NOTE: this document created ERP invoice ${d.erpInvoiceId}.`);
      console.log(`          That record lives in the ERP and is NOT touched here.`);
    }
    console.log("");
  }

  if (!confirm) {
    console.log("Dry run. Re-run with --confirm to actually delete.");
    return;
  }

  // Children first: none of the relations cascade, so the parent cannot go
  // until nothing references it. One transaction, so a failure leaves the
  // database exactly as it was.
  const ids = docs.map((d) => d.id);
  const [events, extractions, approvals, documents] = await prisma.$transaction([
    prisma.workflowEvent.deleteMany({ where: { documentId: { in: ids } } }),
    prisma.extraction.deleteMany({ where: { documentId: { in: ids } } }),
    prisma.approvalTask.deleteMany({ where: { documentId: { in: ids } } }),
    prisma.ingestedDocument.deleteMany({ where: { id: { in: ids } } }),
  ]);

  console.log("Removed:");
  console.log(`  ${events.count} audit event(s)`);
  console.log(`  ${extractions.count} extraction(s)`);
  console.log(`  ${approvals.count} approval task(s)`);
  console.log(`  ${documents.count} document(s)`);
  console.log("\nThe PDFs themselves are still in S3 - remove those separately.");
  console.log("Deleting the rows also clears the sha256 fingerprints, so if the");
  console.log("source emails are still in the poller's 3-day window they WILL be");
  console.log("ingested again. Remove them from the inbox first.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
