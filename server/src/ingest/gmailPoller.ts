import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "../config/env.js";
import { ingestFile } from "./ingestFile.js";

// ----------------------------------------------------------------------------
//  Gmail poller (Layer 1 of the architecture: INPUT — the email adapter).
//
//  Every GMAIL_POLL_SECONDS it:
//    1. connects to the inbox over IMAP (app-password auth)
//    2. finds UNSEEN messages
//    3. downloads every PDF attachment
//    4. hands each PDF to ingestFile() — the same door the upload button uses
//    5. marks the message as seen (so the next poll skips it)
//
//  Design notes:
//  - Fresh connection per poll: simpler than keeping one alive, and at a 60s
//    cadence the overhead is irrelevant. No stale-connection bugs.
//  - Recursive setTimeout (not setInterval): a slow poll can never overlap
//    with the next one.
//  - Everything is wrapped in try/catch: an inbox hiccup logs and waits for
//    the next tick — the poller must never crash the server.
//  - Duplicate emails/PDFs are harmless: ingestFile's sha256 check skips them.
// ----------------------------------------------------------------------------

export function startGmailPoller(): void {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.log("[gmail] no GMAIL_USER / GMAIL_APP_PASSWORD set — email ingestion off");
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
      const unseen = await client.search({ seen: false });
      if (!unseen || unseen.length === 0) return;

      console.log(`[gmail] ${unseen.length} unread email(s) found`);

      for (const uid of unseen) {
        // Download the full raw message and parse it (headers, body, attachments).
        const msg = await client.fetchOne(uid, { source: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);

        const from = parsed.from?.text ?? "unknown sender";
        const pdfs = (parsed.attachments ?? []).filter(
          (a) =>
            a.contentType === "application/pdf" ||
            (a.filename ?? "").toLowerCase().endsWith(".pdf")
        );

        if (pdfs.length === 0) {
          console.log(`[gmail] "${parsed.subject}" from ${from} — no PDF attachments, skipping`);
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
            console.log(`[gmail] "${name}" from ${from} — duplicate, skipped`);
          } else {
            console.log(`[gmail] "${name}" from ${from} — ingested → pipeline`);
          }
        }

        // Mark seen ONLY after successful processing — if we crashed above,
        // the email stays unread and the next poll retries it.
        await client.messageFlagsAdd(uid, ["\\Seen"]);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
