import { Request, Response, NextFunction } from "express";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { startQueue, getQueue } from "./pipeline/queue.js";
import { startGmailPoller } from "./ingest/gmailPoller.js";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

// Browser basic-auth gate for the queue dashboard. Basic auth (not JWT)
// because Bull Board is a normal browser page: the browser shows its own
// login prompt and re-sends the credentials on every asset request.
function bullBoardGuard(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === env.BULLBOARD_USER && pass === env.BULLBOARD_PASSWORD) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Verity queues"');
  res.status(401).send("Authentication required");
}

// Boot order matters: queue first (so ingestion can enqueue), then the
// email poller, then the API.
async function main() {
  await startQueue();
  startGmailPoller();

  // Bull Board - live queue dashboard at /admin/queues (waiting, active,
  // completed, failed jobs; retry buttons). Guarded: with BULLBOARD_USER +
  // BULLBOARD_PASSWORD set it demands basic auth; without them it only
  // mounts outside production - an open ops dashboard must never ship.
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(getQueue())], serverAdapter: boardAdapter });
  const credsSet = env.BULLBOARD_USER && env.BULLBOARD_PASSWORD;
  if (credsSet) {
    app.use("/admin/queues", bullBoardGuard, boardAdapter.getRouter());
    console.log(`Queue dashboard (basic auth): http://localhost:${env.PORT}/admin/queues`);
  } else if (process.env.NODE_ENV !== "production") {
    app.use("/admin/queues", boardAdapter.getRouter());
    console.log(`Queue dashboard (open, dev only): http://localhost:${env.PORT}/admin/queues`);
  } else {
    console.log("Queue dashboard disabled (set BULLBOARD_USER/BULLBOARD_PASSWORD to enable in production)");
  }

  app.listen(env.PORT, () => {
    console.log(`Verity pipeline API running on http://localhost:${env.PORT}`);
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
