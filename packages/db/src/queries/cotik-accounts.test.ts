import { describe, expect, it } from "vitest";
import {
  createCotikAccount,
  decryptCotikToken,
  encryptCotikToken,
  getVaultKey,
  getVaultKeyring,
  setCotikAccountToken
} from "./cotik-accounts.js";

const TEST_VAULT_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createAccountRow() {
  return {
    id: "account-1",
    displayName: "Account 1",
    status: "ACTIVE",
    priority: 0,
    lastSeenAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createAccountDb(options?: { failSecretInsert?: boolean }) {
  const account = createAccountRow();
  const insertedSecrets: Array<Record<string, unknown>> = [];
  let committed = false;
  let accountInserted = false;

  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if (!accountInserted) {
          accountInserted = true;
          return { returning: async () => [account] };
        }

        insertedSecrets.push(values);
        if (options?.failSecretInsert) {
          throw new Error("secret insert failed");
        }
        return Promise.resolve();
      }
    })
  };

  return {
    db: {
      transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => {
        const result = await callback(tx);
        committed = true;
        return result;
      }
    },
    account,
    insertedSecrets,
    get committed() {
      return committed;
    }
  };
}

describe("Cotik Account Secret Vault (AES-256-GCM)", () => {
  it("encrypts and decrypts token round-trip cleanly", () => {
    const originalToken = "cotik_test_token_secret_123456789";
    const encrypted = encryptCotikToken(originalToken, {
      vaultKeyHex: TEST_VAULT_KEY,
      keyId: "v1"
    });

    expect(encrypted.keyId).toBe("v1");
    expect(encrypted.version).toBe(1);
    expect(Buffer.isBuffer(encrypted.encryptedToken)).toBe(true);
    expect(Buffer.isBuffer(encrypted.nonce)).toBe(true);
    expect(Buffer.isBuffer(encrypted.authTag)).toBe(true);
    expect(encrypted.nonce.length).toBe(12);
    expect(encrypted.authTag.length).toBe(16);

    // CRITICAL: Token must NOT be present in plaintext in any encrypted field
    expect(encrypted.encryptedToken.toString("utf8")).not.toContain(originalToken);

    const decrypted = decryptCotikToken(encrypted, TEST_VAULT_KEY);
    expect(decrypted).toBe(originalToken);
  });

  it("resolves a versioned token through the explicit keyring", () => {
    const encrypted = encryptCotikToken("keyring-token", {
      vaultKeyHex: TEST_VAULT_KEY,
      keyId: "primary",
      version: 2
    });

    expect(
      decryptCotikToken(encrypted, {
        keyring: { primary: { 2: TEST_VAULT_KEY } }
      })
    ).toBe("keyring-token");
  });

  it("resolves rotated keys from the strict server keyring environment", () => {
    const previous = process.env.COTIK_VAULT_KEYS_JSON;
    process.env.COTIK_VAULT_KEYS_JSON = JSON.stringify([
      { keyId: "rotated", version: 2, hex: TEST_VAULT_KEY }
    ]);

    try {
      const encrypted = encryptCotikToken("environment-keyring-token", {
        vaultKeyHex: TEST_VAULT_KEY,
        keyId: "rotated",
        version: 2
      });

      expect(decryptCotikToken(encrypted)).toBe("environment-keyring-token");
      expect(getVaultKeyring()).toEqual({ rotated: { 2: TEST_VAULT_KEY } });
    } finally {
      if (previous === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous;
    }
  });

  it("writes with the active rotated key selected by server environment", () => {
    const previous = {
      key: process.env.COTIK_VAULT_KEY,
      keys: process.env.COTIK_VAULT_KEYS_JSON,
      keyId: process.env.COTIK_VAULT_KEY_ID,
      version: process.env.COTIK_VAULT_KEY_VERSION
    };
    delete process.env.COTIK_VAULT_KEY;
    process.env.COTIK_VAULT_KEYS_JSON = JSON.stringify([
      { keyId: "rotated", version: 2, hex: TEST_VAULT_KEY }
    ]);
    process.env.COTIK_VAULT_KEY_ID = "rotated";
    process.env.COTIK_VAULT_KEY_VERSION = "2";

    try {
      const encrypted = encryptCotikToken("rotated-write-token");

      expect(encrypted).toMatchObject({ keyId: "rotated", version: 2 });
      expect(decryptCotikToken(encrypted)).toBe("rotated-write-token");
    } finally {
      if (previous.key === undefined) delete process.env.COTIK_VAULT_KEY;
      else process.env.COTIK_VAULT_KEY = previous.key;
      if (previous.keys === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous.keys;
      if (previous.keyId === undefined) delete process.env.COTIK_VAULT_KEY_ID;
      else process.env.COTIK_VAULT_KEY_ID = previous.keyId;
      if (previous.version === undefined) delete process.env.COTIK_VAULT_KEY_VERSION;
      else process.env.COTIK_VAULT_KEY_VERSION = previous.version;
    }
  });

  it("keeps legacy v1/1 writes on COTIK_VAULT_KEY without active selection", () => {
    const previous = {
      key: process.env.COTIK_VAULT_KEY,
      keys: process.env.COTIK_VAULT_KEYS_JSON,
      keyId: process.env.COTIK_VAULT_KEY_ID,
      version: process.env.COTIK_VAULT_KEY_VERSION
    };
    process.env.COTIK_VAULT_KEY = TEST_VAULT_KEY;
    delete process.env.COTIK_VAULT_KEYS_JSON;
    delete process.env.COTIK_VAULT_KEY_ID;
    delete process.env.COTIK_VAULT_KEY_VERSION;

    try {
      expect(encryptCotikToken("legacy-write-token")).toMatchObject({ keyId: "v1", version: 1 });
    } finally {
      if (previous.key === undefined) delete process.env.COTIK_VAULT_KEY;
      else process.env.COTIK_VAULT_KEY = previous.key;
      if (previous.keys === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous.keys;
      if (previous.keyId === undefined) delete process.env.COTIK_VAULT_KEY_ID;
      else process.env.COTIK_VAULT_KEY_ID = previous.keyId;
      if (previous.version === undefined) delete process.env.COTIK_VAULT_KEY_VERSION;
      else process.env.COTIK_VAULT_KEY_VERSION = previous.version;
    }
  });

  it("uses keyring v1/1 for unselected writes and rejects a missing default key", () => {
    const previous = {
      key: process.env.COTIK_VAULT_KEY,
      keys: process.env.COTIK_VAULT_KEYS_JSON,
      keyId: process.env.COTIK_VAULT_KEY_ID,
      version: process.env.COTIK_VAULT_KEY_VERSION
    };
    const legacyKey = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.COTIK_VAULT_KEY = legacyKey;
    process.env.COTIK_VAULT_KEYS_JSON = JSON.stringify([
      { keyId: "v1", version: 1, hex: TEST_VAULT_KEY }
    ]);
    delete process.env.COTIK_VAULT_KEY_ID;
    delete process.env.COTIK_VAULT_KEY_VERSION;

    try {
      const encrypted = encryptCotikToken("keyring-default-token");

      expect(encrypted).toMatchObject({ keyId: "v1", version: 1 });
      expect(decryptCotikToken(encrypted)).toBe("keyring-default-token");

      process.env.COTIK_VAULT_KEYS_JSON = JSON.stringify([
        { keyId: "rotated", version: 2, hex: TEST_VAULT_KEY }
      ]);

      expect(() => encryptCotikToken("must-fail")).toThrow(
        "No Cotik vault key configured for active key id v1 version 1"
      );
    } finally {
      if (previous.key === undefined) delete process.env.COTIK_VAULT_KEY;
      else process.env.COTIK_VAULT_KEY = previous.key;
      if (previous.keys === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous.keys;
      if (previous.keyId === undefined) delete process.env.COTIK_VAULT_KEY_ID;
      else process.env.COTIK_VAULT_KEY_ID = previous.keyId;
      if (previous.version === undefined) delete process.env.COTIK_VAULT_KEY_VERSION;
      else process.env.COTIK_VAULT_KEY_VERSION = previous.version;
    }
  });

  it("rejects incomplete active key configuration instead of falling back", () => {
    const previous = {
      key: process.env.COTIK_VAULT_KEY,
      keys: process.env.COTIK_VAULT_KEYS_JSON,
      keyId: process.env.COTIK_VAULT_KEY_ID,
      version: process.env.COTIK_VAULT_KEY_VERSION
    };
    process.env.COTIK_VAULT_KEY = TEST_VAULT_KEY;
    delete process.env.COTIK_VAULT_KEYS_JSON;
    process.env.COTIK_VAULT_KEY_ID = "rotated";
    delete process.env.COTIK_VAULT_KEY_VERSION;

    try {
      expect(() => encryptCotikToken("must-fail")).toThrow(
        "COTIK_VAULT_KEY_ID and COTIK_VAULT_KEY_VERSION must be configured together"
      );
    } finally {
      if (previous.key === undefined) delete process.env.COTIK_VAULT_KEY;
      else process.env.COTIK_VAULT_KEY = previous.key;
      if (previous.keys === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous.keys;
      if (previous.keyId === undefined) delete process.env.COTIK_VAULT_KEY_ID;
      else process.env.COTIK_VAULT_KEY_ID = previous.keyId;
      if (previous.version === undefined) delete process.env.COTIK_VAULT_KEY_VERSION;
      else process.env.COTIK_VAULT_KEY_VERSION = previous.version;
    }
  });

  it("persists explicit key version metadata through create and token replacement", async () => {
    const createDb = createAccountDb();
    await createCotikAccount(createDb.db as never, {
      displayName: "Account 1",
      token: "create-token",
      vaultKeyHex: TEST_VAULT_KEY,
      keyId: "explicit",
      version: 7
    });
    expect(createDb.insertedSecrets[0]).toMatchObject({ keyId: "explicit", version: 7 });

    const setDb = {
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: () => ({
            returning: async () => [{
              ...values,
              id: "secret-1",
              createdAt: new Date("2026-01-01T00:00:00.000Z")
            }]
          })
        })
      })
    };
    const secret = await setCotikAccountToken(setDb as never, "account-1", "set-token", {
      vaultKeyHex: TEST_VAULT_KEY,
      keyId: "explicit",
      version: 8
    });
    expect(secret).toMatchObject({ keyId: "explicit", version: 8 });
  });

  it("does not commit onboarding when active key configuration is invalid", async () => {
    const previous = {
      key: process.env.COTIK_VAULT_KEY,
      keys: process.env.COTIK_VAULT_KEYS_JSON,
      keyId: process.env.COTIK_VAULT_KEY_ID,
      version: process.env.COTIK_VAULT_KEY_VERSION
    };
    delete process.env.COTIK_VAULT_KEY;
    process.env.COTIK_VAULT_KEYS_JSON = JSON.stringify([
      { keyId: "other", version: 1, hex: TEST_VAULT_KEY }
    ]);
    process.env.COTIK_VAULT_KEY_ID = "missing";
    process.env.COTIK_VAULT_KEY_VERSION = "2";
    const database = createAccountDb();

    try {
      await expect(
        createCotikAccount(database.db as never, {
          displayName: "Account 1",
          token: "must-not-commit"
        })
      ).rejects.toThrow("No Cotik vault key configured for active key id missing version 2");
      expect(database.committed).toBe(false);
      expect(database.insertedSecrets).toHaveLength(0);
    } finally {
      if (previous.key === undefined) delete process.env.COTIK_VAULT_KEY;
      else process.env.COTIK_VAULT_KEY = previous.key;
      if (previous.keys === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous.keys;
      if (previous.keyId === undefined) delete process.env.COTIK_VAULT_KEY_ID;
      else process.env.COTIK_VAULT_KEY_ID = previous.keyId;
      if (previous.version === undefined) delete process.env.COTIK_VAULT_KEY_VERSION;
      else process.env.COTIK_VAULT_KEY_VERSION = previous.version;
    }
  });

  it("keeps secret persistence failures inside the onboarding transaction", async () => {
    const database = createAccountDb({ failSecretInsert: true });

    await expect(
      createCotikAccount(database.db as never, {
        displayName: "Account 1",
        token: "secret-token",
        vaultKeyHex: TEST_VAULT_KEY
      })
    ).rejects.toThrow("secret insert failed");
    expect(database.committed).toBe(false);
  });

  it("rejects malformed keyring configuration without echoing the environment value", () => {
    const previous = process.env.COTIK_VAULT_KEYS_JSON;
    const malformed = `not-json-${TEST_VAULT_KEY}`;
    process.env.COTIK_VAULT_KEYS_JSON = malformed;

    try {
      expect(() => getVaultKeyring()).toThrow(
        "COTIK_VAULT_KEYS_JSON must be a JSON array of keyId/version/hex entries"
      );
      expect(() => getVaultKeyring()).not.toThrow(malformed);
    } finally {
      if (previous === undefined) delete process.env.COTIK_VAULT_KEYS_JSON;
      else process.env.COTIK_VAULT_KEYS_JSON = previous;
    }
  });

  it("fails closed for an unknown key id or version instead of using the current key", () => {
    const encrypted = encryptCotikToken("keyring-token", {
      vaultKeyHex: TEST_VAULT_KEY,
      keyId: "retired",
      version: 7
    });

    expect(() => decryptCotikToken(encrypted, TEST_VAULT_KEY)).toThrow(
      "No Cotik vault key configured for key id retired version 7"
    );
    expect(() =>
      decryptCotikToken(encrypted, {
        keyring: { primary: { 1: TEST_VAULT_KEY } }
      })
    ).toThrow("No Cotik vault key configured for key id retired version 7");
  });

  it("fails closed on blank or invalid token", () => {
    expect(() => encryptCotikToken("", { vaultKeyHex: TEST_VAULT_KEY })).toThrow(
      "Cannot encrypt empty or blank token"
    );
    expect(() => encryptCotikToken("   ", { vaultKeyHex: TEST_VAULT_KEY })).toThrow(
      "Cannot encrypt empty or blank token"
    );
  });

  it("fails closed on invalid vault key format without leaking keys", () => {
    expect(() => getVaultKey("short_key")).toThrow(
      "COTIK_VAULT_KEY must be a 64-character hex string (256 bits)"
    );
    expect(() => getVaultKey("not_hex_0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab")).toThrow(
      "COTIK_VAULT_KEY must be a 64-character hex string (256 bits)"
    );
  });

  it("detects tampered ciphertext or auth tag and throws sanitized error", () => {
    const originalToken = "sensitive_super_secret_token";
    const encrypted = encryptCotikToken(originalToken, {
      vaultKeyHex: TEST_VAULT_KEY
    });

    // Tamper with ciphertext
    const tamperedCiphertext = Buffer.from(encrypted.encryptedToken);
    tamperedCiphertext[0] = (tamperedCiphertext[0]! ^ 0xff);

    expect(() =>
      decryptCotikToken(
        {
          ...encrypted,
          encryptedToken: tamperedCiphertext
        },
        TEST_VAULT_KEY
      )
    ).toThrow("Failed to decrypt Cotik token: authentication verification failed");

    // Tamper with auth tag
    const tamperedTag = Buffer.from(encrypted.authTag);
    tamperedTag[0] = (tamperedTag[0]! ^ 0xff);

    expect(() =>
      decryptCotikToken(
        {
          ...encrypted,
          authTag: tamperedTag
        },
        TEST_VAULT_KEY
      )
    ).toThrow("Failed to decrypt Cotik token: authentication verification failed");
  });

  it("guarantees token is NEVER leaked in error messages", () => {
    const sensitiveToken = "SHOULD_NEVER_BE_IN_ANY_ERROR_MESSAGE";
    try {
      const encrypted = encryptCotikToken(sensitiveToken, {
        vaultKeyHex: TEST_VAULT_KEY
      });
      // Wrong key decrypt
      const wrongKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      decryptCotikToken(encrypted, wrongKey);
      expect.unreachable("should have thrown");
    } catch (err: any) {
      expect(err.message).not.toContain(sensitiveToken);
      expect(err.message).toContain("authentication verification failed");
    }
  });
});
