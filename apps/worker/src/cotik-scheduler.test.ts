import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createCotikScheduler } from "./cotik-scheduler.js";

describe("Cotik scheduler integration", () => {
  it("stays disabled without a deployment identifier", async () => {
    const cycle = vi.fn();
    await createCotikScheduler(undefined, cycle)(0);
    expect(cycle).not.toHaveBeenCalled();
  });
  it("runs at startup and every 30 seconds without overlapping", async () => {
    let finish: () => void = () => {};
    const cycle = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const tick = createCotikScheduler("release-1", cycle);
    const running = tick(0);
    await tick(31_000);
    expect(cycle).toHaveBeenCalledOnce();
    finish(); await running;
    await tick(29_999);
    expect(cycle).toHaveBeenCalledOnce();
    const next = tick(30_000);
    finish(); await next;
    expect(cycle).toHaveBeenCalledTimes(2);
  });
  it("releases the guard after an error and does not spin", async () => {
    const cycle = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const tick = createCotikScheduler("release-1", cycle);
    await expect(tick(0)).rejects.toThrow("offline");
    await tick(100);
    expect(cycle).toHaveBeenCalledOnce();
    await tick(30_000);
    expect(cycle).toHaveBeenCalledTimes(2);
  });
  it("the production worker invokes the Cotik scheduler", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).toContain("await tickCotik(Date.now())");
    expect(source).toContain("runCotikWorkerCycle");
  });
});
