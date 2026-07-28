"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login } from "@/lib/api";
import Logo from "@/components/Logo";

// The front door. On success the token + user land in localStorage and every
// later API call carries them. Role decides what the server lets you do.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: "60px auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20, textAlign: "center" }}>
        <Logo size={76} />
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.4px" }}>Welcome to Verity</div>
        <p style={{ fontSize: 12.5, color: "var(--text-3)", maxWidth: 330, lineHeight: 1.6, margin: 0 }}>
          <b>Verity</b> means truth, from the Latin <i>Veritas</i>.
          The name is the promise: every invoice, verified.
        </p>
      </div>
      <div className="card pad">
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="sub">AP automation dashboard</p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase" }}>Email</label>
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="finhead@acme.test"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 9, fontSize: 14, marginTop: 4 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase" }}>Password</label>
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 9, fontSize: 14, marginTop: 4 }}
            />
          </div>
          {error && <div className="flag" style={{ margin: 0 }}>⚠ {error}</div>}
          <button className="btn" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>

      <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-2)", marginBottom: 16 }}>
        New here? <Link href="/register" style={{ color: "var(--accent)", fontWeight: 700 }}>Create an account</Link>
      </p>
    </div>
  );
}
