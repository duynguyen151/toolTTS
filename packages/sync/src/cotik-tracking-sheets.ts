export interface CotikTrackingSheetRequest {
  readonly spreadsheetId: string;
  readonly tabTitle: string;
  readonly range: string;
}

export interface CotikTrackingSheetRow {
  readonly orderId: string;
  readonly tracking: string;
}

export interface CotikTrackingSheetBatchRequest extends CotikTrackingSheetRequest {
  readonly targetDate?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly dateColumn?: string | undefined;
  readonly cotikOrderIdColumn?: string | undefined;
  readonly dateFormat?: "MDY" | "DMY" | undefined;
}

export interface CotikTrackingSheetBatchRow {
  readonly rowNumber: number;
  readonly account: string;
  readonly orderId: string;
  readonly sheinOrderId: string;
  readonly tracking: string;
  readonly trackingColumn: "Z";
  readonly providerNote: string;
  readonly result: string;
}

export type CotikTrackingSheetGroupRow = Omit<CotikTrackingSheetBatchRow, "trackingColumn">;

export type CotikTrackingSheetGroupReason =
  | "MISSING_ACCOUNT"
  | "MISSING_SHEIN_ORDER_ID"
  | "MISSING_TRACKING"
  | "MISSING_PROVIDER_NOTE"
  | "MULTIPLE_PROVIDER_NOTES"
  | "SPLIT_ORDER_REVIEW_REQUIRED";

export interface CotikTrackingSheetOrderGroup {
  readonly account: string;
  readonly orderId: string;
  readonly rows: CotikTrackingSheetBatchRow[];
  readonly status: "READY" | "PAUSED";
  readonly tracking?: string;
  readonly providerNote?: string;
  readonly reason?: CotikTrackingSheetGroupReason;
}

export type CotikTrackingSheetSkipReason =
  | "DATE_NOT_SELECTED"
  | "MISSING_ORDER_ID"
  | "MISSING_PROVIDER_NOTE"
  | "MISSING_TRACKING"
  | CotikTrackingSheetGroupReason;

export interface CotikTrackingSheetSkippedRow {
  readonly rowNumber: number;
  readonly reason: CotikTrackingSheetSkipReason;
}

export interface CotikTrackingSheetBatchResult {
  readonly headerRow: number;
  readonly rows: CotikTrackingSheetBatchRow[];
  readonly groupRows?: CotikTrackingSheetGroupRow[] | undefined;
  readonly skippedRows: CotikTrackingSheetSkippedRow[];
}

function uniqueNonBlank(values: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (!unique.has(key)) unique.set(key, trimmed);
  }
  return [...unique.values()];
}

export function groupCotikTrackingRows(
  rows: readonly CotikTrackingSheetBatchRow[],
  contextRows: readonly CotikTrackingSheetGroupRow[] = rows
): CotikTrackingSheetOrderGroup[] {
  const grouped = new Map<string, CotikTrackingSheetBatchRow[]>();
  for (const row of rows) {
    const key = `${row.account}\u0000${row.orderId}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const groupedContext = new Map<string, CotikTrackingSheetGroupRow[]>();
  for (const row of contextRows) {
    const key = `${row.account}\u0000${row.orderId}`;
    const list = groupedContext.get(key) ?? [];
    list.push(row);
    groupedContext.set(key, list);
  }

  return [...grouped.entries()].map(([key, groupRows]) => {
    const separatorIndex = key.indexOf("\u0000");
    const account = separatorIndex < 0 ? key : key.slice(0, separatorIndex);
    const orderId = separatorIndex < 0 ? "" : key.slice(separatorIndex + 1);
    const context = groupedContext.get(key) ?? groupRows;
    if (!account) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "MISSING_ACCOUNT" };
    }
    const sheinOrderIds = uniqueNonBlank(context.map((row) => row.sheinOrderId));
    if (context.some((row) => row.sheinOrderId.trim().length === 0)) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "MISSING_SHEIN_ORDER_ID" };
    }
    if (sheinOrderIds.length > 1) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "SPLIT_ORDER_REVIEW_REQUIRED" };
    }

    const trackingValues = uniqueNonBlank(context.map((row) => row.tracking));
    if (trackingValues.length === 0) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "MISSING_TRACKING" };
    }
    if (trackingValues.length > 1) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "SPLIT_ORDER_REVIEW_REQUIRED" };
    }

    const providerValues = uniqueNonBlank(context.map((row) => row.providerNote));
    if (providerValues.length === 0) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "MISSING_PROVIDER_NOTE" };
    }
    if (providerValues.length > 1) {
      return { account, orderId, rows: groupRows, status: "PAUSED", reason: "MULTIPLE_PROVIDER_NOTES" };
    }

    return {
      account,
      orderId,
      rows: groupRows,
      status: "READY",
      tracking: trackingValues[0]!,
      providerNote: providerValues[0]!
    };
  });
}

export interface CotikTrackingSheetWriteRequest {
  readonly spreadsheetId: string;
  readonly tabTitle: string;
  readonly results: readonly { rowNumber: number; result: string }[];
}

export type CotikTrackingSheetWriteResult =
  | { readonly rowNumber: number; readonly status: "WRITTEN" };

export interface GoogleSheetsReadAdapter {
  readonly accessToken: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const MAX_DATA_ROWS = 50;
const MAX_BATCH_SOURCE_ROWS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const CELL_RANGE_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COLUMN_PATTERN = /^\$?[A-Za-z]{1,3}$/;

function invalid(message: string): Error {
  return new Error(message);
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${label} is required`);
  }
  return value.trim();
}

function validateRange(range: string): void {
  const match = CELL_RANGE_PATTERN.exec(range);
  if (match === null) {
    throw invalid("range must be a bounded A1 cell range such as A1:B51");
  }
  const startRow = Number(match[2]);
  const endRow = Number(match[4]);
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 1 || endRow < startRow) {
    throw invalid("range has invalid row bounds");
  }
  if (endRow - startRow > MAX_DATA_ROWS) {
    throw invalid("range may contain at most 50 data rows");
  }
}

function validateBatchRange(range: string): void {
  const match = CELL_RANGE_PATTERN.exec(range);
  if (match === null) throw invalid("range must be a bounded A1 cell range such as A1:AC2000");
  const startColumn = columnIndex(match[1]!);
  const endColumn = columnIndex(match[3]!);
  const startRow = Number(match[2]);
  const endRow = Number(match[4]);
  if (!Number.isSafeInteger(startRow) || !Number.isSafeInteger(endRow) || startRow < 1 || endRow < startRow) {
    throw invalid("range has invalid row bounds");
  }
  if (startColumn !== columnIndex("A") || endColumn < columnIndex("AC")) {
    throw invalid("date-scoped range must start at column A and include columns through AC");
  }
  if (endRow - startRow > MAX_BATCH_SOURCE_ROWS) throw invalid("batch source range is too large");
}

async function readJson(
  request: RequestInfo | URL,
  accessToken: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  operation: "metadata" | "values"
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(request, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`
        }
      });
    } catch {
      if (timedOut) throw invalid(`Google Sheets ${operation} read timed out`);
      throw invalid(`Google Sheets ${operation} read failed`);
    }
    if (!response.ok) {
      throw invalid(`Google Sheets ${operation} read failed (HTTP ${response.status})`);
    }
    try {
      return await response.json();
    } catch {
      if (timedOut) throw invalid(`Google Sheets ${operation} read timed out`);
      throw invalid(`Google Sheets ${operation} response was invalid`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function exactTabExists(metadata: unknown, tabTitle: string): boolean {
  if (typeof metadata !== "object" || metadata === null || !Array.isArray((metadata as { sheets?: unknown }).sheets)) {
    return false;
  }
  return (metadata as { sheets: unknown[] }).sheets.some((sheet) => {
    if (typeof sheet !== "object" || sheet === null) return false;
    const properties = (sheet as { properties?: unknown }).properties;
    return typeof properties === "object" && properties !== null &&
      (properties as { title?: unknown }).title === tabTitle;
  });
}

function readValues(payload: unknown): unknown[][] {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { values?: unknown }).values)) {
    throw invalid("Google Sheets values response did not contain rows");
  }
  const rows = (payload as { values: unknown[] }).values;
  if (!rows.every((row) => Array.isArray(row))) {
    throw invalid("Google Sheets values response had an invalid row shape");
  }
  return rows as unknown[][];
}

function columnIndex(column: string): number {
  const clean = column.replace(/\$/g, "").toUpperCase();
  if (!COLUMN_PATTERN.test(clean)) throw invalid("column must be a valid A1 column");
  let value = 0;
  for (const character of clean) value = value * 26 + character.charCodeAt(0) - 64;
  return value - 1;
}

function cellText(row: unknown[], index: number): string {
  const value = row[index];
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeHeader(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderColumn(header: unknown[], explicit: string | undefined, candidates: readonly string[], label: string): number {
  if (explicit !== undefined) return columnIndex(explicit);
  const matches = header
    .map((value, index) => ({ index, normalized: normalizeHeader(value) }))
    .filter(({ normalized }) => candidates.includes(normalized));
  if (matches.length !== 1) throw invalid(label + " column must be explicitly configured when the header is missing or ambiguous");
  return matches[0]!.index;
}

function findBatchHeaderRow(
  rows: unknown[][],
  dateIndex: number,
  orderIdIndex: number
): number {
  const headerRowIndex = rows.findIndex((row) => {
    const dateHeader = normalizeHeader(row[dateIndex]);
    const orderIdHeader = normalizeHeader(row[orderIdIndex]);
    return ["date", "createddate", "createdat", "orderdate", "ordercreateddate", "ngaytao", "ngaydat"].includes(dateHeader) &&
      (orderIdHeader.includes("orderid") || orderIdHeader.includes("oderid") || orderIdHeader.includes("apiorderid"));
  });
  if (headerRowIndex < 0) throw invalid("Google Sheet is missing the date and Cotik OrderID header row");
  return headerRowIndex;
}

function validateFixedBatchHeaders(header: unknown[]): void {
  const expected: ReadonlyArray<{ column: string; label: string; candidates: readonly string[] }> = [
    { column: "A", label: "date", candidates: ["date", "createddate", "createdat", "orderdate", "ordercreateddate", "ngaytao", "ngaydat"] },
    { column: "B", label: "Cotik OrderID", candidates: ["orderid", "cotikorderid", "apiorderid", "oderid"] },
    { column: "Q", label: "account", candidates: ["acc"] },
    { column: "W", label: "result", candidates: ["result", "done", "status", "writeback", "ketqua", "note"] },
    { column: "Y", label: "Shein OrderID", candidates: ["sheinorderid", "sheinorder", "orderid", "oderid"] },
    { column: "Z", label: "tracking", candidates: ["tracking", "trackingid", "trackingnumber", "trackingno"] },
    { column: "AC", label: "provider", candidates: ["provider", "carrier", "shippingprovider", "transportprovider", "shipper", "note", "done"] }
  ] as const;

  for (const item of expected) {
    const normalized = normalizeHeader(header[columnIndex(item.column)]);
    if (!item.candidates.includes(normalized)) {
      throw invalid(`Google Sheet has an invalid ${item.column} ${item.label} header`);
    }
  }
}

function parseTargetDate(value: unknown, dateFormat: "MDY" | "DMY" | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(text);
  if (!match) return null;
  if (dateFormat === undefined && Number(match[1]) <= 12 && Number(match[2]) <= 12) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = dateFormat === "DMY" ? second : first;
  const day = dateFormat === "DMY" ? first : second;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return match[3] + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function requireIsoDate(value: string | undefined, label: string): string {
  const clean = value?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw invalid(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${clean}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== clean) {
    throw invalid(`${label} must be a valid calendar date`);
  }
  return clean;
}

function readSingleCell(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw invalid("Google Sheets cell response was invalid");
  const values = (payload as { values?: unknown }).values;
  if (values === undefined) return "";
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw invalid("Google Sheets cell response was invalid");
  return cellText(values[0] as unknown[], 0);
}

async function readSheetMetadataAndValues(
  request: CotikTrackingSheetRequest,
  adapter: GoogleSheetsReadAdapter,
  rangeValidator: (range: string) => void
): Promise<unknown[][]> {
  const spreadsheetId = requireNonBlank(request.spreadsheetId, "spreadsheetId");
  const tabTitle = requireNonBlank(request.tabTitle, "tabTitle");
  const range = requireNonBlank(request.range, "range");
  const accessToken = requireNonBlank(adapter.accessToken, "Google Sheets access token");
  const timeoutMs = adapter.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw invalid("timeoutMs must be a positive integer");
  rangeValidator(range);
  const fetchImpl = adapter.fetch ?? fetch;
  const metadataUrl = new URL(SHEETS_API_BASE + "/spreadsheets/" + encodeURIComponent(spreadsheetId));
  metadataUrl.searchParams.set("fields", "sheets(properties(title))");
  const metadata = await readJson(metadataUrl, accessToken, fetchImpl, timeoutMs, "metadata");
  if (!exactTabExists(metadata, tabTitle)) throw invalid("Google Sheet does not contain the exact tab title requested");
  const qualifiedRange = "'" + tabTitle.replaceAll("'", "''") + "'!" + range;
  const valuesUrl = new URL(SHEETS_API_BASE + "/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(qualifiedRange));
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  return readValues(await readJson(valuesUrl, accessToken, fetchImpl, timeoutMs, "values"));
}

function parseRows(rows: unknown[][]): CotikTrackingSheetRow[] {
  if (rows.length === 0) throw invalid("Google Sheet is missing the header row");
  const header = rows[0];
  if (header === undefined || header.length !== 2 || header[0] !== "orderId" || header[1] !== "tracking") {
    throw invalid("Google Sheet must use the exact header contract: orderId, tracking");
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_DATA_ROWS) throw invalid("Google Sheet may contain at most 50 data rows");
  return dataRows.map((row, index) => {
    if (row.length !== 2) throw invalid(`Google Sheet row ${index + 2} must contain orderId and tracking`);
    if (typeof row[0] !== "string" || typeof row[1] !== "string") {
      throw invalid(`Google Sheet row ${index + 2} contains numeric orderId or tracking data`);
    }
    const orderId = row[0].trim();
    const tracking = row[1].trim();
    if (orderId.length === 0 || tracking.length === 0) {
      throw invalid(`Google Sheet row ${index + 2} must contain non-empty orderId and tracking`);
    }
    return { orderId, tracking };
  });
}

export async function readCotikTrackingSheet(
  request: CotikTrackingSheetRequest,
  adapter: GoogleSheetsReadAdapter
): Promise<CotikTrackingSheetRow[]> {
  const spreadsheetId = requireNonBlank(request.spreadsheetId, "spreadsheetId");
  const tabTitle = requireNonBlank(request.tabTitle, "tabTitle");
  const range = requireNonBlank(request.range, "range");
  const accessToken = requireNonBlank(adapter.accessToken, "Google Sheets access token");
  const timeoutMs = adapter.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw invalid("timeoutMs must be a positive integer");
  validateRange(range);
  const fetchImpl = adapter.fetch ?? fetch;

  const metadataUrl = new URL(`${SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  metadataUrl.searchParams.set("fields", "sheets(properties(title))");
  const metadata = await readJson(metadataUrl, accessToken, fetchImpl, timeoutMs, "metadata");
  if (!exactTabExists(metadata, tabTitle)) {
    throw invalid("Google Sheet does not contain the exact tab title requested");
  }

  const qualifiedRange = `'${tabTitle.replaceAll("'", "''")}'!${range}`;
  const valuesUrl = new URL(`${SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(qualifiedRange)}`);
  valuesUrl.searchParams.set("majorDimension", "ROWS");
  valuesUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
  return parseRows(readValues(await readJson(valuesUrl, accessToken, fetchImpl, timeoutMs, "values")));
}

export async function readCotikTrackingSheetBatch(
  request: CotikTrackingSheetBatchRequest,
  adapter: GoogleSheetsReadAdapter
): Promise<CotikTrackingSheetBatchResult> {
  if (request.targetDate !== undefined && request.fromDate !== undefined) {
    throw invalid("targetDate and fromDate are mutually exclusive");
  }
  const targetDate = request.targetDate === undefined ? undefined : requireIsoDate(request.targetDate, "targetDate");
  const fromDate = request.fromDate === undefined ? undefined : requireIsoDate(request.fromDate, "fromDate");
  if (targetDate === undefined && fromDate === undefined) {
    throw invalid("one of targetDate or fromDate is required");
  }
  if (request.dateColumn !== undefined && columnIndex(request.dateColumn) !== columnIndex("A")) {
    throw invalid("date-scoped contract fixes date column A");
  }
  if (request.cotikOrderIdColumn !== undefined && columnIndex(request.cotikOrderIdColumn) !== columnIndex("B")) {
    throw invalid("date-scoped contract fixes the Cotik OrderID to fixed column B");
  }
  const rows = await readSheetMetadataAndValues(request, adapter, validateBatchRange);
  if (rows.length === 0) throw invalid("Google Sheet is missing the header row");
  const dateIndex = columnIndex("A");
  const cotikOrderIdIndex = columnIndex("B");
  const headerRowIndex = findBatchHeaderRow(rows, dateIndex, cotikOrderIdIndex);
  const header = rows[headerRowIndex] ?? [];
  validateFixedBatchHeaders(header);
  const resultIndex = columnIndex("W");
  const accountIndex = columnIndex("Q");
  const trackingYIndex = columnIndex("Y");
  const trackingZIndex = columnIndex("Z");
  const providerIndex = columnIndex("AC");
  if (header.length <= providerIndex) throw invalid("Google Sheet range must include columns through AC");
  const selected: CotikTrackingSheetBatchRow[] = [];
  const groupRows: CotikTrackingSheetGroupRow[] = [];
  const skippedRows: CotikTrackingSheetSkippedRow[] = [];
  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    const rowNumber = headerRowIndex + offset + 2;
    const rowDate = parseTargetDate(row[dateIndex], request.dateFormat);
    if (rowDate === null) return;
    if (fromDate !== undefined ? rowDate < fromDate : rowDate !== targetDate) return;
    const orderId = cellText(row, cotikOrderIdIndex);
    if (!orderId) {
      skippedRows.push({ rowNumber, reason: "MISSING_ORDER_ID" });
      return;
    }
    const account = cellText(row, accountIndex);
    const sheinOrderId = cellText(row, trackingYIndex);
    const providerNote = cellText(row, providerIndex);
    const tracking = cellText(row, trackingZIndex);
    const result = cellText(row, resultIndex);
    groupRows.push({ rowNumber, account, orderId, sheinOrderId, tracking, providerNote, result });
    selected.push({
      rowNumber,
      account,
      orderId,
      sheinOrderId,
      tracking,
      trackingColumn: "Z",
      providerNote,
      result
    });
  });
  return { headerRow: headerRowIndex + 1, rows: selected, groupRows, skippedRows };
}

export async function writeCotikTrackingSheetResults(
  request: CotikTrackingSheetWriteRequest,
  adapter: GoogleSheetsReadAdapter
): Promise<CotikTrackingSheetWriteResult[]> {
  const spreadsheetId = requireNonBlank(request.spreadsheetId, "spreadsheetId");
  const tabTitle = requireNonBlank(request.tabTitle, "tabTitle");
  const accessToken = requireNonBlank(adapter.accessToken, "Google Sheets access token");
  const timeoutMs = adapter.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw invalid("timeoutMs must be a positive integer");
  const fetchImpl = adapter.fetch ?? fetch;
  const metadataUrl = new URL(SHEETS_API_BASE + "/spreadsheets/" + encodeURIComponent(spreadsheetId));
  metadataUrl.searchParams.set("fields", "sheets(properties(title))");
  const metadata = await readJson(metadataUrl, accessToken, fetchImpl, timeoutMs, "metadata");
  if (!exactTabExists(metadata, tabTitle)) throw invalid("Google Sheet does not contain the exact tab title requested");
  const results: CotikTrackingSheetWriteResult[] = [];
  for (const item of request.results) {
    if (!Number.isSafeInteger(item.rowNumber) || item.rowNumber < 1) throw invalid("rowNumber must be a positive integer");
    const resultText = requireNonBlank(item.result, "result");
    if (resultText.length > 200 || /[\x00-\x1f\x7f]/.test(resultText)) throw invalid("result contains invalid characters");
    const cellRange = "'" + tabTitle.replaceAll("'", "''") + "'!W" + item.rowNumber;
    const readUrl = new URL(SHEETS_API_BASE + "/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(cellRange));
    readUrl.searchParams.set("majorDimension", "ROWS");
    readUrl.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");
    const writeUrl = new URL(SHEETS_API_BASE + "/spreadsheets/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(cellRange));
    writeUrl.searchParams.set("valueInputOption", "RAW");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(writeUrl, {
        method: "PUT",
        signal: controller.signal,
        headers: { Accept: "application/json", Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ range: cellRange, majorDimension: "ROWS", values: [[resultText]] })
      });
    } catch {
      throw invalid("Google Sheets write failed");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw invalid("Google Sheets write failed (HTTP " + response.status + ")");
    const payload = await response.json().catch(() => null) as { updatedRange?: unknown } | null;
    if (payload?.updatedRange !== cellRange) throw invalid("Google Sheets write did not cover the requested cell");
    const readback = readSingleCell(await readJson(readUrl, accessToken, fetchImpl, timeoutMs, "values"));
    if (readback !== resultText) throw invalid("Google Sheets write readback did not match");
    results.push({ rowNumber: item.rowNumber, status: "WRITTEN" });
  }
  return results;
}
