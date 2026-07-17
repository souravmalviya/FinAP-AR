import { promises as fs } from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

// ----------------------------------------------------------------------------
//  Storage adapter (Layer 2 of the architecture: CAPTURE).
//
//  The rest of the app only ever calls putObject/getObject with a KEY.
//  Which backend actually holds the bytes is decided HERE, by config -
//  the same engine-switch pattern extraction/index.ts uses for AI engines:
//
//    S3_BUCKET set   -> AWS S3 (or any S3-compatible service via S3_ENDPOINT)
//    S3_BUCKET empty -> local disk under STORAGE_DIR (zero-setup dev mode)
//
//  This is the promise the original adapter made ("the day we move to real
//  S3, we swap the internals and NOTHING else changes") being kept: ingest,
//  the poller, and the worker were not touched for this migration.
// ----------------------------------------------------------------------------

const useS3 = Boolean(env.S3_BUCKET);

// One client for the whole process, created on first use. The SDK finds the
// credentials itself from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars
// (its standard credential chain), so we never handle the secret in code.
let s3: S3Client | null = null;
function s3Client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.S3_REGION,
      // Only for S3-compatible services (Cloudflare R2 etc). Real AWS derives
      // the endpoint from the region, so this stays undefined there.
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
  }
  return s3;
}

console.log(
  useS3
    ? `[storage] engine: AWS S3 (bucket "${env.S3_BUCKET}", region ${env.S3_REGION})`
    : `[storage] engine: local disk (${env.STORAGE_DIR})`
);

function fullPath(key: string) {
  // keys look like "org_demo/2026/07/uuid.pdf" - recreate that as folders
  return path.join(env.STORAGE_DIR, key);
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  if (useS3) {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: "application/pdf",
      })
    );
    return;
  }
  const p = fullPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, bytes);
}

export async function getObject(key: string): Promise<Buffer> {
  if (useS3) {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })
    );
    // Body is a stream; the SDK can collect it into bytes for us.
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return fs.readFile(fullPath(key));
}

// Build a tidy, collision-proof key: org/year/month/<uuid>.pdf
// (unchanged - keys are backend-agnostic, which is what made this swap safe)
export function makeStorageKey(organizationId: string, id: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${organizationId}/${y}/${m}/${id}.pdf`;
}
