import { eq } from "drizzle-orm";

import type { Database } from "../client.js";
import { cotikWorkflowSettings, type CotikWorkflowSettingsRow } from "../schema.js";

export async function getCotikWorkflowSettings(
  db: Database
): Promise<CotikWorkflowSettingsRow | null> {
  const [settings] = await db.select().from(cotikWorkflowSettings).limit(1);
  return settings ?? null;
}

export async function ensureCotikWorkflowSettings(
  db: Database
): Promise<CotikWorkflowSettingsRow> {
  // Use INSERT ... ON CONFLICT DO NOTHING to prevent TOCTOU race where two concurrent
  // workers both see no row and both insert, creating a split-brain settings situation.
  // The pg_advisory_lock in the worker cycle is the primary guard; this is defense-in-depth.
  await db
    .insert(cotikWorkflowSettings)
    .values({
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: null,
      lastResetAt: null
    })
    .onConflictDoNothing();

  const [settings] = await db.select().from(cotikWorkflowSettings).limit(1);

  if (!settings) {
    throw new Error("Failed to initialize or read cotik workflow settings");
  }

  return settings;
}

export interface SetCotikWorkflowSettingsInput {
  cotikSyncEnabled?: boolean | undefined;
  cotikPostEnabled?: boolean | undefined;
  deploymentId?: string | null | undefined;
}

export async function setCotikWorkflowSettings(
  db: Database,
  input: SetCotikWorkflowSettingsInput
): Promise<CotikWorkflowSettingsRow> {
  const current = await ensureCotikWorkflowSettings(db);

  const updates: Partial<typeof cotikWorkflowSettings.$inferInsert> = {
    updatedAt: new Date()
  };

  if (input.cotikSyncEnabled !== undefined) {
    updates.cotikSyncEnabled = input.cotikSyncEnabled;
  }
  if (input.cotikPostEnabled !== undefined) {
    updates.cotikPostEnabled = input.cotikPostEnabled;
  }
  if (input.deploymentId !== undefined) {
    updates.deploymentId = input.deploymentId;
  }

  const [updated] = await db
    .update(cotikWorkflowSettings)
    .set(updates)
    .where(eq(cotikWorkflowSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to update cotik workflow settings");
  }

  return updated;
}

export interface DeploymentResetResult {
  reset: boolean;
  previousDeploymentId: string | null;
  currentDeploymentId: string;
}

/**
 * Ensures deployment-based kill switch safety:
 * When a new deployment ID is detected, BOTH cotikSyncEnabled and cotikPostEnabled
 * are reset to OFF (false) exactly once for that deployment.
 */
export async function resetCotikWorkflowSettingsForDeployment(
  db: Database,
  currentDeploymentId: string
): Promise<DeploymentResetResult> {
  const cleanDeploymentId = currentDeploymentId.trim();
  if (cleanDeploymentId.length === 0) {
    throw new Error("Deployment ID is required before Cotik workflow execution");
  }

  const current = await ensureCotikWorkflowSettings(db);

  if (current.deploymentId === cleanDeploymentId) {
    // Already reset for this deployment
    return {
      reset: false,
      previousDeploymentId: current.deploymentId,
      currentDeploymentId: cleanDeploymentId
    };
  }

  const now = new Date();
  await db
    .update(cotikWorkflowSettings)
    .set({
      cotikSyncEnabled: false,
      cotikPostEnabled: false,
      deploymentId: cleanDeploymentId,
      lastResetAt: now,
      updatedAt: now
    })
    .where(eq(cotikWorkflowSettings.id, current.id));

  return {
    reset: true,
    previousDeploymentId: current.deploymentId,
    currentDeploymentId: cleanDeploymentId
  };
}
