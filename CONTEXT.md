# CONTEXT.md - Complete Project Handoff (Verity + miniERP)

> Purpose: paste/attach this file into a new chat and the assistant has the FULL
> picture: architecture, LLD, flows, decisions and their reasons, current state,
> and how to work with the user. Written 2026-07-13.

---

## 0. Who the user is & how to work with them

- Sourav, learning backend engineering to target a Procindex-style (YC S25) job:
  AI agents for accounting ops (AP/AR automation), TypeScript/Node/PostgreSQL stack.
- Style that works: BUILD step by step, then explain every file's what/how/why,
  always linking back to the product concepts. He reviews and learns alongside.
- HARD RULES:
  - NEVER use em dashes in any user-visible text or docs (he finds them AI-looking).
    Use "-" or ":" instead. Both repos were fully swept.
  - He commits/pushes to GitHub HIMSELF unless he explicitly asks. Make changes only.
  - No hard-delete features: data is source of truth; if removal is ever needed,
    it must be role-gated soft-delete/archive with audit (he decided to skip even that).
- Machine: Windows 11, PowerShell, Node 24, Python 3.14, Docker Desktop (fragile,
  see Hazards), PostgreSQL 18 local (password in each project's .env), VS Code.
- OpenRouter API key + Gmail app password + JWT secret live in
  finErpAP/server/.env (NOT in git, never print them).

## 1. The product in one paragraph

**Verity** ("Every invoice, verified") is an AP-automation product modeled on
Procindex: vendor emails an invoice PDF -> poller ingests it -> AI extracts
fields -> deterministic rules verify it against the org's Purchase Order in the
ERP -> threshold rules route approval (small = auto, big = human) -> role-gated
human approves -> payment recorded in the ERP -> full append-only audit trail.
Golden principles: **AI reads, rules decide** (AI exists in exactly ONE step and
its output is untrusted until rules verify it) and **the ERP is the memory**
(single source of financial truth; on conflict the product syncs toward it).

## 2. The two codebases

### miniERP - the ERP stand-in (system of record)
- Path: `C:\Users\Soura\OneDrive\Desktop\miniERP` · port 4000 · DB `mini_erp`
- GitHub: https://github.com/souravmalviya/mini-ERP-
- Express + TS + Prisma + Zod. Frontend = single static `public/index.html`
  (teal design, "MiniERP | System of Record") served by the same Express app.
- Role: simulates the customer's EXISTING ERP (ERPNext/QuickBooks stand-in).
  Deliberately NO auth; tenant via `x-org-id` header (middleware/tenant.ts).
  The editable org box in its UI = analog of an ERP's own company selector; kept.
- Modules (each = routes/schema/controller/service 4-file pattern):
  vendors, customers, purchaseOrders, invoices, payments.
- Key logic: invoice status STATE MACHINE (ALLOWED_TRANSITIONS in
  invoice.service.ts refuses illegal jumps: RECEIVED->PENDING_APPROVAL->APPROVED->PAID,
  REJECTED terminal); DB-level duplicate guard UNIQUE(org,type,invoiceNo);
  PO<->invoice amount match auto-sets PO OPEN->MATCHED; payment.service.ts does
  ONE prisma.$transaction: insert Payment + invoice->PAID + PO->CLOSED.
- PO lifecycle: OPEN -> MATCHED -> CLOSED (| CANCELLED).

### finErpAP - the product "Verity"
- Path: `C:\Users\Soura\OneDrive\Desktop\finErpAP` · GitHub: https://github.com/souravmalviya/FinAP-AR
- Two apps + infra:
  - `server/` (Express+TS+Prisma, port 5000, DB `finerp_ap`) - pipeline + API + worker + poller
  - `web/` (Next.js 15 + React 19, port 3000, plain CSS, NO Tailwind) - dashboard
  - `docker-compose.yml` - Valkey 8 (open-source Redis fork) container `finerp-valkey`, port 6379, appendonly
- Branding: Verity, V-drawn-as-checkmark logo with growth bars
  (web/app/icon.svg = favicon, web/components/Logo.tsx), indigo accent
  (#4f46e5); miniERP uses teal (#0d9488) so you always know which app you're in.

## 3. Complete pipeline flow (PDF -> observability)

```
INGEST   Two sources, ONE front door: server/src/ingest/ingestFile.ts
         - Dashboard upload: POST /api/documents/upload (role-gated, multer)
         - Gmail poller: src/ingest/gmailPoller.ts - IMAP (imapflow+mailparser),
           inbox learngrow2136@gmail.com, app password in .env, polls every 60s.
           IMPORTANT DESIGN: scans ALL emails of last 3 days (NOT unread-only;
           unread-flag approach failed - Gmail/user marks emails read), skips
           in-memory processed UIDs, relies on sha256 dedupe across restarts.
         ingestFile: sha256 -> UNIQUE(org,sha256) dedupe -> store raw PDF via
         lib/storage.ts (S3-style adapter, local disk, key org/yyyy/mm/uuid.pdf)
         -> create IngestedDocument status QUEUED -> enqueue.

QUEUE    BullMQ on Valkey (pipeline/queue.ts). Producer=enqueueDocument,
         Worker concurrency 1 -> processDocument. Retries: attempts 3,
         exponential backoff 5s/10s/20s. Idempotency guard: processDocument
         returns unless status===QUEUED. Failed-set = DLQ; worker "failed"
         handler marks doc FAILED when attempts exhausted. Corrupt-PDF test
         proved: no deadlock, valid jobs flow past a failing one.
         VALKEY_URL env supported for cloud (else VALKEY_HOST/PORT).
         Bull Board dashboard: localhost:5000/admin/queues (unauthed dev tool).

EXTRACT  The ONLY AI step. extraction/pdfText.ts: pdfjs-dist (pdf-parse was
         broken - "bad XRef entry"). Engine switch extraction/index.ts:
         ANTHROPIC_API_KEY -> claudeExtractor; else OPENROUTER_API_KEY ->
         openRouterExtractor (plain fetch, OpenAI-format, temperature 0,
         model env OPENROUTER_MODEL=anthropic/claude-haiku-4.5 - slugs rotate,
         discover via openrouter.ai /models); else mockExtractor (regex, offline).
         Output shape: {vendorName, invoiceNo, poNumber, amount, dueDate} all
         nullable. AI output is UNTRUSTED until verified.

VERIFY   rules/verify.ts - pure code, no AI imports. 5 ordered rules:
         1 fields present, 2 vendor exists in ERP (fuzzy contains-match),
         3 invoice references an OPEN PO in the ERP (also catches double-billing:
         second invoice vs already-MATCHED PO finds no OPEN PO), 4 PO belongs to
         same vendor, 5 amounts EXACTLY equal. Any failure -> NEEDS_REVIEW +
         failReason + audit, pipeline STOPS (nothing written to ERP).

ERP      On clean verify: create invoice in ERP linked to PO (ERP re-validates +
         auto-MATCHES PO). ERP 409 (duplicate invoiceNo) -> doc DUPLICATE.

ROUTE    rules/route.ts thresholds: <50,000 auto-approve (ERP invoice ->APPROVED,
         no human); 50k-5,00,000 -> FINANCE_HEAD ApprovalTask; >5L -> CFO task.
         Doc -> PENDING_APPROVAL, ERP invoice -> PENDING_APPROVAL.

APPROVE  Dashboard /approvals. Server rule: task.requiredRole must match user
         role, CFO/ADMIN outrank; EMPLOYEE/AP_CLERK 403. Order: update ERP FIRST,
         then product records. CONFLICT RECONCILIATION: if ERP refuses transition
         (someone decided directly in ERP UI), read ERP's actual status, sync
         task+doc to it, audit it, return 409 with explanation. ERP wins.

PAY      POST /api/documents/:id/pay (FINANCE_HEAD/CFO/ADMIN). ERP payment ->
         atomic PAID+CLOSED; doc -> PAID.

AUDIT    audit/audit.ts writes WorkflowEvent for EVERY step: actor
         SYSTEM|AI|RULE|HUMAN + message (+JSON). Append-only, never edited.
         Dashboard detail page renders it as a colored timeline.

OBSERVE  Bull Board (queues), Prisma Studio :5555 (DB browser), pgAdmin,
         pipeline terminal logs echo every audit line.
```

Document status enum journey:
RECEIVED->QUEUED->EXTRACTING->MATCHED->PENDING_APPROVAL->APPROVED->PAID,
branches: NEEDS_REVIEW, DUPLICATE, FAILED, REJECTED; <50k skips human to APPROVED.

## 4. Organizations & multi-tenancy (the important design)

- Verity has a first-class `Organization` table: id, name UNIQUE, erpType
  (default "minierp"), erpBaseUrl, erpCompany, erpApiKey?, erpApiSecret?.
  THE ORG ROW STORES HOW TO REACH THAT ORG'S ERP.
- Registration (web /register): name/email/password(min 8)/designation dropdown
  (EMPLOYEE view-only, AP_CLERK, FINANCE_HEAD, CFO, ADMIN - all self-serve by
  user's choice; SELF_SERVE_ROLES const in app.ts notes production would shrink
  to EMPLOYEE + invitations) + Organization name: NEW name CREATES org
  (erpCompany = slugified name e.g. "pine_labs"), existing name JOINS it.
  Auto-login on register.
- JWT (12h, jsonwebtoken; bcryptjs hashes) carries id/org id/org name/name/role.
  Tenant comes FROM THE TOKEN server-side (requireAuth sets req.orgId) - the old
  spoofable x-org-id header on Verity's API is gone. Org name chip in top bar.
- Legacy org "org_demo" (name "Sortof (Demo)") was backfilled INSIDE the
  migration SQL before adding the User FK (real migration technique). Demo users
  (*@sortof.test / demo1234): admin=Sourav ADMIN, clerk=Anil AP_CLERK,
  finhead=Rhea FINANCE_HEAD, cfo=Meera CFO. Gmail poller org: GMAIL_ORG_ID=org_demo.
- Login trims+lowercases inputs (copy-paste whitespace bug he actually hit).

## 5. ERP adapter registry (the swappability seam)

`server/src/erp/`:
- `types.ts`: ErpAdapter interface = 7 ops (listVendors, listOpenPOs, getPO,
  getInvoice, createInvoice, setInvoiceStatus, createPayment) + neutral shapes
  (ErpVendor/ErpPurchaseOrder/ErpInvoice, amounts as decimal strings) + ErpError.
- `miniErpAdapter.ts`: implements it via REST + x-org-id: cfg.company; clear
  503 "ERP unreachable" on network failure. Written as the template for ERPNext.
- `erpClient.ts`: dispatcher. resolve(orgId): Organization row (60s cache) ->
  ADAPTERS[erpType] -> delegate. Public functions keep signatures (orgId first),
  so pipeline/rules/app never change. ADDING ERPNEXT = new adapter file + one
  registry line + org row config (erpnext, real URL, token creds). Consumers
  import `* as erp from erpClient` and use erp.ErpError etc. (re-exported).

## 6. Databases (visual doc: finErpAP/docs/database-design.html)

finerp_ap (Verity): Organization 1-N User (real FK, RESTRICT);
IngestedDocument (org tag string; sha256 UQ(org,sha); erpInvoiceId/erpPoId =
API-reference strings, NOT FKs) 1-1 Extraction (documentId UQ), 1-0..1
ApprovalTask (documentId UQ), 1-N WorkflowEvent (append-only).
mini_erp: Vendor 1-N PurchaseOrder, Vendor/Customer 1-N Invoice (SET NULL),
PurchaseOrder 1-0..N Invoice, Invoice 1-N Payment (RESTRICT).
All money DECIMAL(14,2). Enums everywhere. Cross-DB link = Organization.erpCompany
travels as x-org-id; no cross-database FKs (API + reconciliation keep integrity).

## 7. Frontend (web/)

Hand-scaffolded Next.js 15 App Router (NO create-next-app), plain CSS design
system in app/globals.css. ZERO business logic client-side - lib/api.ts is the
only fetch door (Bearer token from localStorage, 401 -> logout redirect to
/login; register() takes organizationName). Pages: /login, /register (org field
+ designation dropdown with hints), / documents (3s polling, drag-drop upload
hidden for EMPLOYEE, stat cards, filter chips, pulsing processing badges,
skeletons), /documents/[id] (extraction card + audit timeline + Pay button),
/approvals (role-aware: buttons or lock "CFO only"). OrgHeader = auth gate +
brand + org chip + user + role chip + sign out.

## 8. Env & running (RUNBOOK.md has full detail)

server/.env keys: DATABASE_URL(finerp_ap), PORT=5000, ERP_BASE_URL=:4000,
STORAGE_DIR=./storage, ANTHROPIC_API_KEY(empty), OPENROUTER_API_KEY(set),
OPENROUTER_MODEL, VALKEY_HOST/PORT (+VALKEY_URL for cloud), JWT_SECRET
(dev default; env.ts prints SECURITY WARNING if default in production),
GMAIL_USER/GMAIL_APP_PASSWORD/GMAIL_POLL_SECONDS/GMAIL_ORG_ID.
web/.env: NEXT_PUBLIC_API_URL (unset locally).
Start order: Docker Desktop -> `docker compose up -d` (finErpAP/) -> miniERP
`npm run dev` -> server `npm run dev` -> web `npm run dev`.
Ports: 3000 web, 4000 ERP, 5000 pipeline(+/admin/queues), 5555 Prisma Studio,
6379 Valkey, 5432 Postgres. Pipeline fails fast without Valkey but ioredis
self-recovers when Valkey appears.

## 9. Deployability (verified)

Server tsc clean; web production build passes (~108kB first load). Free-tier
map: Vercel (web, set NEXT_PUBLIC_API_URL) + Railway/Render (server) + Neon
(Postgres) + Upstash (VALKEY_URL). Blocker before real deploy: storage is local
disk (Railway wipes it) - swap lib/storage.ts internals to S3/Cloudflare R2;
also mount Bull Board behind admin guard and set real JWT_SECRET.

## 10. War stories already fixed (do not re-break)

- pdf-parse broken -> pdfjs-dist (adapter made it 1-file swap).
- OpenRouter model slugs rotate -> discover via /models; 404 "No endpoints" = stale slug.
- Unhandled promise rejection KILLED the server (Node 24) -> asyncHandler wraps
  every route + central error middleware in server/src/app.ts (maps ErpError).
- Docs stuck QUEUED after retries -> worker failed-handler marks FAILED.
- Two-UIs conflict (reject in ERP, approve in Verity) -> reconciliation (sec 3 APPROVE).
- Docker Desktop zombie unix-socket files (dockerInference, engine.sock) block
  startup, survive reboot: fix = rename parent dir (run/, docker-secrets-engine/),
  create fresh, relaunch. Sidelined dirs still exist under %LOCALAPPDATA%\Docker.
- VS Code "ghost tabs" (stale buffers) 3x overwrote files with week-old code
  (once deleted all auth from app.ts) -> ALWAYS "Don't Save" on unknown unsaved
  changes; git restore fixes; .vscode/settings.json now has autoSave+hotExit:off.
  Root cause = projects live in OneDrive; planned move to C:\dev never completed
  (folder locks). If weird stale code appears: `git status` + `git restore`.
- EADDRINUSE on 3000/5000: orphaned node child holds port ->
  Get-NetTCPConnection -LocalPort X | Stop-Process its OwningProcess.
- Next.js dev 500 / "Cannot find module ./NNN.js": stale .next -> rm -rf .next.
  Never run `next build` while dev server runs.
- Gmail unread-flag approach failed (something re-marks Seen instantly) ->
  3-day-window + processed-UID + sha256 design (sec 3 INGEST).

## 11. Docs & artifacts that exist

- finErpAP/docs/system-map.html (file-by-file map + traces),
  database-design.html (ERDs + dictionaries),
  finErpAP-Engineering-Document.pdf (21-page book, generator script was in
  scratchpad), README.md (arch + API table + deploy), RUNBOOK.md.
- miniERP/public/: architecture.html, flow.html, product-explainer.html diagrams.

## 12. Current uncommitted state (he pushes himself)

M server/src/config/env.ts (JWT prod warning), M server/src/erp/erpClient.ts
(dispatcher), NEW erp/types.ts, erp/miniErpAdapter.ts, docs/database-design.html,
this CONTEXT.md. Everything else committed & pushed by him.

## 13. Roadmap (agreed, in priority order)

1. Pagination for /api/documents (DESIGN AGREED: offset 10/page + server-side
   stats endpoint via groupBy + server-side status filter; only page 1 polls) - not built yet.
2. ERPNext integration (the real external ERP; miniERP stays as dev/test double).
3. Free-tier deploy (needs R2 storage swap first).
4. Differentiators discussed: line-item matching w/ partial billing (top pick),
   extraction confidence + golden-set eval harness, fraud signals, ROI dashboard,
   one-click email approve. Skipped by choice: hard delete (never), needs-review
   resolution UI (manual fix-and-requeue via script was demoed; he passed for now).
