import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/auth.js";
import { env } from "../src/config/env.js";

// Seeds the demo organization and its team. Run with: npx tsx scripts/seedUsers.ts
// Everything is an upsert, so it is safe to re-run against an existing database
// and it works on a completely empty one (a fresh cloud deploy).
// All demo passwords are "demo1234" - CHANGE for anything public.
const prisma = new PrismaClient();

// The ID is a stable identifier, not cosmetic: GMAIL_ORG_ID points at it, and
// it travels to miniERP as the x-org-id tenant tag (miniERP's own seed uses the
// same value). The NAME is the only display-facing part.
const ORG_ID = "org_demo";
const ORG_NAME = "Acme Corp";
const PASSWORD = "demo1234";

const team = [
  { email: "admin@acme.test",   name: "Sourav (Admin)",  role: "ADMIN" as const },
  { email: "clerk@acme.test",   name: "Anil (AP Clerk)", role: "AP_CLERK" as const },
  { email: "finhead@acme.test", name: "Rhea (Finance Head)", role: "FINANCE_HEAD" as const },
  { email: "cfo@acme.test",     name: "Meera (CFO)",     role: "CFO" as const },
];

async function main() {
  // The organization comes first: every user needs one (real foreign key), and
  // on a fresh database it does not exist yet.
  const org = await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: { name: ORG_NAME, erpBaseUrl: env.ERP_BASE_URL },
    create: {
      id: ORG_ID,
      name: ORG_NAME,
      erpType: "minierp",
      erpBaseUrl: env.ERP_BASE_URL, // set ERP_BASE_URL before seeding a deploy
      erpCompany: ORG_ID,           // the tenant tag miniERP knows this org by
    },
  });
  console.log(`Organization "${org.name}" ready (id ${org.id})`);
  console.log(`  ERP: ${org.erpBaseUrl}  (x-org-id: ${org.erpCompany})\n`);

  const passwordHash = hashPassword(PASSWORD);
  for (const t of team) {
    await prisma.user.upsert({
      where: { email: t.email },
      update: { role: t.role, name: t.name },
      create: { organizationId: ORG_ID, email: t.email, name: t.name, role: t.role, passwordHash },
    });
    console.log(`  ${t.role.padEnd(13)} ${t.email}  (password: ${PASSWORD})`);
  }
  console.log(`\nDemo team ready for ${ORG_NAME}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
