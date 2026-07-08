import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "./config/db.js";
import { ingestFile } from "./ingest/ingestFile.js";
import { audit } from "./audit/audit.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { requireAuth, requireRole, signToken, verifyPassword, hashPassword, AuthUser } from "./auth/auth.js";
import { UserRole } from "@prisma/client";
import * as erp from "./erp/erpClient.js";

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
app.use(express.json());

// CORS — the Next.js dashboard (localhost:3000) will call this API.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "finerp-ap" }));

// ---- AUTH (public routes — the only /api paths that work without a token) ----

// Roles a person may pick for themselves at sign-up.
// (Self-pick of powerful roles is a demo convenience — in production this
// list shrinks to ["EMPLOYEE"] and finance roles come via admin invitation.)
const SELF_SERVE_ROLES: UserRole[] = ["EMPLOYEE", "AP_CLERK", "FINANCE_HEAD", "CFO", "ADMIN"];

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "").trim();
  const role = String(req.body?.role ?? "") as UserRole;

  if (!name || !email || !password)
    return res.status(400).json({ error: "name, email and password are required" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!SELF_SERVE_ROLES.includes(role))
    return res.status(400).json({ error: "Invalid designation" });

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "An account with this email already exists" });

  const user = await prisma.user.create({
    data: { organizationId: "org_demo", name, email, role, passwordHash: hashPassword(password) },
  });

  // Register = logged in immediately (no second step).
  const authUser: AuthUser = {
    id: user.id, organizationId: user.organizationId, name: user.name, role: user.role,
  };
  res.status(201).json({ token: signToken(authUser), user: authUser });
}));

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  // Trim + lowercase: copy-pasted credentials often carry an invisible
  // trailing space/newline, and emails are case-insensitive by convention.
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "").trim();
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const user = await prisma.user.findUnique({ where: { email } });
  // Same error for "no such user" and "wrong password" — never help attackers
  // figure out which emails exist.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const authUser: AuthUser = {
    id: user.id, organizationId: user.organizationId, name: user.name, role: user.role,
  };
  res.json({ token: signToken(authUser), user: authUser });
}));

// Everything below requires a valid login token. The user's organizationId
// becomes the tenant — no more spoofable x-org-id header.
app.use("/api", requireAuth);

app.get("/api/auth/me", (req, res) => res.json((req as any).user));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---- INGEST: the front door of the whole pipeline ---------------------------
// The actual ingest logic lives in ingest/ingestFile.ts, shared with the
// Gmail poller — every source goes through the same door.
// EMPLOYEE is view-only, so uploading requires a working role.
app.post("/api/documents/upload", requireRole("AP_CLERK", "FINANCE_HEAD", "CFO", "ADMIN"), upload.single("file"), async (req, res) => {
  try {
    const orgId = (req as any).orgId as string;
    if (!req.file) return res.status(400).json({ error: "No file uploaded (field name: 'file')" });

    const result = await ingestFile(orgId, req.file.originalname, req.file.buffer, "UPLOAD");

    if (result.duplicate) {
      return res.status(409).json({
        error: "Duplicate file — this exact PDF was already ingested",
        documentId: result.documentId,
        status: result.status,
      });
    }
    res.status(201).json({ documentId: result.documentId, status: "QUEUED" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Upload failed" });
  }
});

// ---- READ: documents + timeline ---------------------------------------------
app.get("/api/documents", asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
  const docs = await prisma.ingestedDocument.findMany({
    where: { organizationId: orgId },
    include: { extraction: true, approval: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(docs);
}));

app.get("/api/documents/:id", asyncHandler(async (req, res) => {
  const orgId = (req as any).orgId as string;
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
  // The audit log records the REAL logged-in person — not a typed-in name.
  const decidedBy = `${user.name} (${user.role})`;

  const task = await prisma.approvalTask.findFirst({
    where: { id: req.params.id, organizationId: orgId, status: "PENDING" },
    include: { document: true },
  });
  if (!task) return res.status(404).json({ error: "Pending approval task not found" });
  if (!task.document.erpInvoiceId)
    return res.status(500).json({ error: "Document has no linked ERP invoice" });

  // AUTHORIZATION — the designated-person rule:
  //   FINANCE_HEAD may decide FINANCE_HEAD tasks only.
  //   CFO outranks: may decide any task. ADMIN likewise.
  //   Everyone else (AP_CLERK): never.
  const outranks = user.role === "CFO" || user.role === "ADMIN";
  if (!outranks && user.role !== task.requiredRole) {
    return res.status(403).json({
      error: `This invoice requires ${task.requiredRole} approval — your role is ${user.role}`,
    });
  }

  // 1. Update the ERP (the system of record) FIRST...
  try {
    await erp.setInvoiceStatus(orgId, task.document.erpInvoiceId, decision);
  } catch (e) {
    // The ERP refused the transition — almost always because someone decided
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
          `Conflict: this invoice was already ${actual.status} directly in the ERP — product records synced to match`);
        return res.status(409).json({
          error: `Already ${actual.status} directly in the ERP — records are now synced. Refresh to see the current state.`,
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
  const doc = await prisma.ingestedDocument.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: { extraction: true },
  });
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (doc.status !== "APPROVED")
    return res.status(400).json({ error: `Document must be APPROVED to pay (currently ${doc.status})` });
  if (!doc.erpInvoiceId || !doc.extraction?.amount)
    return res.status(500).json({ error: "Missing ERP invoice link or amount" });

  const reference = (req.body?.reference as string) || `UTR-${Date.now()}`;
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

// ---- CENTRAL ERROR HANDLER — must be registered LAST -------------------------
// Any error thrown in any route lands here and becomes a clean JSON response.
// Without this, one rejected promise would kill the whole process (Node 15+).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof erp.ErpError) {
    // The system of record said no — pass its reason through honestly.
    return res.status(err.status === 400 ? 409 : err.status).json({ error: `ERP: ${err.message}` });
  }
  console.error("Unexpected error:", err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
});
