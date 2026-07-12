# Verity — AP Automation Product

> *Every invoice, verified.* (codebase name: finErpAP)

The full product from the architecture diagrams: invoice PDFs come in, AI
extracts, **rules verify against the ERP**, approvals get routed, payments get
recorded. The Mini-ERP (`C:\Users\Soura\OneDrive\Desktop\miniERP`) is the
system of record it integrates with.

```
upload PDF ──► store + hash ──► queue ──► EXTRACT (AI) ──► VERIFY (rules)
                                              │                 │
                                              ▼                 ▼
                              ERP: create invoice + link PO   flag NEEDS_REVIEW
                                              │
                                              ▼
                              ROUTE (thresholds) ──► auto-approve OR human task
                                              │
                                              ▼
                                   approve ──► pay ──► ERP: PAID, PO CLOSED
```

## Folders

- `server/` — the pipeline + API (Express, TypeScript, Prisma, BullMQ)
- `web/` — Next.js dashboard (next milestone)
- `docker-compose.yml` — infrastructure: Valkey (open-source Redis fork), the queue's broker

## The two databases (important!)

| DB | Owner | Stores |
|---|---|---|
| `mini_erp` | the ERP (:4000) | financial truth: vendors, POs, invoices, payments |
| `finerp_ap` | this product (:5000) | workflow: documents, extractions, approvals, audit log |

The product NEVER touches the ERP's database directly — only its REST API,
via `server/src/erp/erpClient.ts` (the one file that knows how to talk to it).

## Run it

```powershell
# terminal 0 — infrastructure (Valkey queue broker; needs Docker Desktop running)
cd C:\Users\Soura\OneDrive\Desktop\finErpAP
docker compose up -d

# terminal 1 — the ERP (system of record)
cd C:\Users\Soura\OneDrive\Desktop\miniERP
npm run dev          # -> http://localhost:4000

# terminal 2 — this product's pipeline
cd C:\Users\Soura\OneDrive\Desktop\finErpAP\server
npm run dev          # -> http://localhost:5000
```

## Demo an invoice end to end

```powershell
cd C:\Users\Soura\OneDrive\Desktop\finErpAP\server

# 1. make a sample vendor invoice PDF (samples/ACR-556.pdf)
npm run sample:invoice

# 2. "the email arrived": upload it
curl -Method POST http://localhost:5000/api/documents/upload `
  -Headers @{ "x-org-id" = "org_demo" } `
  -Form @{ file = Get-Item .\samples\ACR-556.pdf }

# 3. watch it move: GET /api/documents (status + audit timeline per doc)
```

Variants for testing the rules:

```powershell
npm run sample:invoice -- --no ACR-990 --amount 290000   # mismatch -> NEEDS_REVIEW
npm run sample:invoice -- --no ACR-991 --amount 30000    # < 50k -> auto-approved
```

## AI engines

- No `ANTHROPIC_API_KEY` in `.env` → **MOCK** regex parser (offline, free)
- Key present → **CLAUDE** does the extraction. Nothing else changes
  (`server/src/extraction/index.ts` is the only switch).

## API quick reference (all need `x-org-id` header)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | ingest an invoice PDF (multipart `file`) |
| GET | `/api/documents` | list documents + statuses |
| GET | `/api/documents/:id` | one document + extraction + audit timeline |
| GET | `/api/approvals` | pending human approvals |
| POST | `/api/approvals/:id/approve` / `reject` | human decision |
| POST | `/api/documents/:id/pay` | record payment via the ERP |

## Deploying on free tiers

Everything is env-driven — no code changes needed to deploy.

| Piece | Free option | Env vars to set |
|---|---|---|
| Dashboard (`web/`) | **Vercel** (free hobby tier, built for Next.js) | `NEXT_PUBLIC_API_URL` = your backend URL |
| Pipeline (`server/`) | **Railway** or **Render** free tier | `DATABASE_URL`, `VALKEY_URL`, `ERP_BASE_URL`, `PORT` (Railway injects it) |
| PostgreSQL | Railway Postgres / **Neon** (generous free tier) | — |
| Valkey / Redis | Railway Redis or **Upstash** free tier | copy its URL into `VALKEY_URL` |
| Mini-ERP | second Railway service (or keep local for demos) | its own `DATABASE_URL` + `PORT` |

Known free-tier caveats:
- **Uploaded PDFs live on local disk** (`STORAGE_DIR`) — on Railway that disk is
  wiped on every redeploy. Fine for a demo; for real use swap `lib/storage.ts`
  internals to S3/Cloudflare R2 (R2 has a free tier) — nothing else changes.
- Free web services **sleep when idle** (first request after a while is slow).
- Set `x-org-id` handling as-is; auth comes later.

## Design rules encoded in this codebase

1. **AI reads, rules decide.** AI appears in exactly one step (EXTRACT); every
   number it produces is re-verified by `rules/verify.ts` before money moves.
2. **The ERP is the memory.** Touched twice: fetch PO to match (touch ①),
   write payment back (touch ②) — through the adapter only.
3. **Everything retries.** Ingest stores the file *then* queues; BullMQ
   retries failed jobs 3× with exponential backoff (jobs live in Valkey, so
   they survive app restarts); duplicates are caught by file hash
   (defence 1) and ERP invoice-number constraint (defence 2).
4. **Everything is audited.** `WorkflowEvent` is append-only; every step logs
   who acted (SYSTEM / AI / RULE / HUMAN) and why.
