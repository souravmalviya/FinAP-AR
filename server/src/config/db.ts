import { PrismaClient } from "@prisma/client";

// Single shared Prisma client (same pattern as the Mini-ERP).
export const prisma = new PrismaClient();
