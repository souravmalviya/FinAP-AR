// ----------------------------------------------------------------------------
//  API client — the dashboard's single door to the pipeline (:5000).
//  Every request carries the login token (Authorization: Bearer ...).
//  The tenant is derived server-side from the logged-in user — the frontend
//  cannot spoof it.
// ----------------------------------------------------------------------------

// Locally this falls back to the dev pipeline. In production (e.g. Vercel),
// set NEXT_PUBLIC_API_URL to the deployed backend (e.g. Railway URL) —
// NEXT_PUBLIC_* vars are baked into the browser bundle at build time.
const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000") + "/api";

// --- session ------------------------------------------------------------------

export interface SessionUser {
  id: string;
  organizationId: string;
  name: string;
  role: "ADMIN" | "AP_CLERK" | "FINANCE_HEAD" | "CFO" | "EMPLOYEE";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Login failed");
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data.user as SessionUser;
}

export async function register(
  name: string,
  email: string,
  password: string,
  role: string
): Promise<SessionUser> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, role }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || "Registration failed");
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data.user as SessionUser;
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/login";
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth")) {
    // Token missing/expired -> back to the login page.
    logout();
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}

// --- Types mirroring the pipeline's API --------------------------------------

export type DocStatus =
  | "RECEIVED" | "QUEUED" | "EXTRACTING" | "NEEDS_REVIEW" | "MATCHED"
  | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PAID" | "DUPLICATE" | "FAILED";

export interface Extraction {
  vendorName: string | null;
  invoiceNo: string | null;
  poNumber: string | null;
  amount: string | null; // Decimal serialises as string
  dueDate: string | null;
  engine: "MOCK" | "CLAUDE" | "OPENROUTER";
}

export interface WorkflowEvent {
  id: string;
  step: string;
  actor: "SYSTEM" | "AI" | "RULE" | "HUMAN";
  message: string;
  createdAt: string;
}

export interface ApprovalTask {
  id: string;
  documentId: string;
  requiredRole: "FINANCE_HEAD" | "CFO";
  status: "PENDING" | "APPROVED" | "REJECTED";
  document?: DocumentRow;
}

export interface DocumentRow {
  id: string;
  fileName: string;
  status: DocStatus;
  failReason: string | null;
  erpInvoiceId: string | null;
  createdAt: string;
  extraction: Extraction | null;
  approval: ApprovalTask | null;
  events?: WorkflowEvent[];
}

// --- Operations ----------------------------------------------------------------

export const listDocuments = () => api<DocumentRow[]>("/documents");
export const getDocument = (id: string) => api<DocumentRow>(`/documents/${id}`);
export const listApprovals = () => api<ApprovalTask[]>("/approvals");

export function uploadDocument(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ documentId: string; status: string }>("/documents/upload", {
    method: "POST",
    body: fd,
  });
}

// decidedBy now comes from the logged-in user server-side — nothing to send.
export const approveTask = (id: string) =>
  api(`/approvals/${id}/approve`, { method: "POST", body: JSON.stringify({}) });

export const rejectTask = (id: string) =>
  api(`/approvals/${id}/reject`, { method: "POST", body: JSON.stringify({}) });

export const payDocument = (id: string) =>
  api(`/documents/${id}/pay`, { method: "POST", body: JSON.stringify({}) });

// --- Small helpers ----------------------------------------------------------------

export const inr = (v: string | number | null | undefined) =>
  v == null ? "—" : "₹" + Number(v).toLocaleString("en-IN");

// "2m ago" style timestamps for tables.
export function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
