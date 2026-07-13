import { prisma } from "../config/db.js";

// ----------------------------------------------------------------------------
//  ERP client - the ONLY file that knows how to talk to the ERP.
//
//  ORG-AWARE since the Organization entity landed: each organization's row in
//  Verity's DB says WHICH ERP it uses (erpType), WHERE it lives (erpBaseUrl),
//  and WHAT the org is called inside that ERP (erpCompany). This function
//  looks that up and dials accordingly - so different orgs can use different
//  ERPs, and swapping the miniERP for ERPNext is a config change plus one new
//  adapter branch, never a pipeline change.
// ----------------------------------------------------------------------------

export class ErpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface ErpTarget {
  erpType: string;
  erpBaseUrl: string;
  erpCompany: string;
}

// Small in-memory cache: org ERP config rarely changes, no need to hit the
// DB on every single ERP call. 60s TTL keeps edits picked up quickly.
const targetCache = new Map<string, { target: ErpTarget; at: number }>();

async function getTarget(organizationId: string): Promise<ErpTarget> {
  const hit = targetCache.get(organizationId);
  if (hit && Date.now() - hit.at < 60_000) return hit.target;

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw new ErpError(500, `No organization "${organizationId}" - cannot resolve its ERP`);
  }
  const target = { erpType: org.erpType, erpBaseUrl: org.erpBaseUrl, erpCompany: org.erpCompany };
  targetCache.set(organizationId, { target, at: Date.now() });
  return target;
}

async function erp<T>(
  organizationId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const target = await getTarget(organizationId);

  // Adapter branch point: when ERPNext support lands, "erpnext" gets its own
  // request shape here (its REST API + token auth), same function signatures.
  if (target.erpType !== "minierp") {
    throw new ErpError(500, `ERP type "${target.erpType}" is not supported yet`);
  }

  const res = await fetch(`${target.erpBaseUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-org-id": target.erpCompany, // the org's name INSIDE the ERP
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
