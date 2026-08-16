export interface ProfileQueueResult {
  readonly profileNo: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly error: string | null;
}

/** Runs live profile work in order so one browser session is active at a time. */
export async function runSequentialProfileQueue(
  profileNos: readonly string[],
  runProfile: (profileNo: string) => Promise<void>,
): Promise<ProfileQueueResult[]> {
  const results: ProfileQueueResult[] = [];
  for (const profileNo of profileNos) {
    try {
      await runProfile(profileNo);
      results.push({ profileNo, status: "SUCCEEDED", error: null });
    } catch (error) {
      results.push({
        profileNo,
        status: "FAILED",
        error: error instanceof Error ? error.message : "Unknown profile synchronization failure",
      });
    }
  }
  return results;
}
