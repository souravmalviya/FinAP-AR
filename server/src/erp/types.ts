// ----------------------------------------------------------------------------
//  The ERP contract.
//
//  Verity's pipeline only ever speaks THIS vocabulary. Every concrete ERP
//  (miniERP today; ERPNext, QuickBooks, Xero tomorrow) provides an adapter
//  that translates these seven operations into its own API. Adding a new ERP
//  therefore means: one new adapter file + one line in the registry
//  (erpClient.ts). Nothing in the pipeline, rules, or routes ever changes.
// ----------------------------------------------------------------------------

// What Verity knows about the org's ERP connection (from the Organization row).
export interface OrgErpConfig {
  baseUrl: string; // where the ERP lives
  company: string; // the org's identity INSIDE the ERP (x-org-id / ERPNext company / QB realm)
  apiKey?: string | null; // credentials, for ERPs that need them
  apiSecret?: string | null;
}

// --- The neutral shapes the pipeline works with ------------------------------
// (Each adapter maps its ERP's own field names into these.)

export interface ErpVendor {
  id: string;
  name: string;
}

export interface ErpPurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  amount: string; // decimal as string - never floats for money
  status: "OPEN" | "MATCHED" | "CLOSED" | "CANCELLED";
}

export interface ErpInvoice {
  id: string;
  invoiceNo: string;
  amount: string;
  status: "RECEIVED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID";
  purchaseOrderId: string | null;
}

export interface NewErpInvoice {
  invoiceNo: string;
  amount: number;
  dueDate: string; // ISO date
  vendorId: string;
  purchaseOrderId?: string;
}

// Thrown by adapters; the pipeline and API treat it uniformly
// (e.g. 409 duplicate handling, conflict reconciliation).
export class ErpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// --- The adapter interface: the seven operations Verity needs -----------------
export interface ErpAdapter {
  listVendors(cfg: OrgErpConfig): Promise<ErpVendor[]>;
  listOpenPOs(cfg: OrgErpConfig): Promise<ErpPurchaseOrder[]>;
  getPO(cfg: OrgErpConfig, id: string): Promise<ErpPurchaseOrder>;
  getInvoice(cfg: OrgErpConfig, id: string): Promise<ErpInvoice>;
  createInvoice(cfg: OrgErpConfig, input: NewErpInvoice): Promise<ErpInvoice>;
  setInvoiceStatus(
    cfg: OrgErpConfig,
    invoiceId: string,
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
  ): Promise<ErpInvoice>;
  createPayment(
    cfg: OrgErpConfig,
    input: { invoiceId: string; amount: number; reference?: string }
  ): Promise<{ id: string }>;
}
