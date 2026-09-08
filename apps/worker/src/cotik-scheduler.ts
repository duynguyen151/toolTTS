export function createCotikScheduler(
  deploymentVersion: string | undefined, cycle: () => Promise<unknown>
): (nowMs: number) => Promise<void> {
  let running = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  return async (nowMs) => {
    if (!deploymentVersion?.trim() || running || nowMs - lastStartedAt < 30_000) return;
    running = true;
    lastStartedAt = nowMs;
    try { await cycle(); } finally { running = false; }
  };
}
