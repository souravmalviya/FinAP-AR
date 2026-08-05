"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { register } from "@/lib/api";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";

// Self-service sign-up with a designation dropdown. The chosen role decides
// what the server will allow (EMPLOYEE = view-only). Registering logs you in
// immediately - no separate sign-in step.
const DESIGNATIONS = [
  { value: "EMPLOYEE", label: "Employee", hint: "view-only access" },
  { value: "AP_CLERK", label: "AP Clerk", hint: "uploads & tracks invoices" },
  { value: "FINANCE_HEAD", label: "Finance Head", hint: "approves ₹50k-5L invoices" },
  { value: "CFO", label: "CFO", hint: "approves any invoice" },
  { value: "ADMIN", label: "Admin", hint: "full access - everything the CFO can do, plus administration" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)",
  // fontFamily: form controls do NOT inherit the page font by default - without
  // this they render in the browser's default form font while the rest of the
  // app uses Segoe UI. It also keeps their height in step with .pwfield.
  borderRadius: 9, fontSize: 14, marginTop: 4, fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase",
};

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password, role, organizationName);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = DESIGNATIONS.find((d) => d.value === role)!;

  return (
    <div style={{ maxWidth: 400, margin: "60px auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, justifyContent: "center" }}>
        <Logo size={40} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>Verity</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Every invoice, verified.</div>
        </div>
      </div>
      <div className="card pad">
        <h1 style={{ marginBottom: 4 }}>Create account</h1>
        <p className="sub">Join your team&apos;s Verity workspace</p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={labelStyle}>Organization name</label>
            <input required value={organizationName} onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Pine Labs" style={inputStyle} />
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
              New name creates the organization; an existing name joins it.
            </div>
          </div>
          <div>
            <label style={labelStyle}>Full name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Priya Sharma" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="priya@acme.test" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="password" style={labelStyle}>Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={setPassword}
              placeholder="at least 8 characters"
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label style={labelStyle}>Designation</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              {DESIGNATIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              → {selected.hint}
            </div>
          </div>
          {error && <div className="flag" style={{ margin: 0 }}>⚠ {error}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
            {busy ? "Creating account…" : "Create account & sign in"}
          </button>
        </form>
      </div>

      <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-2)" }}>
        Already have an account? <Link href="/login" style={{ color: "var(--accent)", fontWeight: 700 }}>Sign in</Link>
      </p>
    </div>
  );
}
