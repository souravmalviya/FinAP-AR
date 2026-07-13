import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { env } from "../config/env.js";

// ----------------------------------------------------------------------------
//  Authentication (who are you?) + Authorization (what may you do?)
//
//  Flow: POST /api/auth/login checks email+password -> issues a signed JWT.
//  Every later request carries "Authorization: Bearer <token>".
//  requireAuth() verifies the token and attaches the user to the request -
//  including organizationId, so THE TENANT NOW COMES FROM IDENTITY, not from
//  a spoofable x-org-id header. That's the security upgrade.
// ----------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  organizationId: string;
  organizationName: string; // shown in the top bar; carried in the JWT
  name: string;
  role: UserRole;
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user: AuthUser): string {
  // The token carries everything we need - no DB hit per request.
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: "12h" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }
  try {
    const user = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    (req as any).user = user;
    (req as any).orgId = user.organizationId; // downstream code keeps working unchanged
    next();
  } catch {
    return res.status(401).json({ error: "Session expired - log in again" });
  }
}

// Route guard factory: requireRole("FINANCE_HEAD", "CFO", "ADMIN")
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({
        error: `Your role (${user?.role ?? "none"}) is not allowed to do this`,
      });
    }
    next();
  };
}
