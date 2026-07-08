import { promises as fs } from "fs";
import path from "path";
import { env } from "../config/env.js";

// ----------------------------------------------------------------------------
//  S3-style storage adapter (Layer 2 of the architecture: CAPTURE).
//
//  The rest of the app only ever calls putObject/getObject with a KEY —
//  exactly like AWS S3. Today the bytes land in a local folder; the day we
//  move to real S3, we swap the internals of these two functions and NOTHING
//  else in the codebase changes. That is what "adapter" means.
// ----------------------------------------------------------------------------

function fullPath(key: string) {
  // keys look like "org_demo/2026/07/uuid.pdf" — recreate that as folders
  return path.join(env.STORAGE_DIR, key);
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  const p = fullPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, bytes);
}

export async function getObject(key: string): Promise<Buffer> {
  return fs.readFile(fullPath(key));
}

// Build a tidy, collision-proof key: org/year/month/<uuid>.pdf
export function makeStorageKey(organizationId: string, id: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${organizationId}/${y}/${m}/${id}.pdf`;
}
