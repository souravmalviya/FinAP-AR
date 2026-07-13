-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "erpType" TEXT NOT NULL DEFAULT 'minierp',
    "erpBaseUrl" TEXT NOT NULL DEFAULT 'http://localhost:4000',
    "erpCompany" TEXT NOT NULL,
    "erpApiKey" TEXT,
    "erpApiSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");


-- Backfill: existing users all reference org_demo, so that organization
-- must exist BEFORE the foreign key below is added. It maps to the miniERP
-- exactly as the hardcoded values did (baseUrl localhost:4000, x-org-id org_demo).
INSERT INTO "Organization" ("id", "name", "erpType", "erpBaseUrl", "erpCompany")
VALUES ('org_demo', 'Sortof (Demo)', 'minierp', 'http://localhost:4000', 'org_demo');

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
