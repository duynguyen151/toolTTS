export const GMAIL_SYNC_REPORT_VERSION = "v1.04" as const;

export interface CotikProviderForReport {
  readonly providerId: string;
  readonly carrierName: string;
  readonly region: "US" | "UK";
  readonly isActive?: boolean | undefined;
}

export interface GmailSheetReportCandidate {
  readonly rowNumber: number;
  readonly orderNumber: string;
  readonly trackingNumber: string;
  readonly provider: string;
  readonly messageId: string | null;
}

export interface GmailSheetReportBatch {
  readonly trackingWritten: readonly GmailSheetReportCandidate[];
  readonly providerOnlyWritten: readonly GmailSheetReportCandidate[];
  readonly alreadyPresent: readonly GmailSheetReportCandidate[];
  readonly skipped?: readonly GmailSheetSkippedCandidate[] | undefined;
}

export interface GmailSheetSkippedCandidate extends GmailSheetReportCandidate {
  readonly reason: "TRACKING_CONFLICT";
}

export interface GmailSheetUpdateCandidate {
  readonly rowNumber: number;
  readonly orderNumber: string;
  readonly trackingNumber: string;
  readonly deliveryCompany: string;
  readonly oldTracking: string;
  readonly oldProvider: string;
  readonly messageId: string | null;
}

export interface GmailSheetWriteConfirmation {
  readonly rowNumber: number;
  readonly column: "Z" | "AC";
}

export interface GmailSheetWriteResponse {
  readonly updatedRange?: unknown;
  readonly updatedCells?: unknown;
}

export interface GmailSheetExpectedWrite extends GmailSheetWriteConfirmation {
  readonly value: string;
}

export interface GmailSheetReadbackRange {
  readonly range?: unknown;
  readonly values?: unknown;
}

export interface GmailSheetReportEntry extends GmailSheetReportCandidate {
  readonly providerId: string | null;
  readonly status: "READY_TO_ADD_TRACK" | "PROVIDER_MISSING" | "PROVIDER_UNSUPPORTED";
  readonly statusLabel: "Sẵn sàng add track" | "Thiếu/không hỗ trợ provider";
  readonly observedAt: string;
}

export interface GmailSyncReport {
  readonly interfaceVersion: typeof GMAIL_SYNC_REPORT_VERSION;
  readonly mode: "FULL" | "INCREMENTAL";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string | undefined;
  readonly providerCatalog?: readonly CotikProviderForReport[] | undefined;
  readonly trackingWritten: readonly GmailSheetReportEntry[];
  readonly providerOnlyWritten: readonly GmailSheetReportEntry[];
  readonly alreadyPresent: readonly GmailSheetReportEntry[];
  readonly skipped: readonly GmailSheetSkippedEntry[];
}

export interface GmailSheetSkippedEntry extends GmailSheetSkippedCandidate {
  readonly observedAt: string;
}

function normalizeProvider(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function enrichCandidate(
  candidate: GmailSheetReportCandidate,
  providers: readonly CotikProviderForReport[],
  observedAt: string
): GmailSheetReportEntry {
  const requested = normalizeProvider(candidate.provider);
  if (!requested) {
    return { ...candidate, providerId: null, status: "PROVIDER_MISSING", statusLabel: "Thiếu/không hỗ trợ provider", observedAt };
  }

  const matches = providers.filter((provider) =>
    provider.region === "US" && provider.isActive !== false &&
    (normalizeProvider(provider.carrierName) === requested || normalizeProvider(provider.providerId) === requested)
  );
  return matches.length === 1
    ? { ...candidate, providerId: matches[0]!.providerId, status: "READY_TO_ADD_TRACK", statusLabel: "Sẵn sàng add track", observedAt }
    : { ...candidate, providerId: null, status: "PROVIDER_UNSUPPORTED", statusLabel: "Thiếu/không hỗ trợ provider", observedAt };
}

function mergeEntries(
  existing: readonly GmailSheetReportEntry[],
  incoming: readonly GmailSheetReportCandidate[],
  providers: readonly CotikProviderForReport[],
  observedAt: string
): GmailSheetReportEntry[] {
  const entries = new Map(existing.map((entry) => [`${entry.rowNumber}:${entry.trackingNumber}`, entry]));
  for (const candidate of incoming) {
    entries.set(`${candidate.rowNumber}:${candidate.trackingNumber}`, enrichCandidate(candidate, providers, observedAt));
  }
  return [...entries.values()].sort((left, right) => left.rowNumber - right.rowNumber);
}

export function createGmailSyncReport(
  mode: "FULL" | "INCREMENTAL",
  startedAt: string,
  providerCatalog: readonly CotikProviderForReport[] = []
): GmailSyncReport {
  return {
    interfaceVersion: GMAIL_SYNC_REPORT_VERSION,
    mode,
    startedAt,
    updatedAt: startedAt,
    providerCatalog,
    trackingWritten: [],
    providerOnlyWritten: [],
    alreadyPresent: [],
    skipped: []
  };
}

export function beginGmailSyncReport(
  existing: GmailSyncReport | null,
  mode: "FULL" | "INCREMENTAL",
  startedAt: string
): GmailSyncReport {
  if (!existing || existing.interfaceVersion !== GMAIL_SYNC_REPORT_VERSION) {
    return createGmailSyncReport(mode, startedAt);
  }
  if (!existing.completedAt && existing.mode === mode) return existing;

  const { completedAt: _completedAt, ...history } = existing;
  return { ...history, mode, startedAt, updatedAt: startedAt };
}

export function buildGmailSheetReportBatch(
  updates: readonly GmailSheetUpdateCandidate[],
  confirmations: readonly GmailSheetWriteConfirmation[],
  alreadyPresent: readonly GmailSheetReportCandidate[],
  skipped: readonly GmailSheetSkippedCandidate[] = []
): GmailSheetReportBatch {
  const confirmed = new Set(confirmations.map((item) => `${item.rowNumber}:${item.column}`));
  const toCandidate = (update: GmailSheetUpdateCandidate): GmailSheetReportCandidate => ({
    rowNumber: update.rowNumber,
    orderNumber: update.orderNumber,
    trackingNumber: update.trackingNumber || update.oldTracking,
    provider: update.oldProvider || update.deliveryCompany,
    messageId: update.messageId
  });
  return {
    trackingWritten: updates.filter((update) => confirmed.has(`${update.rowNumber}:Z`)).map(toCandidate),
    providerOnlyWritten: updates.filter((update) =>
      confirmed.has(`${update.rowNumber}:AC`) && !confirmed.has(`${update.rowNumber}:Z`)
    ).map(toCandidate),
    alreadyPresent,
    skipped
  };
}

export function confirmGmailSheetWrites(
  writes: readonly GmailSheetWriteConfirmation[],
  responses: readonly GmailSheetWriteResponse[] | undefined
): GmailSheetWriteConfirmation[] {
  if (responses?.length !== writes.length) {
    throw new Error("Google Sheets batchUpdate returned incomplete write confirmation");
  }

  return writes.map((write, index) => {
    const response = responses[index];
    const match = typeof response?.updatedRange === "string"
      ? response.updatedRange.match(/!([A-Z]+)(\d+)$/i)
      : null;
    if (!match || match[1]?.toUpperCase() !== write.column || Number(match[2]) !== write.rowNumber || response?.updatedCells !== 1) {
      throw new Error(`Google Sheets batchUpdate did not confirm ${write.column}${write.rowNumber}`);
    }
    return write;
  });
}

export function confirmGmailSheetReadback(
  writes: readonly GmailSheetExpectedWrite[],
  valueRanges: readonly GmailSheetReadbackRange[] | undefined
): GmailSheetWriteConfirmation[] {
  if (valueRanges?.length !== writes.length) {
    throw new Error("Google Sheets batchGet returned incomplete readback");
  }

  return writes.map((write, index) => {
    const valueRange = valueRanges[index];
    const match = typeof valueRange?.range === "string"
      ? valueRange.range.match(/!([A-Z]+)(\d+)$/i)
      : null;
    const values = Array.isArray(valueRange?.values) ? valueRange.values : [];
    const firstRow = Array.isArray(values[0]) ? values[0] : [];
    const actual = String(firstRow[0] ?? "");
    if (!match || match[1]?.toUpperCase() !== write.column || Number(match[2]) !== write.rowNumber || actual !== write.value) {
      throw new Error(`Google Sheets readback mismatch at ${write.column}${write.rowNumber}`);
    }
    return { rowNumber: write.rowNumber, column: write.column };
  });
}

export function mergeGmailSyncReportBatch(
  report: GmailSyncReport,
  batch: GmailSheetReportBatch,
  providers: readonly CotikProviderForReport[],
  observedAt: string
): GmailSyncReport {
  const skipped = new Map(report.skipped.map((entry) => [`${entry.rowNumber}:${entry.trackingNumber}:${entry.reason}`, entry]));
  for (const candidate of batch.skipped ?? []) {
    skipped.set(`${candidate.rowNumber}:${candidate.trackingNumber}:${candidate.reason}`, { ...candidate, observedAt });
  }
  return {
    ...report,
    updatedAt: observedAt,
    trackingWritten: mergeEntries(report.trackingWritten, batch.trackingWritten, providers, observedAt),
    providerOnlyWritten: mergeEntries(report.providerOnlyWritten, batch.providerOnlyWritten, providers, observedAt),
    alreadyPresent: mergeEntries(report.alreadyPresent, batch.alreadyPresent, providers, observedAt),
    skipped: [...skipped.values()].sort((left, right) => left.rowNumber - right.rowNumber)
  };
}

export function completeGmailSyncReport(report: GmailSyncReport, completedAt: string): GmailSyncReport {
  return { ...report, updatedAt: completedAt, completedAt };
}
