import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";
import { ingestFile, InvalidPdfError } from "./ingest/ingestFile.js";
import { audit } from "./audit/audit.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { requireAuth, requireRole, signToken, verifyPassword, hashPassword, AuthUser } from "./auth/auth.js";
import * as erp from "./erp/erpClient.js";
import { authLimiter, apiLimiter, loginGate, noteLoginFailure, noteLoginSuccess } from "./security/rateLimit.js";
import { registerSchema, loginSchema, uuidSchema, searchQuerySchema, paySchema, rejectInvalid } from "./utils/validate.js";

// ----------------------------------------------------------------------------
//  The product's API. Endpoints:
//
//    POST /api/documents/upload   "an invoice arrived" (simulates the email)
//    GET  /api/documents          list all documents + status
//    GET  /api/documents/:id      one document + extraction + audit timeline
//    GET  /api/approvals          pending human approvals
//    POST /api/approvals/:id/approve | /reject
//    POST /api/documents/:id/pay  record payment (via the ERP)
// ----------------------------------------------------------------------------

export const app = express();

// Behind Render/Railway/Vercel a proxy sits in front of us; without this,
// req.ip would be the proxy's address and per-IP rate limits would lump every
// visitor together.
app.set("trust proxy", 1);

// Cap JSON bodies: our biggest legitimate JSON payload is a login/register
// form. (File uploads use multipart via multer, not this parser.)
app.use(express.json({ limit: "100kb" }));

// CORS - which browser origins may call this API. "*" locally; the exact
// dashboard URL in production (set CORS_ORIGIN).
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", env.CORS_ORIGIN);
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "finerp-ap" }));

// ---- AUTH (public routes - the only /api paths that work without a token) ----

// Role choice at sign-up is validated by registerSchema's enum - a demo
// convenience; in production the list shrinks to ["EMPLOYEE"] and finance
// roles come via admin invitation.

app.post("/api/auth/register", authLimiter, asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return rejectInvalid(res, parsed.error);
  const { name, email, password, role, organizationName } = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  // The organization is a REAL entity now. First registrant with a new name
  // CREATES the organization; later registrants with the same name JOIN it.
  // (Production would gate joining behind an admin invitation - demo keeps it open.)
  let org = await prisma.organization.findUnique({ where: { name: organizationName } });
  if (!org) {
    // erpCompany = the tenant tag this org's data carries INSIDE the ERP.
    // For the miniERP that's the x-org-id value; a readable slug of the name.
    const erpCompany = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    org = await prisma.organization.create({
      data: { name: organizationName, erpType: "minierp", erpBaseUrl: env.ERP_BASE_URL, erpCompany },
    });
  }

  const user = await prisma.user.create({
    // trim to match login's verify step - historic hashes are of trimmed input
    data: { organizationId: org.id, name, email, role, passwordHash: hashPassword(password.trim()) },
  });

  // Register = logged in immediately (no second step).
  const authUser: AuthUser = {
    id: user.id, organizationId: org.id, organizationName: org.name, name: user.name, role: user.role,
  };
  res.status(201).json({ token: signToken(authUser), user: authUser });
}));

app.post("/api/auth/login", authLimiter, asyncHandler(async (req, res) => {
  // loginSchema trims + lowercases the email (copy-pasted credentials often
  // carry an invisible trailing space; emails are case-insensitive).
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) return rejectInvalid(res, parsed.error);
  const { email, password } = parsed.data;

  // Per-account exponential backoff (see security/rateLimit.ts): a growing
  // wait after repeated failures, keyed by account, not IP.
  const gate = loginGate(email);
  if (gate.blocked) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({
      error: `Too many failed attempts for this account - try again in ${gate.retryAfterSec}s`,
    });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { organization: true } });
  // Same error for "no such user" and "wrong password" - never help attackers
  // figure out which emails exist.
  if (!user || !verifyPassword(password.trim(), user.passwordHash)) {
    noteLoginFailure(email);
    return res.status(401).json({ error: "Invalid email or password" });
  }
  noteLoginSuccess(email);

  const authUser: AuthUser = {
    id: user.id, organizationId: user.organizationId, organizationName: user.organization.name,
    name: user.name, role: user.role,
  };
  res.json({ token: signToken(authUser), user: authUser });
}));

// Everything below requires a valid login token. The user's organizationId
// becomes the tenant - no more spoofable x-org-id header.
app.use("/api", requireAuth);
// Looser per-USER rate limit on the authenticated API (keyed by user id from
// the verified JWT, so one office IP never throttles innocent colleagues).
app.use("/api", apiLimiter);

app.get("/api/auth/me", (req, res) => res.json((req as any).user));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024 },
  // First gate: declared type must be PDF. The REAL check is the "%PDF-"
  // content signature at the ingest front door - this just fails fast.
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new InvalidPdfError("Only PDF files are accepted"));
    }
    cb(null, true);
  },
});

// ---- INGEST: the front door of the whole pipeline ---------------------------
// The actual ingest logic lives in ingest/ingestFile.ts, shared with the
// Gmail poller - every source goes through the same door.
// EMPLOYEE is view-only, so uploading requires a working role.
app.post("/api/documents/upload", requireRole("AP_CLERK", "FINANCE_HEAD", "CFO", "ADMIN"), upload.single("file"), async (req, res) => {
  try {
    const orgId = (req as any).orgId as string;
    if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')" });

    const result = await ingestFile(orgId, req.file.originalname, req.file.buffer, "UPLOAD");

    if (result.duplicate) {
      return res.status(409).json({
        error: "Duplicate file - this exact PDF was already ingested",
        documentId: result.documentId,
        status: result.status,
      });
    }
    res.status(201).json({ documentId: result.documentId, status: "QUEUED" });
  } catch (e) {
    // Bad file = client's fault, say why. Anything else = ours: log the full
    // details server-side, tell the user something generic (no internals).
    if (e instanceof InvalidPdfError) return res.status(400).json({ error: e.message });
    console.error("Upload failed:", e);
    res.status(500).json({ error: "Upload failed - the details have been logged" });
  }
});

// ---- READ: documents + timeline ---------------------------------------------
// Optional ?q= searches across file name and the extracted vendor / invoice
// number / PO number, case-insensitive. Server-side on purpose: the list only
// ever grows (no deletes by design), and search must keep working once
// pagination lands and the browser holds just one page.
app.get("/api/documents", asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
  const parsedQ = searchQuerySchema.safeParse(req.query.q);
  if (!parsedQ.success) return rejectInvalid(res, parsedQ.error);
  const q = parsedQ.data ?? "";
  const docs = await prisma.ingestedDocument.findMany({
    where: {
      organizationId: orgId,
      ...(q
        ? {
            OR: [
              { fileName: { contains: q, mode: "insensitive" } },
              { extraction: { is: { vendorName: { contains: q, mode: "insensitive" } } } },
              { extraction: { is: { invoiceNo: { contains: q, mode: "insensitive" } } } },
              { extraction: { is: { poNumber: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { extraction: true, approval: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(docs);
}));

app.get("/api/documents/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
  if (!uuidSchema.safeParse(req.params.id).success)
    return res.status(400).json({ error: "Invalid document id" });
  const doc = await prisma.ingestedDocument.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: {
      extraction: true,
      approval: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!doc) return res.status(404).json({ error: "Document not found" });
  res.json(doc);
}));

// ---- HUMAN APPROVALS ----------------------------------------------------------
app.get("/api/approvals", asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
  const tasks = await prisma.approvalTask.findMany({
    where: { organizationId: orgId, status: "PENDING" },
    include: { document: { include: { extraction: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(tasks);
}));

async function decideApproval(req: Request, res: Response, decision: "APPROVED" | "REJECTED") {
  const orgId = (req as any).orgId as string;
  const user = (req as any).user as AuthUser;
  if (!uuidSchema.safeParse(req.params.id).success)
    return res.status(400).json({ error: "Invalid task id" });
  // The audit log records the REAL logged-in person - not a typed-in name.
  const decidedBy = `${user.name} (${user.role})`;

  const task = await prisma.approvalTask.findFirst({
    where: { id: req.params.id, organizationId: orgId, status: "PENDING" },
    include: { document: true },
  });
  if (!task) return res.status(404).json({ error: "Pending approval task not found" });
  if (!task.document.erpInvoiceId)
    return res.status(500).json({ error: "Document has no linked ERP invoice" });

  // AUTHORIZATION - the designated-person rule:
  //   FINANCE_HEAD may decide FINANCE_HEAD tasks only.
  //   CFO outranks: may decide any task. ADMIN likewise.
  //   Everyone else (AP_CLERK): never.
  const outranks = user.role === "CFO" || user.role === "ADMIN";
  if (!outranks && user.role !== task.requiredRole) {
    return res.status(403).json({
      error: `This invoice requires ${task.requiredRole} approval - your role is ${user.role}`,
    });
  }

  // 1. Update the ERP (the system of record) FIRST...
  try {
    await erp.setInvoiceStatus(orgId, task.document.erpInvoiceId, decision);
  } catch (e) {
    // The ERP refused the transition - almost always because someone decided
    // this invoice DIRECTLY in the ERP UI. The ERP is the system of record,
    // so we don't fight it: read its actual state, sync ourselves to it,
    // and tell the user what happened.
    if (e instanceof erp.ErpError && e.status === 400) {
      const actual = await erp.getInvoice(orgId, task.document.erpInvoiceId);
      if (actual.status === "APPROVED" || actual.status === "REJECTED" || actual.status === "PAID") {
        const syncedStatus = actual.status === "PAID" ? "PAID" : actual.status;
        await prisma.approvalTask.update({
          where: { id: task.id },
          data: {
            status: actual.status === "REJECTED" ? "REJECTED" : "APPROVED",
            decidedBy: "decided directly in the ERP",
            decidedAt: new Date(),
          },
        });
        await prisma.ingestedDocument.update({
          where: { id: task.documentId },
          data: { status: syncedStatus },
        });
        await audit(orgId, task.documentId, "APPROVAL", "SYSTEM",
          `Conflict: this invoice was already ${actual.status} directly in the ERP - product records synced to match`);
        return res.status(409).json({
          error: `Already ${actual.status} directly in the ERP - records are now synced. Refresh to see the current state.`,
        });
      }
    }
    throw e; // anything else -> central error handler
  }

  // 2. ...then our workflow records.
  await prisma.approvalTask.update({
    where: { id: task.id },
    data: { status: decision, decidedBy, decidedAt: new Date() },
  });
  await prisma.ingestedDocument.update({
    where: { id: task.documentId },
    data: { status: decision },
  });
  await audit(orgId, task.documentId, "APPROVAL", "HUMAN",
    `${task.requiredRole} ${decision} by "${decidedBy}"`);

  res.json({ ok: true, decision });
}

app.post("/api/approvals/:id/approve", asyncHandler((req, res) => decideApproval(req, res, "APPROVED")));
app.post("/api/approvals/:id/reject", asyncHandler((req, res) => decideApproval(req, res, "REJECTED")));

// ---- PAY: the final step (finance roles only) -----------------------------------
app.post("/api/documents/:id/pay", requireRole("FINANCE_HEAD", "CFO", "ADMIN"), asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
  if (!uuidSchema.safeParse(req.params.id).success)
    return res.status(400).json({ error: "Invalid document id" });
  const parsedBody = paySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) return rejectInvalid(res, parsedBody.error);

  const doc = await prisma.ingestedDocument.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: { extraction: true },
  });
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status !== "APPROVED")
    return res.status(400).json({ error: `Document must be APPROVED to pay (currently ${doc.status})` });
  if (!doc.erpInvoiceId || !doc.extraction?.amount)
    return res.status(500).json({ error: "Missing ERP invoice link or amount" });

  const reference = parsedBody.data.reference || `UTR-${Date.now()}`;
  await erp.createPayment(orgId, {
    invoiceId: doc.erpInvoiceId,
    amount: Number(doc.extraction.amount),
    reference,
  });

  await prisma.ingestedDocument.update({ where: { id: doc.id }, data: { status: "PAID" } });
  await audit(orgId, doc.id, "PAY", "SYSTEM",
    `Payment ₹${doc.extraction.amount} recorded in ERP (ref ${reference}); PO closed`);

  res.json({ ok: true });
}));

// Unknown /api path: clean JSON 404 (not Express's default HTML page, which
// names the framework and echoes the path back).
app.use("/api", (_req: Request, res: Response) => res.status(404).json({ error: "Not found" }));

// ---- CENTRAL ERROR HANDLER - must be registered LAST -------------------------
// Any error thrown in any route lands here and becomes a clean JSON response.
// Without this, one rejected promise would kill the whole process (Node 15+).
// Policy: OPERATIONAL errors (ERP said no, bad file, body too big) carry a
// curated, safe message to the user. UNEXPECTED errors are logged in full
// server-side (stack and all) and the user gets a generic line - stack
// traces, file paths, and raw Prisma/DB errors must never leave the server.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof erp.ErpError) {
    // The system of record said no - pass its reason through honestly.
    return res.status(err.status === 400 ? 409 : err.status).json({ error: `ERP: ${err.message}` });
  }
  if (err instanceof InvalidPdfError) {
    return res.status(400).json({ error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE"
      ? `File too large (max ${env.UPLOAD_MAX_MB} MB)`
      : "Upload rejected";
    return res.status(400).json({ error: msg });
  }
  if (err instanceof SyntaxError && "body" in (err as object)) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Something went wrong on our side - the details have been logged" });
});
