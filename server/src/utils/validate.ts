import { z } from "zod";
import { Response } from "express";

// ----------------------------------------------------------------------------
//  Input validation - strict zod schemas, REJECT-not-sanitize.
//
//  .strict() refuses unknown keys, so a request smuggling extra fields
//  (e.g. {"role": "ADMIN", "isSuperuser": true}) fails loudly instead of the
//  extra field silently riding along. Length caps bound every string so no
//  input can be used to balloon the database or the bcrypt hash step.
// ----------------------------------------------------------------------------

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80),
    email: z.string().trim().toLowerCase().email("a valid email is required").max(120),
    // bcrypt ignores input beyond 72 bytes; cap at 128 well before anything odd.
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    role: z.enum(["EMPLOYEE", "AP_CLERK", "FINANCE_HEAD", "CFO", "ADMIN"], {
      message: "Invalid designation",
    }),
    organizationName: z.string().trim().min(2, "organization name is required").max(80),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("a valid email is required").max(120),
    password: z.string().min(1, "password is required").max(128),
  })
  .strict();

// Route params: every id in this system is a UUID (Prisma @default(uuid())).
export const uuidSchema = z.string().uuid();

// /api/documents?q= - free text, bounded. Arrays (?q=a&q=b) are rejected.
export const searchQuerySchema = z.string().trim().max(100).optional();

// /api/documents/:id/pay body - reference is optional and tightly shaped.
export const paySchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[A-Za-z0-9/_-]+$/, "reference may contain letters, numbers, - _ /")
      .optional(),
  })
  .strict();

// One consistent 400 for any schema failure: field + reason, nothing internal.
export function rejectInvalid(res: Response, error: z.ZodError) {
  const first = error.issues[0];
  const prefix = first.path.length ? `${first.path.join(".")}: ` : "";
  return res.status(400).json({ error: `${prefix}${first.message}` });
}
