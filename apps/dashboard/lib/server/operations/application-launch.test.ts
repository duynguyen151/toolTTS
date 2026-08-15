import { describe, expect, it } from "vitest";

import {
  AdsPowerApplicationError,
  createAdsPowerApplicationLauncher,
} from "./application-launch.js";

describe("AdsPower application launcher", () => {
  it("does not launch when the local API is already ready", async () => {
    let launches = 0;
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => true,
      launch: async () => { launches += 1; },
      executablePath: "C:\\private\\AdsPower.exe",
    });

    await launcher.ensureReady();

    expect(launches).toBe(0);
  });

  it("launches the configured executable and polls until the API is ready", async () => {
    let probes = 0;
    const launched: string[] = [];
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => {
        probes += 1;
        return probes >= 3;
      },
      launch: async (executablePath) => { launched.push(executablePath); },
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 100,
      pollIntervalMs: 0,
    });

    await launcher.ensureReady();

    expect(launched).toEqual(["C:\\private\\AdsPower.exe"]);
    expect(probes).toBe(3);
  });

  it("does not expose executable paths when no installed executable is found", async () => {
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => false,
      launch: async () => undefined,
      environment: {},
      executableCandidates: [],
    });

    await expect(launcher.ensureReady()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AdsPowerApplicationError);
      expect(error).toMatchObject({ failureType: "ADSPOWER_NOT_RUNNING" });
      expect(error).not.toHaveProperty("executablePath");
      return true;
    });
  });

  it("maps a bounded post-launch wait to a launch timeout", async () => {
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => false,
      launch: async () => undefined,
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 0,
      pollIntervalMs: 0,
    });

    await expect(launcher.ensureReady()).rejects.toMatchObject({ failureType: "ADSPOWER_LAUNCH_TIMEOUT" });
  });

  it("maps an asynchronous process spawn error to AdsPower not running", async () => {
    let unrefCalls = 0;
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => false,
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 50,
      pollIntervalMs: 0,
      spawn: () => {
        const process = {
          once(event: string, listener: (error?: Error) => void) {
            if (event === "error") queueMicrotask(() => listener(new Error("private launch detail")));
            return process;
          },
          unref() { unrefCalls += 1; },
        };
        return process;
      },
    });

    await expect(launcher.ensureReady()).rejects.toMatchObject({ failureType: "ADSPOWER_NOT_RUNNING" });
    expect(unrefCalls).toBe(0);
  });

  it("bounds a launch handshake that never settles", async () => {
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => false,
      launch: async () => new Promise<void>(() => undefined),
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 20,
      pollIntervalMs: 0,
    });

    const result = await Promise.race([
      launcher.ensureReady().then(() => null, (error: unknown) => error),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ]);

    expect(result).toMatchObject({ failureType: "ADSPOWER_LAUNCH_TIMEOUT" });
  });

  it("bounds an initial readiness probe that never settles", async () => {
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => new Promise<boolean>(() => undefined),
      launch: async () => undefined,
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 20,
      pollIntervalMs: 0,
    });

    const result = await Promise.race([
      launcher.ensureReady().then(() => null, (error: unknown) => error),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ]);

    expect(result).toMatchObject({ failureType: "ADSPOWER_LAUNCH_TIMEOUT" });
  });

  it("bounds a post-launch readiness probe that never settles", async () => {
    let probes = 0;
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => {
        probes += 1;
        return probes === 1 ? false : new Promise<boolean>(() => undefined);
      },
      launch: async () => undefined,
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 20,
      pollIntervalMs: 0,
    });

    const result = await Promise.race([
      launcher.ensureReady().then(() => null, (error: unknown) => error),
      new Promise<"TEST_TIMEOUT">((resolve) => setTimeout(() => resolve("TEST_TIMEOUT"), 100)),
    ]);

    expect(result).toMatchObject({ failureType: "ADSPOWER_LAUNCH_TIMEOUT" });
  });

  it("coalesces concurrent readiness attempts into one launch", async () => {
    let ready = false;
    let launches = 0;
    const launcher = createAdsPowerApplicationLauncher({
      probeReadiness: async () => ready,
      launch: async () => {
        launches += 1;
        ready = true;
      },
      executablePath: "C:\\private\\AdsPower.exe",
      readyTimeoutMs: 100,
      pollIntervalMs: 0,
    });

    await Promise.all([launcher.ensureReady(), launcher.ensureReady()]);

    expect(launches).toBe(1);
  });
});
