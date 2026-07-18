import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";
import { env } from "../config/env.js";

// ----------------------------------------------------------------------------
//  Rate limiting - three layers, all thresholds from env (config/env.ts):
//
//  1. authLimiter   - strict, per-IP, on the public auth endpoints only.
//                     Stops one machine from hammering login/register.
//  2. apiLimiter    - moderate, per-USER (key = user id from the JWT, so a
//                     shared office IP never throttles innocent colleagues),
//                     on everything behind requireAuth.
//  3. login backoff - per-ACCOUNT exponential delay on failed logins.
//                     Catches distributed attacks (many IPs, one victim
//                     account) that per-IP limits can't see. Deliberately a
//                     growing delay, NOT a hard lockout: locking the account
//                     would let an attacker lock the real owner out at will.
//
//  NOTE: the backoff map is in-memory - correct for a single instance.
//  When we scale to multiple instances, this moves to Valkey so all
//  instances share the same counters.
// ----------------------------------------------------------------------------

export const authLimiter = rateLimit({
  windowMs: env.RATE_AUTH_WINDOW_MIN * 60_000,
  limit: env.RATE_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts from this address - try again later" },
});

export const apiLimiter = rateLimit({
  windowMs: env.RATE_USER_WINDOW_MIN * 60_000,
  limit: env.RATE_USER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // Runs after requireAuth, so a user id is always present; the IP fallback
  // only exists for safety (ipKeyGenerator handles IPv6 subnets correctly).
  keyGenerator: (req: Request) =>
    (req as any).user?.id ?? ipKeyGenerator(req.ip ?? ""),
  message: { error: "Too many requests - slow down a little" },
});

// --- per-account login backoff ----------------------------------------------

const failures = new Map<string, { count: number; nextAllowedAt: number }>();

// Hourly sweep so accounts that never come back don't grow the map forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, entry] of failures) {
    if (entry.nextAllowedAt < cutoff) failures.delete(key);
  }
}, 60 * 60 * 1000).unref();

export function loginGate(email: string): { blocked: false } | { blocked: true; retryAfterSec: number } {
  const entry = failures.get(email);
  if (!entry || Date.now() >= entry.nextAllowedAt) return { blocked: false };
  return { blocked: true, retryAfterSec: Math.ceil((entry.nextAllowedAt - Date.now()) / 1000) };
}

export function noteLoginFailure(email: string): void {
  const entry = failures.get(email) ?? { count: 0, nextAllowedAt: 0 };
  entry.count += 1;
  const extra = entry.count - env.LOGIN_BACKOFF_FREE_FAILS;
  if (extra > 0) {
    const delaySec = Math.min(
      env.LOGIN_BACKOFF_MAX_SECONDS,
      env.LOGIN_BACKOFF_BASE_SECONDS * 2 ** (extra - 1)
    );
    entry.nextAllowedAt = Date.now() + delaySec * 1000;
  }
  failures.set(email, entry);
}

export function noteLoginSuccess(email: string): void {
  failures.delete(email);
}
