import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function runEntrypoint(input: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    if (!existsSync(tsxCli)) {
      reject(new Error(`tsx CLI not found at ${tsxCli}`));
      return;
    }

    const child = spawn(process.execPath, [tsxCli, "scripts/tracking/auto-tracking.mts"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", code => resolveResult({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe("auto-tracking entrypoint", () => {
  it("loads the current v1 capability before validating requests", async () => {
    const result = await runEntrypoint(JSON.stringify({ action: "invalid" }));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"schemaVersion":"auto-tracking-capability.v1"');
    expect(result.stdout).toContain("action must be status, execute, or stop");
  });
});
