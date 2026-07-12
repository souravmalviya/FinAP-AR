import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { ingestFile } from "./ingestFile.js";

// ----------------------------------------------------------------------------
//  Gmail poller (Layer 1 of the architecture: INPUT - the email adapter).
//
//  Every GMAIL_POLL_SECONDS it:
//    1. connects to the inbox over IMAP (app-password auth)
//    2. lists ALL messages of the last 3 days (NOT just unread ones - see below)
//    3. skips UIDs already processed this session
//    4. downloads every PDF attachment
//    5. hands each PDF to ingestFile() - the same door the upload button uses
//
//  Why not "unread only"? We tried that first. It breaks the moment anything
//  else touches the inbox: a human opening the email, a phone mail app, or
//  Gmail itself marks the message read, and the poller goes blind forever.
//  Instead we scan a recent window and rely on TWO idempotency layers:
//    - an in-memory set of processed UIDs (skips refetching within a session)
//    - ingestFile's sha256 dedupe (skips re-ingesting across restarts)
//  After a restart the first poll re-examines the window once; every
//  already-ingested PDF is dropped by the hash check. Correct by design.
//
//  Other design notes:
//  - Fresh connection per poll: no stale-connection bugs at a 60s cadence.
//  - Recursive setTimeout (not setInterval): polls can never overlap.
//  - Everything is wrapped in try/catch: an inbox hiccup logs and waits for
//    the next tick - the poller must never crash the server.
// ----------------------------------------------------------------------------

const LOOKBACK_DAYS = 3;
const processedUids = new Set<number>();

export function startGmailPoller(): void {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.log("[gmail] no GMAIL_USER / GMAIL_APP_PASSWORD set - email ingestion off");
    return;
  }

  console.log(
    `[gmail] polling ${env.GMAIL_USER} every ${env.GMAIL_POLL_SECONDS}s (org: ${env.GMAIL_ORG_ID})`
  );

  const tick = async () => {
    try {
      await pollOnce();
    } catch (e) {
      console.error("[gmail] poll failed:", e instanceof Error ? e.message : e);
    } finally {
      setTimeout(tick, env.GMAIL_POLL_SECONDS * 1000);
    }
  };
  // First poll shortly after boot (give the queue a moment to be ready).
  setTimeout(tick, 3000);
}

async function pollOnce(): Promise<void> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    logger: false, // imapflow's own logging is very chatty
  });

  await client.connect();
  try {
    // Lock the mailbox while we work with it (imapflow requirement).
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
      const uids = (await client.search({ since }, { uid: true })) || [];
      const fresh = uids.filter((u) => !processedUids.has(u));
      if (fresh.length === 0) return;

      console.log(`[gmail] ${fresh.length} new email(s) in the ${LOOKBACK_DAYS}-day window`);

      for (const uid of fresh) {
        // Download the full raw message and parse it (headers, body, attachments).
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);

        const from = parsed.from?.text ?? "unknown sender";
        const pdfs = (parsed.attachments ?? []).filter(
          (a) =>
            a.contentType === "application/pdf" ||
            (a.filename ?? "").toLowerCase().endsWith(".pdf")
        );

        if (pdfs.length === 0) {
          console.log(`[gmail] "${parsed.subject}" from ${from} - no PDF attachments, skipping`);
        }

        for (const pdf of pdfs) {
          const name = pdf.filename ?? `email-attachment-${Date.now()}.pdf`;
          const result = await ingestFile(
            env.GMAIL_ORG_ID,
            name,
            pdf.content, // Buffer with the attachment bytes
            "EMAIL"
          );
          if (result.duplicate) {
            console.log(`[gmail] "${name}" from ${from} - duplicate, skipped`);
          } else {
            console.log(`[gmail] "${name}" from ${from} - ingested → pipeline`);
          }
        }

        // Remember this UID only AFTER successful processing - if anything
        // above threw, the next poll retries this email.
        processedUids.add(uid);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
