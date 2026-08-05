"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ApprovalTask, approveTask, getUser, inr, listApprovals, rejectTask, SessionUser } from "@/lib/api";

// ----------------------------------------------------------------------------
//  Approvals inbox - the ONLY place a human is needed on the happy path.
//  The rule engine already verified these; the human applies judgement to
//  the ones above the auto-approve threshold.
// ----------------------------------------------------------------------------

export default function ApprovalsPage() {
  const [tasks, setTasks] = useState<ApprovalTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => setUser(getUser()), []);

  // Mirror of the server's rule - the server is still the law; this only
  // makes the UI honest about what will be allowed.
  const canDecide = (t: ApprovalTask) =>
    !!user && (user.role === "CFO" || user.role === "ADMIN" || user.role === t.requiredRole);

  const refresh = useCallback(async () => {
    try {
      setTasks(await listApprovals());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline API unreachable");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function decide(task: ApprovalTask, decision: "approve" | "reject") {
    // No name prompt anymore - the server records the logged-in user.
    setBusyId(task.id);
    setError(null);
    try {
      if (decision === "approve") await approveTask(task.id);
      else await rejectTask(task.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <h1>Approvals</h1>
      <p className="sub">
        Invoices the rules verified, but that exceed the auto-approve threshold
        (₹50k-5L → Finance Head · above ₹5L → CFO). Your decision is written to the audit log.
      </p>

      {error && <div className="flag">⚠ {error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Invoice</th><th>Vendor</th><th>Amount</th><th>Requires</th><th style={{ width: 210 }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {tasks === null &&
              [1, 2].map((i) => (
                <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                  <td key={j}><div className="skel" style={{ width: `${50 + ((i * j * 23) % 40)}%` }} /></td>
                ))}</tr>
              ))}
            {tasks !== null && tasks.length === 0 && (
              <tr><td colSpan={5} className="empty">Inbox zero - nothing waiting for a human. 🎉</td></tr>
            )}
            {(tasks ?? []).map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/documents/${t.documentId}`} className="mono" style={{ fontWeight: 700, color: "var(--accent)" }}>
                    {t.document?.extraction?.invoiceNo ?? t.documentId.slice(0, 8)}
                  </Link>
                </td>
                <td>{t.document?.extraction?.vendorName ?? "-"}</td>
                <td style={{ fontWeight: 700 }}>{inr(t.document?.extraction?.amount)}</td>
                <td><span className="badge s-PENDING_APPROVAL">{t.requiredRole.replace(/_/g, " ")}</span></td>
                <td>
                  {canDecide(t) ? (
                    <>
                      <button className="btn green sm" disabled={busyId === t.id} onClick={() => decide(t, "approve")}>✓ Approve</button>{" "}
                      <button className="btn red sm" disabled={busyId === t.id} onClick={() => decide(t, "reject")}>✗ Reject</button>
                    </>
                  ) : (
                    <span className="dim" title={`Requires ${t.requiredRole} - you are ${user?.role}`}>
                      🔒 {t.requiredRole.replace(/_/g, " ")} only
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
