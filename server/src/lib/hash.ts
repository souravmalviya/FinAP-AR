import { createHash } from "crypto";

// SHA-256 fingerprint of the file bytes.
// Two uploads of the exact same PDF produce the same hash -> we catch the
// duplicate BEFORE any AI cost or ERP write. First line of defence.
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
