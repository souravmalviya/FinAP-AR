import {
  ErpAdapter, ErpError, ErpInvoice, ErpPurchaseOrder, ErpVendor, NewErpInvoice, OrgErpConfig,
} from "./types.js";

// ----------------------------------------------------------------------------
//  Adapter: miniERP (our local system-of-record).
//
//  Translates the neutral ErpAdapter operations into the miniERP's REST API.
//  Identity: the org's `company` value travels as the x-org-id header.
//
//  This file is the TEMPLATE for future adapters - an erpNextAdapter would
//  implement the same seven functions against ERPNext's /api/resource
//  endpoints with token auth, and map Supplier -> ErpVendor and so on.
// ----------------------------------------------------------------------------

async function request<T>(
  cfg: OrgErpConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-org-id": cfg.company },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure (ERP down/unreachable) - a clear message beats ECONNREFUSED.
    throw new ErpError(503, `ERP unreachable at ${cfg.baseUrl} - is it running?`);
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new ErpError(res.status, data.error ?? `ERP call failed: ${method} ${path}`);
  }
  return data as T;
}

export const miniErpAdapter: ErpAdapter = {
  listVendors: (cfg) => request<ErpVendor[]>(cfg, "GET", "/vendors"),

  listOpenPOs: (cfg) => request<ErpPurchaseOrder[]>(cfg, "GET", "/purchase-orders?status=OPEN"),

  getPO: (cfg, id) => request<ErpPurchaseOrder>(cfg, "GET", `/purchase-orders/${id}`),

  getInvoice: (cfg, id) => request<ErpInvoice>(cfg, "GET", `/invoices/${id}`),

  createInvoice: (cfg, input: NewErpInvoice) =>
    request<ErpInvoice>(cfg, "POST", "/invoices", { type: "AP", ...input }),

  setInvoiceStatus: (cfg, invoiceId, status) =>
    request<ErpInvoice>(cfg, "PATCH", `/invoices/${invoiceId}/status`, { status }),

  createPayment: (cfg, input) => request<{ id: string }>(cfg, "POST", "/payments", input),
};
