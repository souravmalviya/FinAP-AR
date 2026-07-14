import { prisma } from "../config/db.js";
import { ErpAdapter, ErpError, NewErpInvoice, OrgErpConfig } from "./types.js";
import { miniErpAdapter } from "./miniErpAdapter.js";

// Re-export the shared types so callers keep importing everything from here.
export { ErpError } from "./types.js";
export type { ErpVendor, ErpPurchaseOrder, ErpInvoice } from "./types.js";

// ----------------------------------------------------------------------------
//  ERP client - the pipeline's single door to "the org's ERP".
//
//  How a call flows:
//    pipeline calls listVendors(orgId)
//      -> resolve(orgId): load the org's ERP config (which ERP, where, as whom)
//      -> pick the adapter for org.erpType from the REGISTRY below
//      -> delegate the operation to that adapter
//
//  ADDING A NEW ERP (e.g. ERPNext) is exactly two steps:
//    1. write src/erp/erpNextAdapter.ts implementing the ErpAdapter interface
//    2. add one line here:  erpnext: erpNextAdapter,
//  Store the org's real erpBaseUrl/erpApiKey in its Organization row - done.
//  No pipeline, rule, or route code ever changes.
// ----------------------------------------------------------------------------

const ADAPTERS: Record<string, ErpAdapter> = {
  minierp: miniErpAdapter,
  // erpnext: erpNextAdapter,      <- future ERPs slot in here
  // quickbooks: quickBooksAdapter,
};

// Org ERP config rarely changes - a 60s cache avoids a DB hit per ERP call.
const cache = new Map<string, { adapter: ErpAdapter; cfg: OrgErpConfig; at: number }>();

async function resolve(organizationId: string): Promise<{ adapter: ErpAdapter; cfg: OrgErpConfig }> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < 60_000) return hit;

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw new ErpError(500, `No organization "${organizationId}" - cannot resolve its ERP`);
  }
  const adapter = ADAPTERS[org.erpType];
  if (!adapter) {
    throw new ErpError(500, `ERP type "${org.erpType}" is not supported (known: ${Object.keys(ADAPTERS).join(", ")})`);
  }
  const entry = {
    adapter,
    cfg: {
      baseUrl: org.erpBaseUrl,
      company: org.erpCompany,
      apiKey: org.erpApiKey,
      apiSecret: org.erpApiSecret,
    },
    at: Date.now(),
  };
  cache.set(organizationId, entry);
  return entry;
}

// --- The operations the pipeline uses (signatures unchanged) -------------------

export async function listVendors(orgId: string) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.listVendors(cfg);
}

export async function listOpenPOs(orgId: string) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.listOpenPOs(cfg);
}

export async function getPO(orgId: string, id: string) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.getPO(cfg, id);
}

export async function getInvoice(orgId: string, id: string) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.getInvoice(cfg, id);
}

export async function createInvoice(orgId: string, input: NewErpInvoice) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.createInvoice(cfg, input);
}

export async function setInvoiceStatus(
  orgId: string,
  invoiceId: string,
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.setInvoiceStatus(cfg, invoiceId, status);
}

export async function createPayment(
  orgId: string,
  input: { invoiceId: string; amount: number; reference?: string }
) {
  const { adapter, cfg } = await resolve(orgId);
  return adapter.createPayment(cfg, input);
}
