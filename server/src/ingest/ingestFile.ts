import { DocSource } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../config/db.js";
import { sha256 } from "../lib/hash.js";
import { putObject, makeStorageKey } from "../lib/storage.js";
import { enqueueDocument } from "../pipeline/queue.js";
import { audit } from "../audit/audit.js";

// ----------------------------------------------------------------------------
//  THE one front door for invoices - no matter how they arrive.
//
//  The upload endpoint calls this. The Gmail poller calls this. A future
//  WhatsApp/Slack/API integration would call this too. One door means the
//  dedupe, storage, and queueing guarantees hold for every source.
// ----------------------------------------------------------------------------

export type IngestResult =
  | { duplicate: false; documentId: string }
  | { duplicate: true; documentId: string; status: string };

export async function ingestFile(
  organizationId: string,
  fileName: string,
  bytes: Buffer,
  source: DocSource
): Promise<IngestResult> {
  const hash = sha256(bytes);

  // Duplicate defence #1: identical bytes already ingested for this org?
  const existing = await prisma.ingestedDocument.findUnique({
    where: { organizationId_sha256: { organizationId, sha256: hash } },
  });
  if (existing) {
    return { duplicate: true, documentId: existing.id, status: existing.status };
  }

  // Store the raw file FIRST (audit rule: never lose the original)...
  const id = randomUUID();
  const storageKey = makeStorageKey(organizationId, id);
  await putObject(storageKey, bytes);

  // ...then record it and queue the processing job.
  const doc = await prisma.ingestedDocument.create({
    data: {
      id,
      organizationId,
      source,
      fileName,
      storageKey,
      sha256: hash,
      status: "QUEUED",
    },
  });
  await audit(organizationId, doc.id, "INGEST", "SYSTEM",
    `File "${fileName}" received via ${source} (${bytes.length} bytes), job queued`);
  await enqueueDocument(doc.id);

  return { duplicate: false, documentId: doc.id };
}
