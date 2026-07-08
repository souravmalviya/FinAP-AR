import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "fs";
import path from "path";

// ----------------------------------------------------------------------------
//  Generates a realistic vendor invoice PDF for demos.
//
//  Usage:
//    npm run sample:invoice                                   -> the clean Acer invoice
//    npm run sample:invoice -- --amount 290000 --no ACR-557   -> a MISMATCH invoice
//    npm run sample:invoice -- --vendor "HP" --po PO-X --no H-1 --amount 30000
// ----------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const vendor = arg("vendor", "Acer India Pvt Ltd");
const invoiceNo = arg("no", "ACR-556");
const poRef = arg("po", "PO-2026-007");
const amount = arg("amount", "250000");
const dueDate = arg("due", "2026-08-30");

const outDir = path.join(process.cwd(), "samples");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${invoiceNo}.pdf`);

const doc = new PDFDocument({ margin: 50 });
doc.pipe(createWriteStream(outFile));

doc.fontSize(22).text("TAX INVOICE", { align: "center" }).moveDown(1.5);

doc.fontSize(12);
doc.text(`Vendor: ${vendor}`);
doc.text(`Invoice No: ${invoiceNo}`);
doc.text(`PO Ref: ${poRef}`);
doc.text(`Invoice Date: 2026-07-06`);
doc.text(`Due Date: ${dueDate}`).moveDown(1);

doc.text("Description: Laptops as per purchase order", { continued: false }).moveDown(1);

doc.fontSize(14).text(`Amount Due: INR ${amount}`).moveDown(2);

doc.fontSize(10).fillColor("#555")
  .text("Payment terms: NET 30. Please quote the invoice number in your bank reference.");

doc.end();

console.log(`Sample invoice written to ${outFile}`);
console.log(`  vendor=${vendor}  invoiceNo=${invoiceNo}  po=${poRef}  amount=${amount}`);
