import { env } from "./config/env.js";
import { app } from "./app.js";
import { startQueue, getQueue } from "./pipeline/queue.js";
import { startGmailPoller } from "./ingest/gmailPoller.js";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

// Boot order matters: queue first (so ingestion can enqueue), then the
// email poller, then the API.
async function main() {
  await startQueue();
  startGmailPoller();

  // Bull Board — live queue dashboard at /admin/queues (waiting, active,
  // completed, failed jobs; retry buttons). Dev tool: in production this
  // would sit behind an ADMIN-only guard.
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(getQueue())], serverAdapter: boardAdapter });
  app.use("/admin/queues", boardAdapter.getRouter());
  console.log(`Queue dashboard: http://localhost:${env.PORT}/admin/queues`);

  app.listen(env.PORT, () => {
    console.log(`finErpAP pipeline API running on http://localhost:${env.PORT}`);
    console.log(`Talking to ERP at ${env.ERP_BASE_URL}`);
    const engine = env.ANTHROPIC_API_KEY
      ? "CLAUDE (real AI, direct)"
      : env.OPENROUTER_API_KEY
        ? `OPENROUTER (real AI, model: ${env.OPENROUTER_MODEL})`
        : "MOCK (offline)";
    console.log(`Extraction engine: ${engine}`);
  });
}

main().catch((e) => {
  console.error("Fatal startup error:", e);
  process.exit(1);
});
