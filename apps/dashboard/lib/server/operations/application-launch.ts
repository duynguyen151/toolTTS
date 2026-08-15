import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface AdsPowerSpawnedProcess {
  once(event: "error" | "spawn", listener: (error?: Error) => void): AdsPowerSpawnedProcess;
  unref(): void;
}

export type AdsPowerApplicationFailureType = "ADSPOWER_NOT_RUNNING" | "ADSPOWER_LAUNCH_TIMEOUT";

export class AdsPowerApplicationError extends Error {
  constructor(readonly failureType: AdsPowerApplicationFailureType, message: string) {
    super(message);
    this.name = "AdsPowerApplicationError";
  }
}

export interface AdsPowerApplicationLauncherOptions {
  readonly probeReadiness: () => Promise<boolean>;
  readonly launch?: (executablePath: string) => void | Promise<void>;
  readonly spawn?: (command: string, args: string[], options: SpawnOptions) => AdsPowerSpawnedProcess;
  readonly executablePath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly executableCandidates?: readonly string[];
  readonly readyTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface AdsPowerApplicationLauncher {
  ensureReady(): Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

function launchTimeout(): AdsPowerApplicationError {
  return new AdsPowerApplicationError(
    "ADSPOWER_LAUNCH_TIMEOUT",
    "AdsPower did not become ready before the launch deadline.",
  );
}

async function withinDeadline<T>(operation: () => Promise<T> | T, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(launchTimeout()), Math.max(deadline - Date.now(), 0));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function defaultAdsPowerExecutableCandidates(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const candidates = [
    environment.LOCALAPPDATA === undefined ? undefined : join(environment.LOCALAPPDATA, "AdsPower Global", "AdsPower Global.exe"),
    environment.APPDATA === undefined ? undefined : join(environment.APPDATA, "AdsPower Global", "AdsPower Global.exe"),
    environment.ProgramW6432 === undefined ? undefined : join(environment.ProgramW6432, "AdsPower Global", "AdsPower Global.exe"),
    environment.PROGRAMFILES === undefined ? undefined : join(environment.PROGRAMFILES, "AdsPower Global", "AdsPower Global.exe"),
    environment["PROGRAMFILES(X86)"] === undefined ? undefined : join(environment["PROGRAMFILES(X86)"], "AdsPower Global", "AdsPower Global.exe"),
  ];
  return candidates.filter((candidate): candidate is string => candidate !== undefined);
}

function discoverExecutable(options: AdsPowerApplicationLauncherOptions): string | undefined {
  if (options.executablePath !== undefined && options.executablePath.trim().length > 0) {
    return options.executablePath;
  }
  const candidates = options.executableCandidates ?? defaultAdsPowerExecutableCandidates(options.environment);
  return candidates.find((candidate) => existsSync(candidate));
}

function launchInstalledExecutable(
  executablePath: string,
  spawnProcess: (command: string, args: string[], options: SpawnOptions) => AdsPowerSpawnedProcess = spawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: AdsPowerSpawnedProcess;
    try {
      child = spawnProcess(executablePath, [], { detached: true, stdio: "ignore", windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function createAdsPowerApplicationLauncher(
  options: AdsPowerApplicationLauncherOptions,
): AdsPowerApplicationLauncher {
  const launch = options.launch ?? ((executablePath: string) => launchInstalledExecutable(executablePath, options.spawn));
  const readyTimeoutMs = Math.max(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS, 0);
  const pollIntervalMs = Math.max(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 0);
  const probe = async (deadline: number): Promise<boolean> => {
    try {
      return await withinDeadline(options.probeReadiness, deadline);
    } catch {
      return false;
    }
  };

  let inFlight: Promise<void> | undefined;

  const ensureReadyOnce = async (): Promise<void> => {
    const deadline = Date.now() + readyTimeoutMs;
    if (await probe(deadline)) return;
    if (Date.now() >= deadline) throw launchTimeout();

    const executablePath = discoverExecutable(options);
    if (executablePath === undefined) {
      throw new AdsPowerApplicationError(
        "ADSPOWER_NOT_RUNNING",
        "AdsPower is not running and its installed application could not be found.",
      );
    }

    try {
      await withinDeadline(() => launch(executablePath), deadline);
    } catch (cause) {
      if (cause instanceof AdsPowerApplicationError) throw cause;
      throw new AdsPowerApplicationError(
        "ADSPOWER_NOT_RUNNING",
        "AdsPower could not be launched.",
      );
    }

    while (Date.now() < deadline) {
      const remainingMs = Math.max(deadline - Date.now(), 0);
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)));
      if (await probe(deadline)) return;
    }

    throw launchTimeout();
  };

  return {
    async ensureReady() {
      if (inFlight !== undefined) return inFlight;
      const attempt = ensureReadyOnce();
      inFlight = attempt;
      void attempt.then(
        () => { if (inFlight === attempt) inFlight = undefined; },
        () => { if (inFlight === attempt) inFlight = undefined; },
      );
      return attempt;
    },
  };
}
