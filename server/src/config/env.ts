import "dotenv/config";

// One place that reads process.env. The rest of the code imports from here,
// so a typo'd env var name can only ever be wrong in ONE file.
export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  PORT: Number(process.env.PORT) || 5000,
  ERP_BASE_URL: process.env.ERP_BASE_URL ?? "http://localhost:4000",
  // Signs login tokens. MUST be a long random string in production.
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-me-in-production",
  STORAGE_DIR: process.env.STORAGE_DIR ?? "./storage",
  // --- S3 storage (optional) ------------------------------------------------
  // If S3_BUCKET is set, PDFs go to AWS S3 and STORAGE_DIR is ignored.
  // Credentials use the AWS SDK's standard names (AWS_ACCESS_KEY_ID and
  // AWS_SECRET_ACCESS_KEY) which the SDK reads from the environment itself.
  // S3_ENDPOINT is only for S3-compatible services (e.g. Cloudflare R2);
  // leave it empty for real AWS.
  S3_BUCKET: process.env.S3_BUCKET ?? "",
  S3_REGION: process.env.S3_REGION ?? "ap-south-1",
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  // OpenRouter: one API key for many models (Claude/GPT/Gemini...).
  // If set (and no Anthropic key), extraction uses OpenRouter.
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? "",
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-haiku",
  // Gmail email ingestion (IMAP + App Password). If user+password are set,
  // the poller watches the inbox for PDF attachments.
  GMAIL_USER: process.env.GMAIL_USER ?? "",
  GMAIL_APP_PASSWORD: (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""), // Google shows it with spaces
  GMAIL_POLL_SECONDS: Number(process.env.GMAIL_POLL_SECONDS) || 60,
  GMAIL_ORG_ID: process.env.GMAIL_ORG_ID ?? "org_demo", // which tenant emailed invoices belong to
  // Valkey (open-source Redis fork) - the queue's broker.
  // In the cloud (Railway/Upstash), set VALKEY_URL to the full connection
  // string (redis://:password@host:port) - it wins over host/port.
  VALKEY_URL: process.env.VALKEY_URL ?? "",
  VALKEY_HOST: process.env.VALKEY_HOST ?? "localhost",
  VALKEY_PORT: Number(process.env.VALKEY_PORT) || 6379,
  // --- security knobs (every threshold configurable, none hardcoded) --------
  // CORS: "*" is fine for local dev; in production set the exact dashboard
  // origin (e.g. https://verity.vercel.app) so no other site can call the API
  // from a browser.
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
  // Upload cap in megabytes - enforced by multer AND at the ingest front door
  // (the front door also covers email attachments).
  UPLOAD_MAX_MB: Number(process.env.UPLOAD_MAX_MB) || 10,
  // Auth endpoints (login/register): strict per-IP window.
  RATE_AUTH_WINDOW_MIN: Number(process.env.RATE_AUTH_WINDOW_MIN) || 15,
  RATE_AUTH_MAX: Number(process.env.RATE_AUTH_MAX) || 20,
  // Authenticated API: looser per-user window (keyed by user id, not IP).
  RATE_USER_WINDOW_MIN: Number(process.env.RATE_USER_WINDOW_MIN) || 1,
  RATE_USER_MAX: Number(process.env.RATE_USER_MAX) || 240,
  // Per-ACCOUNT login backoff: first N failures are free, then the wait
  // doubles per failure (base * 2^extra) up to the cap. No hard lockout -
  // an attacker can't permanently lock a victim out of their own account.
  LOGIN_BACKOFF_FREE_FAILS: Number(process.env.LOGIN_BACKOFF_FREE_FAILS) || 3,
  LOGIN_BACKOFF_BASE_SECONDS: Number(process.env.LOGIN_BACKOFF_BASE_SECONDS) || 2,
  LOGIN_BACKOFF_MAX_SECONDS: Number(process.env.LOGIN_BACKOFF_MAX_SECONDS) || 300,
  // Bull Board dashboard: with both set, /admin/queues demands basic auth;
  // with either unset, the dashboard only mounts outside production.
  BULLBOARD_USER: process.env.BULLBOARD_USER ?? "",
  BULLBOARD_PASSWORD: process.env.BULLBOARD_PASSWORD ?? "",
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing - copy .env.example to .env");
}

// Deployment guard: shipping the default JWT secret would let anyone forge
// login tokens. Loud warning in production, harmless in local dev.
if (process.env.NODE_ENV === "production" && env.JWT_SECRET === "dev-secret-change-me-in-production") {
  console.error("SECURITY WARNING: JWT_SECRET is still the dev default - set a long random value!");
}
