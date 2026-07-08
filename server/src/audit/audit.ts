import { Actor } from "@prisma/client";
import { prisma } from "../config/db.js";

// ----------------------------------------------------------------------------
//  Audit trail. Finance is regulated: every decision must answer
//  "who did this, when, and why?" — including decisions made by AI and rules.
//
//  We call audit() at EVERY pipeline step. It's append-only: we never update
//  or delete audit rows. The UI timeline is built from these.
// ----------------------------------------------------------------------------

export async function audit(
  organizationId: string,
  documentId: string,
  step: string,
  actor: Actor,
  message: string,
  data?: object
) {
  await prisma.workflowEvent.create({
    data: {
      organizationId,
      documentId,
      step,
      actor,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : undefined,
    },
  });
  // Also echo to the server log — handy while developing.
  console.log(`[${step}] (${actor}) doc=${documentId.slice(0, 8)} ${message}`);
}
