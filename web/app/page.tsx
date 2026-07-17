"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentRow, getUser, inr, listDocuments, timeAgo, uploadDocument } from "@/lib/api";

// ----------------------------------------------------------------------------
//  Documents - mission control. Polls every 3s so you watch invoices move:
//  QUEUED -> EXTRACTING -> MATCHED -> PENDING_APPROVAL -> APPROVED -> PAID
// ----------------------------------------------------------------------------

type Filter = "ALL" | "PROCESSING" | "ATTENTION" | "WAITING" | "DONE";

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

  return (
    <>
      <h1>Documents</h1>
      <p className="sub">Every invoice that entered the pipeline, newest first. Click a row for its full audit timeline.</p>

      <div className="stats">
        <div className="stat t-accent"><div className="n">{docs?.length ?? "–"}</div><div className="l">Total</div></div>
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
          <span>Drag a PDF here, or browse - this plays the role of the vendor&apos;s email</span>
        </div>
        <input type="file" accept="application/pdf" ref={fileRef} onChange={(e) => ingest(e.target.files?.[0])} />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Browse PDF"}
        </button>
      </div>}

      {error && <div className="flag">⚠ {error}</div>}

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
                  : filter === "ALL" ? "Nothing yet - upload an invoice PDF above." : "No documents match this filter."}
              </td></tr>
            )}
            {shown.map((d) => (
              <tr key={d.id} className="rowlink" onClick={() => router.push(`/documents/${d.id}`)}>
                <td className="filecell">{d.fileName}</td>
                <td>{d.extraction?.vendorName ?? "-"}</td>
                <td className="mono">{d.extraction?.invoiceNo ?? "-"}</td>
                <td className="mono">{d.extraction?.poNumber ?? "-"}</td>
                <td>{inr(d.extraction?.amount)}</td>
                <td><span className={`badge s-${d.status}`}>{d.status.replace(/_/g, " ")}</span></td>
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
