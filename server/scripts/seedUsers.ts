import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/auth/auth.js";

// Creates the demo team for org_demo. Run with: npx tsx scripts/seedUsers.ts
// All demo passwords are "demo1234" — CHANGE for anything public.
const prisma = new PrismaClient();

const ORG = "org_demo";
const PASSWORD = "demo1234";

const team = [
  { email: "admin@sortof.test",   name: "Sourav (Admin)",  role: "ADMIN" as const },
  { email: "clerk@sortof.test",   name: "Anil (AP Clerk)", role: "AP_CLERK" as const },
  { email: "finhead@sortof.test", name: "Rhea (Finance Head)", role: "FINANCE_HEAD" as const },
  { email: "cfo@sortof.test",     name: "Meera (CFO)",     role: "CFO" as const },
];

async function main() {
  const passwordHash = hashPassword(PASSWORD);
  for (const t of team) {
    await prisma.user.upsert({
      where: { email: t.email },
      update: { role: t.role, name: t.name },
      create: { organizationId: ORG, email: t.email, name: t.name, role: t.role, passwordHash },
    });
    console.log(`  ${t.role.padEnd(13)} ${t.email}  (password: ${PASSWORD})`);
  }
  console.log("\nDemo team ready for", ORG);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
