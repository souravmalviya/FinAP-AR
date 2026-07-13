# Verity - AP Automation Product

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

- `server/` - the pipeline + API (Express, TypeScript, Prisma, BullMQ)
- `web/` - Next.js dashboard (next milestone)
- `docker-compose.yml` - infrastructure: Valkey (open-source Redis fork), the queue's broker

## The two databases (important!)

| DB | Owner | Stores |
|---|---|---|
| `mini_erp` | the ERP (:4000) | financial truth: vendors, POs, invoices, payments |
| `finerp_ap` | this product (:5000) | workflow: documents, extractions, approvals, audit log |

The product NEVER touches the ERP's database directly - only its REST API,
via `server/src/erp/erpClient.ts` (the one file that knows how to talk to it).

