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
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing - copy .env.example to .env");
}

// Deployment guard: shipping the default JWT secret would let anyone forge
// login tokens. Loud warning in production, harmless in local dev.
if (process.env.NODE_ENV === "production" && env.JWT_SECRET === "dev-secret-change-me-in-production") {
  console.error("SECURITY WARNING: JWT_SECRET is still the dev default - set a long random value!");
}
