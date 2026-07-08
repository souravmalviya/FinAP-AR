-- CreateEnum
CREATE TYPE "DocSource" AS ENUM ('UPLOAD', 'EMAIL');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('RECEIVED', 'QUEUED', 'EXTRACTING', 'NEEDS_REVIEW', 'MATCHED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractEngine" AS ENUM ('MOCK', 'CLAUDE');

-- CreateEnum
CREATE TYPE "ApproverRole" AS ENUM ('FINANCE_HEAD', 'CFO');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('SYSTEM', 'AI', 'RULE', 'HUMAN');

-- CreateTable
CREATE TABLE "IngestedDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "DocSource" NOT NULL DEFAULT 'UPLOAD',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'RECEIVED',
    "failReason" TEXT,
    "erpInvoiceId" TEXT,
    "erpPoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Extraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "vendorName" TEXT,
    "invoiceNo" TEXT,
    "poNumber" TEXT,
    "amount" DECIMAL(14,2),
    "dueDate" TIMESTAMP(3),
    "engine" "ExtractEngine" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Extraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredRole" "ApproverRole" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestedDocument_organizationId_status_idx" ON "IngestedDocument"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IngestedDocument_organizationId_sha256_key" ON "IngestedDocument"("organizationId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Extraction_documentId_key" ON "Extraction"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalTask_documentId_key" ON "ApprovalTask"("documentId");

-- CreateIndex
CREATE INDEX "ApprovalTask_organizationId_status_idx" ON "ApprovalTask"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkflowEvent_documentId_idx" ON "WorkflowEvent"("documentId");

-- CreateIndex
CREATE INDEX "WorkflowEvent_organizationId_idx" ON "WorkflowEvent"("organizationId");

-- AddForeignKey
ALTER TABLE "Extraction" ADD CONSTRAINT "Extraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IngestedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalTask" ADD CONSTRAINT "ApprovalTask_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IngestedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowEvent" ADD CONSTRAINT "WorkflowEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IngestedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
