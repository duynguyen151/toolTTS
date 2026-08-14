import path from "node:path";

import { describe, expect, test } from "vitest";

import { getWorkspaceEnvPath } from "./config.js";

describe("CLI environment loading", () => {
  test("resolves the repository .env instead of the package working directory", () => {
    const moduleUrl = new URL("file:///C:/repo/apps/cli/src/config.ts").href;

    expect(path.normalize(getWorkspaceEnvPath(moduleUrl))).toBe(
      path.normalize("C:/repo/.env"),
    );
  });
});
