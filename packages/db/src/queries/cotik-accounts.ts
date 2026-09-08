import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "../client.js";
import {
  cotikAccounts,
  cotikAccountSecrets,
  type CotikAccountRow,
  type CotikAccountSecretRow
} from "../schema.js";

const DEFAULT_KEY_ID = "v1";
const DEFAULT_KEY_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;

/** Keyring contract: key id -> positive vault version -> 64-character hex key. */
export type CotikVaultKeyring = Readonly<Record<string, Readonly<Record<number, string>>>>;

export interface CotikTokenDecryptionOptions {
  readonly vaultKeyHex?: string | undefined;
  readonly keyring?: CotikVaultKeyring | undefined;
}

export interface CotikTokenEncryptionOptions {
  readonly vaultKeyHex?: string | undefined;
  readonly keyId?: string | undefined;
  readonly version?: number | undefined;
}

export interface CotikVaultKeyringEntry {
  readonly keyId: string;
  readonly version: number;
  readonly hex: string;
}

export interface EncryptedSecretPayload {
  keyId: string;
  version: number;
  encryptedToken: Buffer;
  nonce: Buffer;
  authTag: Buffer;
}

export function getVaultKey(overrideHex?: string): Buffer {
  const keyHex = overrideHex ?? process.env.COTIK_VAULT_KEY;
  if (!keyHex) {
    throw new Error("COTIK_VAULT_KEY environment variable is required for secret operations");
  }
  const cleanHex = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    throw new Error("COTIK_VAULT_KEY must be a 64-character hex string (256 bits)");
  }
  return Buffer.from(cleanHex, "hex");
}

/** Parses COTIK_VAULT_KEYS_JSON without exposing its raw value in errors or logs. */
export function parseCotikVaultKeyring(raw: string): CotikVaultKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("COTIK_VAULT_KEYS_JSON must be a JSON array of keyId/version/hex entries");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("COTIK_VAULT_KEYS_JSON must be a JSON array of keyId/version/hex entries");
  }

  const keyring: Record<string, Record<number, string>> = Object.create(null) as Record<
    string,
    Record<number, string>
  >;
  for (const entry of parsed) {
    if (!isVaultKeyringEntry(entry)) {
      throw new Error("COTIK_VAULT_KEYS_JSON must be a JSON array of keyId/version/hex entries");
    }
    if (entry.keyId.trim().length === 0 || !Number.isInteger(entry.version) || entry.version < 1) {
      throw new Error("COTIK_VAULT_KEYS_JSON contains an invalid key id or version");
    }
    if (!/^[0-9a-fA-F]{64}$/.test(entry.hex.trim())) {
      throw new Error("COTIK_VAULT_KEYS_JSON contains an invalid 256-bit hex key");
    }
    if (keyring[entry.keyId]?.[entry.version] !== undefined) {
      throw new Error("COTIK_VAULT_KEYS_JSON contains a duplicate key id and version");
    }
    (keyring[entry.keyId] ??= Object.create(null) as Record<number, string>)[entry.version] =
      entry.hex.trim();
  }

  return keyring;
}

export function getVaultKeyring(): CotikVaultKeyring | undefined {
  const raw = process.env.COTIK_VAULT_KEYS_JSON;
  return raw === undefined ? undefined : parseCotikVaultKeyring(raw);
}

function resolveVaultWriteSelection(options?: CotikTokenEncryptionOptions): {
  keyId: string;
  version: number;
  key: Buffer;
} {
  const configuredKeyId = process.env.COTIK_VAULT_KEY_ID?.trim();
  const configuredVersionRaw = process.env.COTIK_VAULT_KEY_VERSION?.trim();

  if ((configuredKeyId === undefined) !== (configuredVersionRaw === undefined)) {
    throw new Error("COTIK_VAULT_KEY_ID and COTIK_VAULT_KEY_VERSION must be configured together");
  }

  let configuredVersion: number | undefined;
  if (configuredVersionRaw !== undefined) {
    if (!/^[1-9]\d*$/.test(configuredVersionRaw)) {
      throw new Error("COTIK_VAULT_KEY_VERSION must be a positive integer");
    }
    configuredVersion = Number(configuredVersionRaw);
    if (!Number.isSafeInteger(configuredVersion)) {
      throw new Error("COTIK_VAULT_KEY_VERSION must be a positive integer");
    }
  }

  const keyId = options?.keyId ?? configuredKeyId ?? DEFAULT_KEY_ID;
  const version = options?.version ?? configuredVersion ?? DEFAULT_KEY_VERSION;
  if (keyId.trim().length === 0 || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Cotik vault key id and version are invalid");
  }

  const keyring = getVaultKeyring();
  if (options?.vaultKeyHex !== undefined) {
    return { keyId, version, key: getVaultKey(options.vaultKeyHex) };
  }

  if (keyring !== undefined) {
    const keyHex = keyring[keyId]?.[version];
    if (!keyHex) {
      throw new Error(`No Cotik vault key configured for active key id ${keyId} version ${version}`);
    }
    return { keyId, version, key: getVaultKey(keyHex) };
  }

  if (keyId !== DEFAULT_KEY_ID || version !== DEFAULT_KEY_VERSION) {
    throw new Error(`No Cotik vault key configured for active key id ${keyId} version ${version}`);
  }

  return { keyId, version, key: getVaultKey() };
}

function isVaultKeyringEntry(value: unknown): value is CotikVaultKeyringEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys[0] === "hex" && keys[1] === "keyId" && keys[2] === "version" &&
    typeof (value as { keyId?: unknown }).keyId === "string" &&
    typeof (value as { version?: unknown }).version === "number" &&
    typeof (value as { hex?: unknown }).hex === "string";
}

export function encryptCotikToken(
  token: string,
  options?: CotikTokenEncryptionOptions
): EncryptedSecretPayload {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Cannot encrypt empty or blank token");
  }

  const selection = resolveVaultWriteSelection(options);
  const key = selection.key;
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, nonce);

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return {
    keyId: selection.keyId,
    version: selection.version,
    encryptedToken: encrypted,
    nonce,
    authTag
  };
}

function resolveDecryptionKey(
  secret: { keyId?: string | undefined; version?: number | undefined },
  options?: string | CotikTokenDecryptionOptions | undefined
): Buffer {
  const keyId = secret.keyId ?? DEFAULT_KEY_ID;
  const version = secret.version ?? DEFAULT_KEY_VERSION;

  if (typeof options === "object" && options?.keyring) {
    const keyHex = options.keyring[keyId]?.[version];
    if (!keyHex) {
      throw new Error(`No Cotik vault key configured for key id ${keyId} version ${version}`);
    }
    return getVaultKey(keyHex);
  }

  const explicitKeyHex = typeof options === "string" ? options : options?.vaultKeyHex;
  if (explicitKeyHex !== undefined) {
    if (keyId !== DEFAULT_KEY_ID || version !== DEFAULT_KEY_VERSION) {
      throw new Error(`No Cotik vault key configured for key id ${keyId} version ${version}`);
    }
    return getVaultKey(explicitKeyHex);
  }

  const environmentKeyring = getVaultKeyring();
  if (environmentKeyring) {
    const keyHex = environmentKeyring[keyId]?.[version];
    if (!keyHex) {
      throw new Error(`No Cotik vault key configured for key id ${keyId} version ${version}`);
    }
    return getVaultKey(keyHex);
  }

  // The string form is the legacy v1 contract and is only valid for v1/1.
  if (keyId !== DEFAULT_KEY_ID || version !== DEFAULT_KEY_VERSION) {
    throw new Error(`No Cotik vault key configured for key id ${keyId} version ${version}`);
  }

  return getVaultKey();
}

export function decryptCotikToken(
  secret: {
    encryptedToken: Buffer;
    nonce: Buffer;
    authTag: Buffer;
    keyId?: string | undefined;
    version?: number | undefined;
  },
  options?: string | CotikTokenDecryptionOptions | undefined
): string {
  const key = resolveDecryptionKey(secret, options);
  const decipher = createDecipheriv(ALGORITHM, key, secret.nonce);
  decipher.setAuthTag(secret.authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(secret.encryptedToken),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  } catch (error) {
    // Sanitized error - NEVER leak token or cipher details in message
    throw new Error("Failed to decrypt Cotik token: authentication verification failed");
  }
}

export interface CreateCotikAccountInput {
  id?: string | undefined;
  displayName: string;
  status?: CotikAccountRow["status"] | undefined;
  priority?: number | undefined;
  lastSeenAt?: Date | null | undefined;
  token?: string | undefined;
  keyId?: string | undefined;
  version?: number | undefined;
  vaultKeyHex?: string | undefined;
}

export async function createCotikAccount(
  db: Database,
  input: CreateCotikAccountInput
): Promise<CotikAccountRow> {
  const cleanName = input.displayName.trim();
  if (cleanName.length === 0) {
    throw new Error("displayName cannot be blank");
  }

  return await db.transaction(async (tx) => {
    const [account] = await tx
      .insert(cotikAccounts)
      .values({
        ...(input.id ? { id: input.id } : {}),
        displayName: cleanName,
        status: input.status ?? "ACTIVE",
        priority: input.priority ?? 0,
        lastSeenAt: input.lastSeenAt ?? null
      })
      .returning();

    if (!account) {
      throw new Error("Failed to insert cotik account");
    }

    if (input.token) {
      const encrypted = encryptCotikToken(input.token, {
        vaultKeyHex: input.vaultKeyHex,
        keyId: input.keyId,
        version: input.version
      });

      await tx.insert(cotikAccountSecrets).values({
        accountId: account.id,
        keyId: encrypted.keyId,
        version: encrypted.version,
        encryptedToken: encrypted.encryptedToken,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag
      });
    }

    return account;
  });
}

export async function upsertCotikAccount(
  db: Database,
  input: CreateCotikAccountInput
): Promise<CotikAccountRow> {
  const cleanName = input.displayName.trim();
  if (cleanName.length === 0) {
    throw new Error("displayName cannot be blank");
  }

  return await db.transaction(async (tx) => {
    let account: CotikAccountRow | undefined;

    if (input.id) {
      const [existing] = await tx
        .select()
        .from(cotikAccounts)
        .where(eq(cotikAccounts.id, input.id))
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(cotikAccounts)
          .set({
            displayName: cleanName,
            status: input.status ?? existing.status,
            priority: input.priority ?? existing.priority,
            lastSeenAt: input.lastSeenAt !== undefined ? input.lastSeenAt : existing.lastSeenAt,
            updatedAt: new Date()
          })
          .where(eq(cotikAccounts.id, input.id))
          .returning();
        account = updated;
      }
    }

    if (!account) {
      const [created] = await tx
        .insert(cotikAccounts)
        .values({
          ...(input.id ? { id: input.id } : {}),
          displayName: cleanName,
          status: input.status ?? "ACTIVE",
          priority: input.priority ?? 0,
          lastSeenAt: input.lastSeenAt ?? null
        })
        .returning();
      account = created;
    }

    if (!account) {
      throw new Error("Failed to upsert cotik account");
    }

    if (input.token) {
      const encrypted = encryptCotikToken(input.token, {
        vaultKeyHex: input.vaultKeyHex,
        keyId: input.keyId,
        version: input.version
      });

      await tx
        .insert(cotikAccountSecrets)
        .values({
          accountId: account.id,
          keyId: encrypted.keyId,
          version: encrypted.version,
          encryptedToken: encrypted.encryptedToken,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag
        })
        .onConflictDoUpdate({
          target: cotikAccountSecrets.accountId,
          set: {
            keyId: encrypted.keyId,
            version: encrypted.version,
            encryptedToken: encrypted.encryptedToken,
            nonce: encrypted.nonce,
            authTag: encrypted.authTag
          }
        });
    }

    return account;
  });
}

export async function setCotikAccountToken(
  db: Database,
  accountId: string,
  token: string,
  options?: CotikTokenEncryptionOptions
): Promise<CotikAccountSecretRow> {
  const encrypted = encryptCotikToken(token, {
    vaultKeyHex: options?.vaultKeyHex,
    keyId: options?.keyId,
    version: options?.version
  });

  const [secret] = await db
    .insert(cotikAccountSecrets)
    .values({
      accountId,
      keyId: encrypted.keyId,
      version: encrypted.version,
      encryptedToken: encrypted.encryptedToken,
      nonce: encrypted.nonce,
      authTag: encrypted.authTag
    })
    .onConflictDoUpdate({
      target: cotikAccountSecrets.accountId,
      set: {
        keyId: encrypted.keyId,
        version: encrypted.version,
        encryptedToken: encrypted.encryptedToken,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag
      }
    })
    .returning();

  if (!secret) {
    throw new Error("Failed to set cotik account token");
  }

  return secret;
}

export async function getDecryptedCotikToken(
  db: Database,
  accountId: string,
  options?: string | CotikTokenDecryptionOptions
): Promise<string | null> {
  const [secret] = await db
    .select()
    .from(cotikAccountSecrets)
    .where(eq(cotikAccountSecrets.accountId, accountId))
    .limit(1);

  if (!secret) {
    return null;
  }

  return decryptCotikToken(
    {
      encryptedToken: secret.encryptedToken,
      nonce: secret.nonce,
      authTag: secret.authTag,
      keyId: secret.keyId,
      version: secret.version
    },
    options
  );
}

export async function findCotikAccountById(
  db: Database,
  accountId: string
): Promise<CotikAccountRow | null> {
  const [account] = await db
    .select()
    .from(cotikAccounts)
    .where(eq(cotikAccounts.id, accountId))
    .limit(1);

  return account ?? null;
}

export async function listActiveCotikAccounts(
  db: Database | DatabaseTransaction
): Promise<CotikAccountRow[]> {
  return await db
    .select()
    .from(cotikAccounts)
    .where(eq(cotikAccounts.status, "ACTIVE"))
    .orderBy(desc(cotikAccounts.priority), desc(cotikAccounts.createdAt));
}

export async function listCotikAccounts(db: Database): Promise<CotikAccountRow[]> {
  return await db
    .select()
    .from(cotikAccounts)
    .orderBy(desc(cotikAccounts.priority), desc(cotikAccounts.createdAt));
}

export async function updateCotikAccountStatus(
  db: Database,
  accountId: string,
  status: CotikAccountRow["status"],
  lastSeenAt?: Date | null
): Promise<CotikAccountRow | null> {
  const updates: Partial<typeof cotikAccounts.$inferInsert> = {
    status,
    updatedAt: new Date()
  };

  if (lastSeenAt !== undefined) {
    updates.lastSeenAt = lastSeenAt;
  }

  const [account] = await db
    .update(cotikAccounts)
    .set(updates)
    .where(eq(cotikAccounts.id, accountId))
    .returning();

  return account ?? null;
}

export async function deleteCotikAccount(
  db: Database,
  accountId: string
): Promise<boolean> {
  const result = await db
    .delete(cotikAccounts)
    .where(eq(cotikAccounts.id, accountId))
    .returning({ id: cotikAccounts.id });

  return result.length > 0;
}
