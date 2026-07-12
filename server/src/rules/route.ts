import { ApproverRole } from "@prisma/client";

// ----------------------------------------------------------------------------
//  ROUTE (Layer 5) - who must approve? Pure threshold rules.
//
//      < ₹50,000            -> nobody: auto-approve
//      ₹50,000 – ₹5,00,000  -> FINANCE_HEAD
//      > ₹5,00,000          -> CFO
//
//  v1 keeps thresholds as constants. Later they become per-organization
//  rows in the DB so every customer configures their own policy.
// ----------------------------------------------------------------------------

const AUTO_APPROVE_BELOW = 50_000;
const CFO_ABOVE = 500_000;

export type RoutingDecision =
  | { kind: "AUTO_APPROVE" }
  | { kind: "NEEDS_HUMAN"; role: ApproverRole };

export function route(amount: number): RoutingDecision {
  if (amount < AUTO_APPROVE_BELOW) return { kind: "AUTO_APPROVE" };
  if (amount > CFO_ABOVE) return { kind: "NEEDS_HUMAN", role: "CFO" };
  return { kind: "NEEDS_HUMAN", role: "FINANCE_HEAD" };
}
