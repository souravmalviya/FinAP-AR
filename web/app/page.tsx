"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentRow, getUser, inr, listDocuments, timeAgo, uploadDocument } from "@/lib/api";

// ----------------------------------------------------------------------------
//  Documents - mission control. Polls every 3s so you watch invoices move:
//  QUEUED -> EXTRACTING -> MATCHED -> PENDING_APPROVAL -> APPROVED -> PAID
// ----------------------------------------------------------------------------

type Filter = "ALL" | "PROCESSING" | "ATTENTION" | "WAITING" | "DONE";

// Must match the server's UPLOAD_MAX_MB (config/env.ts, default 10). The server
// is the real gate; this is the fast, friendly one so the user finds out before
// the upload rather than after it.
const MAX_UPLOAD_MB = 10;

// Plain-language meaning of each status, shown on hover. The enum names are
// precise for engineers and opaque to everyone else.
const STATUS_HELP: Record<string, string> = {
  RECEIVED: "Arrived, waiting to be picked up for processing",
  QUEUED: "Waiting for a worker to start processing it",
  EXTRACTING: "AI is reading the vendor, invoice number, PO and amount",
  MATCHED: "Verified against the ERP and linked to its purchase order",
  PENDING_APPROVAL: "Waiting for a person to approve it",
  APPROVED: "Approved, ready to be paid",
  PAID: "Payment recorded in the ERP; the purchase order is now closed",
  NEEDS_REVIEW: "A verification rule failed - a person needs to look at it",
  REJECTED: "A person declined this invoice",
  DUPLICATE: "This invoice was already in the system",
  FAILED: "Something went wrong while processing; see the audit trail",
};

const FILTERS: { key: Filter; label: string; statuses: string[] | null }[] = [
  { key: "ALL", label: "All", statuses: null },
  { key: "PROCESSING", label: "Processing", statuses: ["RECEIVED", "QUEUED", "EXTRACTING"] },
  { key: "WAITING", label: "Awaiting approval", statuses: ["PENDING_APPROVAL"] },
  { key: "ATTENTION", label: "Needs attention", statuses: ["NEEDS_REVIEW", "FAILED", "DUPLICATE", "REJECTED"] },
  { key: "DONE", label: "Approved & paid", statuses: ["MATCHED", "APPROVED", "PAID"] },
];

export default function DocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null); // null = first load
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState(""); // what the user is typing
  const [q, setQ] = useState(""); // debounced copy that actually hits the API
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [canUpload, setCanUpload] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // EMPLOYEE is view-only - hide the upload zone (server enforces it anyway).
  useEffect(() => {
    const u = getUser();
    setCanUpload(!!u && u.role !== "EMPLOYEE");
  }, []);

  // Debounce: wait 350ms after the last keystroke before searching, so we
  // don't fire one API call per typed character.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments(q));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline API unreachable (is :5000 running?)");
    }
  }, [q]);

  // Runs on mount AND whenever the debounced query changes (refresh is
  // recreated then) - so the 3s poll always polls with the current search.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  function notify(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  }

  async function ingest(file: File | undefined | null) {
    if (!file) return notify("Choose a PDF first", false);
    if (!file.name.toLowerCase().endsWith(".pdf")) return notify("Only PDF invoices are accepted", false);
    // Reject oversized files BEFORE uploading. The server enforces the same cap
    // (UPLOAD_MAX_MB), but without this check the browser would spend a minute
    // pushing 15 MB over mobile data only to be told no at the end.
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      return notify(`"${file.name}" is ${mb} MB - the limit is ${MAX_UPLOAD_MB} MB`, false);
    }
    if (file.size === 0) return notify("That file is empty", false);
    setBusy(true);
    try {
      await uploadDocument(file);
      notify(`"${file.name}" ingested - watch it move ↓`, true);
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload failed", false);
    } finally {
      setBusy(false);
    }
  }

  const active = FILTERS.find((f) => f.key === filter)!;
  const shown = (docs ?? []).filter((d) => !active.statuses || active.statuses.includes(d.status));
  const count = (...statuses: string[]) => (docs ?? []).filter((d) => statuses.includes(d.status)).length;
  // Loaded, genuinely empty, and not just filtered/searched down to nothing.
  const isFirstRun = docs !== null && docs.length === 0 && !q;

  return (
    <>
      <h1>Documents</h1>
      <p className="sub">Every invoice that entered the pipeline, newest first. Click a row for its full audit timeline.</p>

      <div className="stats">
        <div className="stat t-accent"><div className="n">{docs?.length ?? "-"}</div><div className="l">Total</div></div>
        <div className="stat t-blue"><div className="n">{count("QUEUED", "EXTRACTING", "RECEIVED")}</div><div className="l">Processing</div></div>
        <div className="stat t-amber"><div className="n">{count("PENDING_APPROVAL")}</div><div className="l">Awaiting approval</div></div>
        <div className="stat t-red"><div className="n">{count("NEEDS_REVIEW", "FAILED")}</div><div className="l">Needs review</div></div>
        <div className="stat t-green"><div className="n">{count("PAID")}</div><div className="l">Paid</div></div>
      </div>

      {canUpload && <div
        className={`upload ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); ingest(e.dataTransfer.files?.[0]); }}
      >
        <div className="icon">📥</div>
        <div className="txt">
          <b>Simulate an incoming invoice</b>
          <span>Drag a PDF here, or browse - this plays the role of the vendor&apos;s email. PDF only, up to {MAX_UPLOAD_MB} MB.</span>
        </div>
        <input type="file" accept="application/pdf" ref={fileRef} onChange={(e) => ingest(e.target.files?.[0])} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Browse PDF"}
        </button>
      </div>}

      {error && <div className="flag">⚠ {error}</div>}

      {/* First run: no documents at all. This is the one moment a newcomer has
          no idea what the product does, so use the space to explain the flow
          instead of showing an empty table and empty filters. It disappears
          for good as soon as a single invoice exists. */}
      {isFirstRun && (
        <div className="card pad howto">
          <h3>No invoices yet. Here is what happens when one arrives.</h3>
          <ol>
            <li><b>It arrives.</b> A vendor emails the invoice PDF, or you drop one in the box above. Both routes go through the same front door.</li>
            <li><b>AI reads it.</b> The only AI step in the system pulls out the vendor, invoice number, purchase order reference and amount. Its answer is treated as a claim, not a fact.</li>
            <li><b>Rules verify it.</b> Five deterministic checks run against your ERP: are the fields complete, does the vendor exist, is there an open purchase order, does that PO belong to this vendor, and do the amounts match exactly.</li>
            <li><b>It gets routed.</b> Under {inr(50000)} approves automatically. Larger amounts wait for a finance head, and above {inr(500000)} for the CFO.</li>
          </ol>
          <p className="howto-note">
            Nothing is written to your ERP until every rule passes, and every step is recorded in an audit trail you can open from any invoice.
          </p>
        </div>
      )}

      <div className="listbar">
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="searchbox">
          <span className="glass">🔍</span>
          <input
            type="text"
            placeholder="Search vendor, invoice #, PO, file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search documents"
          />
          {search && (
            <button className="clear" onClick={() => setSearch("")} aria-label="Clear search">×</button>
          )}
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>File</th><th>Vendor</th><th>Invoice #</th><th>PO Ref</th>
              <th>Amount</th><th>Status</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {docs === null &&
              [1, 2, 3].map((i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                  <td key={j}><div className="skel" style={{ width: `${55 + ((i * j * 17) % 40)}%` }} /></td>
                ))}</tr>
              ))}
            {docs !== null && shown.length === 0 && (
              <tr><td colSpan={7} className="empty">
                {q
                  ? `No invoices match "${q}"${filter !== "ALL" ? " in this filter" : ""}.`
                  : filter === "ALL" ? "Nothing yet - send or upload an invoice to begin." : "No documents match this filter."}
              </td></tr>
            )}
            {shown.map((d) => (
              <tr key={d.id} className="rowlink" onClick={() => router.push(`/documents/${d.id}`)}>
                <td className="filecell">{d.fileName}</td>
                <td>{d.extraction?.vendorName ?? "-"}</td>
                <td className="mono">{d.extraction?.invoiceNo ?? "-"}</td>
                <td className="mono">{d.extraction?.poNumber ?? "-"}</td>
                <td>{inr(d.extraction?.amount)}</td>
                <td>
                  <span className={`badge s-${d.status}`} title={STATUS_HELP[d.status] ?? d.status}>
                    {d.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="dim">{timeAgo(d.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.msg}</div>}
    </>
  );
}
