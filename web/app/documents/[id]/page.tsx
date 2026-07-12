"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { DocumentRow, getDocument, inr, payDocument } from "@/lib/api";

// ----------------------------------------------------------------------------
//  Document detail — what the AI read, where the document is now, and the
//  full audit timeline (who did what: SYSTEM / AI / RULE / HUMAN).
//  This page is the answer to the auditor's question: "prove it."
// ----------------------------------------------------------------------------

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDoc(await getDocument(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function onPay() {
    setBusy(true);
    try {
      await payDocument(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="flag">⚠ {error}</div>;
  if (!doc)
    return (
      <div className="card pad">
        {[70, 45, 60].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%`, marginBottom: 12 }} />)}
      </div>
    );

  const x = doc.extraction;

  return (
    <>
      <p className="sub" style={{ marginBottom: 10 }}><Link href="/">← All documents</Link></p>
      <h1>{doc.fileName}</h1>
      <p className="sub" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className={`badge s-${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>
        {doc.status === "APPROVED" && (
          <button className="btn green sm" onClick={onPay} disabled={busy}>
            {busy ? "Paying…" : "💰 Record Payment"}
          </button>
        )}
      </p>
      {doc.failReason && <div className="flag">🚩 {doc.failReason}</div>}

      <div className="grid2">
        <div className="card pad">
          <h3>What the {x && x.engine !== "MOCK" ? "AI" : "extractor"} read</h3>
          {x ? (
            <div className="kv">
              <span className="k">Vendor</span><span className="v">{x.vendorName ?? "—"}</span>
              <span className="k">Invoice #</span><span className="v mono">{x.invoiceNo ?? "—"}</span>
              <span className="k">PO Ref</span><span className="v mono">{x.poNumber ?? "—"}</span>
              <span className="k">Amount</span><span className="v" style={{ fontWeight: 700 }}>{inr(x.amount)}</span>
              <span className="k">Due date</span><span className="v">{x.dueDate ? new Date(x.dueDate).toLocaleDateString() : "—"}</span>
              <span className="k">Engine</span><span className="v"><span className={`actor ${x.engine !== "MOCK" ? "a-AI" : "a-SYSTEM"}`}>{x.engine}</span></span>
              <span className="k">ERP invoice</span><span className="v mono">{doc.erpInvoiceId ? doc.erpInvoiceId.slice(0, 8) + "…" : "not created"}</span>
            </div>
          ) : (
            <p className="empty">Not extracted yet.</p>
          )}
        </div>

        <div className="card pad">
          <h3>Audit timeline</h3>
          <ul className="timeline">
            {(doc.events ?? []).map((e) => (
              <li key={e.id} className={`tl-${e.actor}`}>
                <span className={`actor a-${e.actor}`}>{e.actor}</span>
                <span className="step">{e.step}</span>
                {e.message}
                <span className="when">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
