import { env } from "../config/env.js";

// ----------------------------------------------------------------------------
//  ERP client - the ONLY file that knows how to talk to the ERP.
//
//  Today it targets your Mini-ERP's REST API (localhost:4000).
//  To support QuickBooks/SAP later, you write another client with these same
//  function names and swap it in. The pipeline never changes.
//
//  Every call carries x-org-id - the ERP's multi-tenant rule.
// ----------------------------------------------------------------------------

export class ErpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function erp<T>(
  organizationId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${env.ERP_BASE_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-org-id": organizationId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new ErpError(res.status, data.error ?? `ERP call failed: ${method} ${path}`);
  }
  return data as T;
}

// --- Types mirroring the Mini-ERP's API shapes (only fields we use) ---------

export interface ErpVendor {
  id: string;
  name: string;
}

export interface ErpPurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  amount: string; // Prisma Decimal serialises as string
  status: "OPEN" | "MATCHED" | "CLOSED" | "CANCELLED";
}

export interface ErpInvoice {
  id: string;
  invoiceNo: string;
  amount: string;
  status: "RECEIVED" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID";
  purchaseOrderId: string | null;
}

// --- The operations the pipeline needs --------------------------------------

export function listVendors(orgId: string) {
  return erp<ErpVendor[]>(orgId, "GET", "/vendors");
}

export function listOpenPOs(orgId: string) {
  return erp<ErpPurchaseOrder[]>(orgId, "GET", "/purchase-orders?status=OPEN");
}

export function getPO(orgId: string, id: string) {
  return erp<ErpPurchaseOrder>(orgId, "GET", `/purchase-orders/${id}`);
}

export function getInvoice(orgId: string, id: string) {
  return erp<ErpInvoice>(orgId, "GET", `/invoices/${id}`);
}

export function createInvoice(
  orgId: string,
  input: {
    invoiceNo: string;
    amount: number;
    dueDate: string; // ISO date
    vendorId: string;
    purchaseOrderId?: string;
  }
) {
  return erp<ErpInvoice>(orgId, "POST", "/invoices", { type: "AP", ...input });
}

export function setInvoiceStatus(
  orgId: string,
  invoiceId: string,
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
) {
  return erp<ErpInvoice>(orgId, "PATCH", `/invoices/${invoiceId}/status`, { status });
}

export function createPayment(
  orgId: string,
  input: { invoiceId: string; amount: number; reference?: string }
) {
  return erp<{ id: string }>(orgId, "POST", "/payments", input);
}
