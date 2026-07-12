import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env.js";
import { processDocument } from "./processDocument.js";

// ----------------------------------------------------------------------------
//  The job queue — now BullMQ backed by Valkey (the open-source Redis fork).
//
//  Why a queue at all? Extraction + ERP calls can fail halfway (ERP down,
//  network blip, AI timeout). A queued job:
//    - survives a server restart (jobs live in Valkey, not in memory),
//    - retries automatically with exponential backoff,
//    - never runs the same document twice at once.
//
//  
// ----------------------------------------------------------------------------

export const QUEUE_NAME = "process-document";

// BullMQ takes a connection config; Valkey speaks the Redis protocol.
// Locally we use host/port (docker compose). In the cloud, VALKEY_URL carries
// the full connection string incl. password/TLS — one env var, no code change.
// maxRetriesPerRequest:null = BullMQ requirement (workers wait forever).
const connection = env.VALKEY_URL
  ? new IORedis(env.VALKEY_URL, { maxRetriesPerRequest: null })
  : { host: env.VALKEY_HOST, port: env.VALKEY_PORT, maxRetriesPerRequest: null as null };

let queue: Queue | null = null;

// Exposed for the Bull Board dashboard (visualizes jobs/retries/failures).
export function getQueue(): Queue {
  if (!queue) throw new Error("Queue not started");
  return queue;
}

export async function startQueue(): Promise<void> {
  queue = new Queue(QUEUE_NAME, { connection });

  // The worker: concurrency 1 = one document at a time (simple + safe for v1).
  const worker = new Worker<{ documentId: string }>(
    QUEUE_NAME,
    async (job) => {
      await processDocument(job.data.documentId);
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", async (job, err) => {
    console.error(`[queue] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
    // Out of retries? Then the document is truly FAILED — don't leave it
    // looking QUEUED forever. (processDocument resets to QUEUED between
    // attempts so retries are allowed to run; this is the final word.)
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const { prisma } = await import("../config/db.js");
      await prisma.ingestedDocument
        .update({ where: { id: job.data.documentId }, data: { status: "FAILED" } })
        .catch(() => {});
    }
  });
  worker.on("error", (err) => console.error("[queue] worker error:", err.message));

  // Fail fast at boot if Valkey isn't reachable (clear message > silent hang).
  await queue.waitUntilReady();
  console.log(
    `[queue] BullMQ ready on Valkey (${env.VALKEY_URL ? "cloud URL" : env.VALKEY_HOST + ":" + env.VALKEY_PORT})`
  );
}

// Enqueue a document for processing. Retries: 3 attempts with exponential
// backoff (5s, 10s, 20s) — same policy we had under pg-boss.
export async function enqueueDocument(documentId: string): Promise<void> {
  if (!queue) throw new Error("Queue not started");
  await queue.add(
    "process",
    { documentId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100, // keep last 100 finished jobs for inspection
      removeOnFail: 500,
    }
  );
}
