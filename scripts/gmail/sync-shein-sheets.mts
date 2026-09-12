import fs from "node:fs";
import path from "node:path";
import { closeDatabase, createDatabase, listCotikOrderStatusesByIds } from "../../packages/db/src/index.ts";
import { extractEmailOrderDetails, type ExtractedEmailOrder } from "./email-order-extractor.mts";
import { DEFAULT_GMAIL_ORDER_QUERY, getSavedAccounts, getValidAccessToken } from "./gmail-api-reader.mts";
import {
  GMAIL_LIST_PAGE_SIZE,
  GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE,
  GMAIL_MAX_DISCOVERY_MESSAGES,
  GMAIL_MAX_MESSAGES_PER_RUN,
  GMAIL_MAX_RETRIES,
  GMAIL_SYNC_INTERFACE_VERSION,
  getIncrementalBufferSize,
  getLegacyMigrationQuery,
  getMinimumRunWaitMs,
  getRetryDelayMs,
  isGoogleRateLimitResponse,
  needsSyncMigration,
  runPacedGoogleRequest,
  selectCheckpointMessageIds,
  selectIncrementalBatch,
  shouldFillBlankSheetCell,
  splitMessageBatch
} from "./gmail-sync-policy.mts";
import {
  buildStatusBatchPayload,
  groupOrderStatusRows,
  type OrderStatusGroup,
  type SheetOrderIdRow
} from "./order-status-sheet.mts";

const REPO_ROOT = process.cwd();
const OAUTH_DIR = path.join(REPO_ROOT, "OauthGoogle");
const STATE_DIR = path.join(OAUTH_DIR, "state");
const STATE_PATH = path.join(STATE_DIR, "sync-shein-state.json");

const SPREADSHEET_ID = "1iK2aYwqRc_V6Yfxtj63bpGwA929oqJ0IrTPZgfaiOu8";
const TARGET_GID = "1844977739";
const DEFAULT_TAB_NAME = "Tháng 9-US";

interface BufferMessageInfo {
  id: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  deliveryCompany?: string | null;
  providerId?: string | null;
  date?: string | null;
  subject?: string | null;
}

interface SyncState {
  syncVersion: string;
  needsBufferMigration: boolean;
  firstRunCompleted: boolean;
  bufferSize: number;
  pendingMessageIds: string[];
  lastRunTimestamp?: string;
  lastProcessedMessageIds: string[];
  lastBufferMessages: BufferMessageInfo[];
  history: Array<{
    timestamp: string;
    bufferSizeUsed: number;
    newEmailsCount: number;
    bufferEmailsChecked: number;
    totalEmailsScanned: number;
    validOrdersFound: number;
    sheetsMatched: number;
    sheetsUpdated: number;
  }>;
}

function loadSyncState(): SyncState {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  if (!fs.existsSync(STATE_PATH)) {
    return {
      syncVersion: GMAIL_SYNC_INTERFACE_VERSION,
      needsBufferMigration: false,
      firstRunCompleted: false,
      bufferSize: GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE,
      pendingMessageIds: [],
      lastProcessedMessageIds: [],
      lastBufferMessages: [],
      history: []
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!raw.syncVersion) raw.syncVersion = "v1.01";
    raw.needsBufferMigration = needsSyncMigration(raw.syncVersion, raw.needsBufferMigration === true);
    if (!raw.bufferSize) raw.bufferSize = GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE;
    if (!Array.isArray(raw.pendingMessageIds)) raw.pendingMessageIds = [];
    if (!raw.lastProcessedMessageIds) raw.lastProcessedMessageIds = [];
    if (!raw.lastBufferMessages) raw.lastBufferMessages = [];
    if (!raw.history) raw.history = [];
    return raw;
  } catch {
    return {
      syncVersion: GMAIL_SYNC_INTERFACE_VERSION,
      needsBufferMigration: false,
      firstRunCompleted: false,
      bufferSize: GMAIL_DEFAULT_INCREMENTAL_BUFFER_SIZE,
      pendingMessageIds: [],
      lastProcessedMessageIds: [],
      lastBufferMessages: [],
      history: []
    };
  }
}

function saveSyncState(state: SyncState): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function loadClientConfig() {
  const files = fs.readdirSync(OAUTH_DIR);
  const secretFile = files.find(f => f.startsWith("client_secret_") && f.endsWith(".json"));
  if (!secretFile) {
    throw new Error(`Không tìm thấy file client_secret_*.json trong ${OAUTH_DIR}`);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(OAUTH_DIR, secretFile), "utf8"));
  return raw.installed || raw.web;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function extractBodyContent(payload: any): { rawText: string; htmlContent: string } {
  let rawText = "";
  let htmlContent = "";

  function traverseParts(parts?: any[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        rawText += decodeBase64Url(part.body.data) + "\n";
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlContent += decodeBase64Url(part.body.data) + "\n";
      }
      if (part.parts) {
        traverseParts(part.parts);
      }
    }
  }

  if (payload?.body?.data) {
    rawText += decodeBase64Url(payload.body.data);
  }

  traverseParts(payload?.parts);
  return { rawText, htmlContent };
}

async function fetchWithRetry(url: string, options: RequestInit, retries = GMAIL_MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await runPacedGoogleRequest(() => fetch(url, options));
    const text = res.status === 429 || res.status === 403 ? await res.clone().text() : "";
    if (isGoogleRateLimitResponse(res.status, text)) {
      if (attempt === retries) {
        throw new Error(`Google API rate limit persisted after ${retries} attempts`);
      }

      const waitTime = getRetryDelayMs(attempt, res.headers.get("retry-after"));
      console.log(`[Rate Limit] Chạm hạn mức Google API, đợi ${Math.ceil(waitTime / 1000)}s thử lại (lần ${attempt}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }

    return res;
  }

  throw new Error("Gmail request retry loop ended unexpectedly");
}

async function loadOrderStatuses(orderIds: readonly string[]): Promise<Map<string, string>> {
  try {
    process.loadEnvFile(path.join(REPO_ROOT, ".env"));
  } catch {
    // The process may already have its environment loaded by the caller.
  }

  const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.SUPABASE_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to update Sheet order statuses");

  const context = createDatabase(databaseUrl);
  try {
    const rows = await listCotikOrderStatusesByIds(context.db, orderIds);
    const statuses = new Map<string, string>();
    for (const row of rows) {
      const orderId = row.orderId.trim().toUpperCase();
      if (!statuses.has(orderId)) statuses.set(orderId, row.orderStatus);
    }
    return statuses;
  } finally {
    await closeDatabase(context);
  }
}

/**
 * Lấy danh sách email theo chiến lược đệm:
 * - Khi chạy định kỳ: Lấy toàn bộ email MỚI + N email ĐỆM từ lần chạy trước để kiểm tra lại
 * - Nếu không tìm thấy mốc đệm hoặc lần đầu: Lấy danh sách theo query tiêu chuẩn
 */
async function fetchMessagesWithBufferStrategy(
  accessToken: string,
  query: string,
  prevBufferIds: string[],
  bufferSize: number
): Promise<{
  newMessages: Array<{ id: string }>;
  bufferMessages: Array<{ id: string }>;
  allMessages: Array<{ id: string }>;
  anchorFound: boolean;
}> {
  const allFetched: Array<{ id: string }> = [];
  let pageToken: string | undefined = undefined;
  let firstBufferIndex = -1;

  // Lấy email cho đến khi tìm thấy mốc đệm từ lần chạy trước.
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(GMAIL_LIST_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Lỗi Gmail API list messages: ${err}`);
    }

    const data = await res.json() as any;
    if (data.messages && Array.isArray(data.messages)) {
      allFetched.push(...data.messages.slice(0, GMAIL_MAX_DISCOVERY_MESSAGES - allFetched.length));
    }

    if (prevBufferIds.length > 0) {
      firstBufferIndex = allFetched.findIndex(m => prevBufferIds.includes(m.id));
      if (firstBufferIndex !== -1) {
        // Đã tìm thấy điểm nối mốc đệm!
        break;
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken && allFetched.length < GMAIL_MAX_DISCOVERY_MESSAGES);

  if (prevBufferIds.length > 0 && firstBufferIndex !== -1) {
    const newMessages = allFetched.slice(0, firstBufferIndex);
    const bufferMessages = allFetched.slice(
      firstBufferIndex,
      firstBufferIndex + Math.min(bufferSize, GMAIL_MAX_MESSAGES_PER_RUN)
    );
    return {
      newMessages,
      bufferMessages,
      allMessages: [...newMessages, ...bufferMessages],
      anchorFound: true
    };
  }

  // Fallback nếu không khớp mốc đệm: giữ toàn bộ discovery để không bỏ sót mail.
  return {
    newMessages: allFetched,
    bufferMessages: [],
    allMessages: allFetched,
    anchorFound: false
  };
}

/**
 * Lấy danh sách email từ Gmail API có phân trang (dùng cho Full Scan lần đầu)
 */
async function fetchAllMessagesMatchingQuery(
  accessToken: string,
  query: string,
  maxMessages = GMAIL_MAX_DISCOVERY_MESSAGES
): Promise<Array<{ id: string }>> {
  let messages: Array<{ id: string }> = [];
  let pageToken: string | undefined = undefined;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(GMAIL_LIST_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetchWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Lỗi Gmail API list messages: ${err}`);
    }

    const data = await res.json() as any;
    if (data.messages && Array.isArray(data.messages)) {
      messages.push(...data.messages.slice(0, Math.max(0, maxMessages - messages.length)));
    }

    pageToken = data.nextPageToken;
    if (messages.length >= maxMessages) break;
  } while (pageToken);

  return messages.slice(0, maxMessages);
}

/**
 * Đọc tuần tự từng email và trích xuất Order, Tracking, Provider kèm Header.
 */
async function fetchOrderDetailsFromMessages(accessToken: string, messages: Array<{ id: string }>): Promise<ExtractedEmailOrder[]> {
  const orders: ExtractedEmailOrder[] = [];
  const chunkSize = 1;
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(async (m) => {
      try {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`;
        const res = await fetchWithRetry(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return null;

        const detail = await res.json() as any;
        const { rawText, htmlContent } = extractBodyContent(detail.payload);
        const extracted = extractEmailOrderDetails(rawText || detail.snippet, htmlContent);

        const headers = detail.payload?.headers || [];
        const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
        const date = headers.find((h: any) => h.name?.toLowerCase() === "date")?.value || "";

        extracted.messageId = m.id;
        extracted.subject = subject;
        extracted.date = date;

        if (extracted.orderNumber) {
          return extracted;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Google API rate limit persisted")) throw error;
        return null;
      }
      return null;
    }));

    for (const r of chunkResults) {
      if (r) orders.push(r);
    }

    // Nghỉ nhẹ 80ms giữa các chunk để không chạm hạn mức rate-limit
    await new Promise(r => setTimeout(r, 80));
  }

  return orders;
}

/**
 * Xác định tên Tab từ GID
 */
async function resolveTabTitle(accessToken: string, spreadsheetId: string, targetGid: string): Promise<string> {
  try {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const res = await fetchWithRetry(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const meta = await res.json() as any;
      const sheet = meta.sheets?.find((s: any) => String(s.properties?.sheetId) === String(targetGid));
      if (sheet?.properties?.title) {
        return sheet.properties.title;
      }
    }
  } catch {}
  return DEFAULT_TAB_NAME;
}

/**
 * Đọc dữ liệu cột Y đến AC từ Google Sheet
 */
async function readSheetYtoAC(accessToken: string, spreadsheetId: string, tabTitle: string): Promise<Array<{
  rowNumber: number;
  orderNumber: string;
  trackingNumber: string;
  deliveryCompany: string;
}>> {
  // Y là cột 25 (index 0 trong dải Y:AC), Z là cột 26 (index 1), AC là cột 29 (index 4)
  const range = `'${tabTitle}'!Y1:AC10000`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets API Read failed: ${err}`);
  }

  const data = await res.json() as any;
  const rows = data.values as string[][] | undefined;
  if (!rows || rows.length === 0) return [];

  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const orderNumber = (row[0] || "").trim(); // Cột Y
    const trackingNumber = (row[1] || "").trim(); // Cột Z
    const deliveryCompany = (row[4] || "").trim(); // Cột AC (Y=0, Z=1, AA=2, AB=3, AC=4)

    result.push({
      rowNumber: i + 1,
      orderNumber,
      trackingNumber,
      deliveryCompany
    });
  }

  return result;
}

async function readSheetOrderIds(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string
): Promise<SheetOrderIdRow[]> {
  const range = `'${tabTitle.replace(/'/g, "''")}'!B2:AI10000`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets OrderID read failed: ${err}`);
  }

  const data = await res.json() as { values?: unknown[][] };
  return (data.values ?? []).map((row, index) => ({
    rowNumber: index + 2,
    orderId: String(row[0] ?? "").trim(),
    currentStatus: String(row[33] ?? "").trim()
  }));
}

async function verifyOrderStatusGroups(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  groups: readonly OrderStatusGroup[]
): Promise<void> {
  const rowNumbers = groups.flatMap((group) => group.rowNumbers);
  if (rowNumbers.length === 0) return;
  const firstRow = Math.min(...rowNumbers);
  const lastRow = Math.max(...rowNumbers);
  const range = `'${tabTitle.replace(/'/g, "''")}'!AI${firstRow}:AI${lastRow}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets order status readback failed: ${err}`);
  }

  const data = await res.json() as { values?: unknown[][] };
  const values = data.values ?? [];
  for (const group of groups) {
    for (const rowNumber of group.rowNumbers) {
      const actual = String(values[rowNumber - firstRow]?.[0] ?? "").trim();
      if (actual !== group.status) {
        throw new Error(`Google Sheets order status readback mismatch at AI${rowNumber}: expected ${group.status}, got ${actual || "[blank]"}`);
      }
    }
  }
}

async function updateSheetOrderStatuses(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  groups: readonly OrderStatusGroup[]
): Promise<number> {
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  let updatedCount = 0;

  for (const group of groups) {
    const data = buildStatusBatchPayload(tabTitle, group);
    if (data.length === 0) continue;

    const res = await fetchWithRetry(batchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ valueInputOption: "RAW", data })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Sheets order status batchUpdate failed: ${err}`);
    }

    const response = await res.json() as {
      updatedRange?: unknown;
      responses?: Array<{ updatedRange?: unknown }>;
    };
    const updatedRange = typeof response.updatedRange === "string"
      ? response.updatedRange
      : response.responses?.find((item) => typeof item.updatedRange === "string")?.updatedRange;
    if (typeof updatedRange !== "string" || updatedRange.length === 0) {
      throw new Error(`Google Sheets order status batchUpdate returned no updatedRange for ${group.status}`);
    }

    updatedCount += group.rowNumbers.length;
  }

  await verifyOrderStatusGroups(accessToken, spreadsheetId, tabTitle, groups);

  return updatedCount;
}

/**
 * Cập nhật Cột Z (Tracking) và Cột AC (Provider) cho các dòng khớp
 */
async function updateSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  updates: Array<{
    rowNumber: number;
    trackingNumber: string;
    deliveryCompany: string;
    oldTracking: string;
    oldProvider: string;
  }>
): Promise<number> {
  if (updates.length === 0) return 0;

  const dataPayload = [];
  for (const up of updates) {
    // Cập nhật Cột Z
    if (shouldFillBlankSheetCell(up.oldTracking, up.trackingNumber)) {
      dataPayload.push({
        range: `'${tabTitle}'!Z${up.rowNumber}`,
        values: [[up.trackingNumber]]
      });
    }
    // Cập nhật Cột AC
    if (shouldFillBlankSheetCell(up.oldProvider, up.deliveryCompany)) {
      dataPayload.push({
        range: `'${tabTitle}'!AC${up.rowNumber}`,
        values: [[up.deliveryCompany]]
      });
    }
  }

  if (dataPayload.length === 0) return 0;

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const res = await fetchWithRetry(batchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: dataPayload
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Sheets batchUpdate failed: ${err}`);
  }

  return updates.length;
}

async function syncOrderStatusesOnSheet(
  accessToken: string,
  tabTitle: string,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  const statusSheetRows = await readSheetOrderIds(accessToken, SPREADSHEET_ID, tabTitle);
  const statusByOrderId = await loadOrderStatuses(statusSheetRows.map((row) => row.orderId));
  const statusGroups = groupOrderStatusRows(statusSheetRows, statusByOrderId);
  const statusRowsToUpdate = statusGroups.reduce((total, group) => total + group.rowNumbers.length, 0);

  console.log(`- Cập nhật trạng thái Order vào cột AI: ${statusRowsToUpdate} dòng, ${statusGroups.length} nhóm.`);
  if (statusRowsToUpdate > 0 && !options.dryRun) {
    const statusUpdatedCount = await updateSheetOrderStatuses(accessToken, SPREADSHEET_ID, tabTitle, statusGroups);
    console.log(`Đã cập nhật ${statusUpdatedCount} trạng thái Order vào cột AI.`);
  } else if (options.dryRun && statusRowsToUpdate > 0) {
    console.log(`[DRY RUN] Bỏ qua ghi ${statusRowsToUpdate} trạng thái Order vào cột AI.`);
  }
}

export async function executeOrderStatusSheetSync(options: { dryRun?: boolean } = {}): Promise<void> {
  const clientConfig = loadClientConfig();
  const accessToken = await getValidAccessToken(clientConfig, SHEETS_TARGET_ACCOUNT, { forceRefresh: true });
  const tabTitle = await resolveTabTitle(accessToken, SPREADSHEET_ID, TARGET_GID);
  console.log(`Đang cập nhật trạng thái Order trong Sheet "${tabTitle}" (cột B -> AI)...`);
  await syncOrderStatusesOnSheet(accessToken, tabTitle, options);
}

const GMAIL_SOURCE_ACCOUNT = "luongbui25072008@gmail.com";
const SHEETS_TARGET_ACCOUNT = "vietnguyen2510.ns@gmail.com";

/**
 * Thực thi một chu kỳ đồng bộ
 */
export async function executeSyncCycle(options: {
  dryRun?: boolean;
  bufferSize?: number;
} = {}): Promise<void> {
  console.log(`\n================================================================`);
  console.log(`[CHU KỲ ĐỒNG BỘ: GMAIL -> GOOGLE SHEET] ${new Date().toLocaleString("vi-VN")}`);
  console.log(`================================================================`);
  console.log(`📧 Tài khoản ĐỌC GMAIL:  ${GMAIL_SOURCE_ACCOUNT}`);
  console.log(`📊 Tài khoản GHI SHEET:   ${SHEETS_TARGET_ACCOUNT}`);

  const state = loadSyncState();
  const runWaitMs = getMinimumRunWaitMs(state.lastRunTimestamp);
  if (runWaitMs > 0) {
    console.log(`- Giãn cách tối thiểu v1.03: chờ ${Math.ceil(runWaitMs / 1_000)}s trước chu kỳ tiếp theo.`);
    await new Promise(resolve => setTimeout(resolve, runWaitMs));
  }

  const wasFirstRunCompleted = state.firstRunCompleted;
  const hadPendingQueue = state.pendingMessageIds.length > 0;
  const isInitialFullScan = !wasFirstRunCompleted;
  const isLegacyMigration = state.needsBufferMigration && wasFirstRunCompleted && !hadPendingQueue;
  state.syncVersion = GMAIL_SYNC_INTERFACE_VERSION;
  console.log(`- Interface sync: ${GMAIL_SYNC_INTERFACE_VERSION}`);

  const clientConfig = loadClientConfig();
  const sheetsToken = await getValidAccessToken(clientConfig, SHEETS_TARGET_ACCOUNT, { forceRefresh: true });
  const tabTitle = await resolveTabTitle(sheetsToken, SPREADSHEET_ID, TARGET_GID);
  await syncOrderStatusesOnSheet(sheetsToken, tabTitle, options);

  const configuredBufferSize = options.bufferSize ?? (
    state.firstRunCompleted
      ? getIncrementalBufferSize(state.lastRunTimestamp)
      : state.bufferSize || GMAIL_MAX_MESSAGES_PER_RUN
  );
  const bufferSize = Math.min(Math.max(1, configuredBufferSize), GMAIL_MAX_MESSAGES_PER_RUN);
  state.bufferSize = bufferSize;

  console.log(`- Trạng thái: ${state.firstRunCompleted ? "Chạy định kỳ (Incremental với Bộ đệm)" : "Lần chạy đầu tiên (Full Scan từ 01/09)"}`);
  console.log(`- Kích thước bộ đệm (Buffer Size): ${bufferSize} email (cấu hình qua cờ --buffer=<số>)`);

  // 1. Xác định Query Gmail
  let gmailQuery = DEFAULT_GMAIL_ORDER_QUERY;
  if (!state.firstRunCompleted) {
    gmailQuery += " after:2026/08/31";
  } else if (isLegacyMigration) {
    gmailQuery = getLegacyMigrationQuery(gmailQuery, state.lastRunTimestamp);
    console.log(`- Backfill state cũ -> ${GMAIL_SYNC_INTERFACE_VERSION}: rà trong cửa sổ 72 giờ, tối đa ${GMAIL_MAX_DISCOVERY_MESSAGES} email và xử lý theo batch ${GMAIL_MAX_MESSAGES_PER_RUN}.`);
  }

  // 2. Thu thập email từ tài khoản Gmail luongbui25072008@gmail.com
  console.log(`\n[Bước 1] Đang đọc hộp thư Gmail của: ${GMAIL_SOURCE_ACCOUNT}...`);
  const gmailAccessToken = await getValidAccessToken(clientConfig, GMAIL_SOURCE_ACCOUNT, { forceRefresh: true });

  let newMessages: Array<{ id: string }> = [];
  let bufferMessages: Array<{ id: string }> = [];
  let messagesToFetch: Array<{ id: string }> = [];
  let pendingAfterBatch: string[] = [];
  let checkpointMessages: Array<{ id: string }> = [];
  let shouldRefreshCheckpoint = false;

  if (state.pendingMessageIds.length > 0) {
    const pendingBatch = splitMessageBatch(state.pendingMessageIds);
    pendingAfterBatch = pendingBatch.pending;
    newMessages = pendingBatch.batch.map(id => ({ id }));
    messagesToFetch = newMessages;
    console.log(`- Tiếp tục hàng đợi ${state.firstRunCompleted ? "incremental" : "full scan"}: xử lý ${messagesToFetch.length} email, còn ${pendingBatch.pending.length} email.`);

  } else if (isLegacyMigration) {
    const migrationMessages = await fetchAllMessagesMatchingQuery(
      gmailAccessToken,
      gmailQuery,
      GMAIL_MAX_DISCOVERY_MESSAGES
    );
    const migrationBatch = splitMessageBatch(migrationMessages);
    newMessages = migrationBatch.batch;
    bufferMessages = [];
    messagesToFetch = migrationBatch.batch;
    pendingAfterBatch = migrationBatch.pending.map(message => message.id);
    checkpointMessages = migrationMessages;
    shouldRefreshCheckpoint = true;
    console.log(`- Backfill v1.03: kiểm tra tối đa ${messagesToFetch.length} email trong cửa sổ 72 giờ, còn ${pendingAfterBatch.length} email chờ lượt sau; gồm cả Spam/Trash.`);

  } else if (state.firstRunCompleted && state.lastProcessedMessageIds.length > 0) {
    console.log(`- Nạp ${state.lastProcessedMessageIds.length} ID mốc đệm từ lần chạy trước: ${state.lastProcessedMessageIds.join(", ")}`);
    const fetched = await fetchMessagesWithBufferStrategy(
      gmailAccessToken,
      gmailQuery,
      state.lastProcessedMessageIds,
      bufferSize
    );
    if (!fetched.anchorFound) {
      throw new Error(`Không tìm thấy mốc đệm trong ${GMAIL_MAX_DISCOVERY_MESSAGES} email đầu; dừng để tránh bỏ sót. Chỉ dùng --reset khi muốn full scan có chủ đích.`);
    }
    checkpointMessages = fetched.allMessages;
    shouldRefreshCheckpoint = true;

    const selected = selectIncrementalBatch(fetched.newMessages, fetched.bufferMessages);
    const newMessageIds = new Set(fetched.newMessages.map(message => message.id));
    const bufferMessageIds = new Set(fetched.bufferMessages.map(message => message.id));
    newMessages = selected.batch.filter(message => newMessageIds.has(message.id));
    bufferMessages = selected.batch.filter(message => bufferMessageIds.has(message.id));
    messagesToFetch = selected.batch;
    pendingAfterBatch = selected.pending.map(message => message.id);

    console.log(`\n----------------------------------------------------------------`);
    console.log(`📦 KẾT QUẢ PHÂN TÁCH BỘ ĐỆM:`);
    console.log(`  * Số email MỚI phát hiện:        ${fetched.newMessages.length}`);
    console.log(`  * Số email MỚI xử lý trong batch: ${newMessages.length}`);
    console.log(`  * Số email ĐỆM cần kiểm tra lại: ${bufferMessages.length}`);
    console.log(`  * Tổng số email cần xử lý:      ${messagesToFetch.length}`);
    console.log(`----------------------------------------------------------------`);
  } else {
    // Lần đầu tiên: Full scan
    const all = await fetchAllMessagesMatchingQuery(gmailAccessToken, gmailQuery);
    const initialBatch = splitMessageBatch(all);
    state.pendingMessageIds = all.map(message => message.id);
    checkpointMessages = all;
    shouldRefreshCheckpoint = true;
    pendingAfterBatch = initialBatch.pending.map(message => message.id);
    newMessages = initialBatch.batch;
    bufferMessages = [];
    messagesToFetch = initialBatch.batch;
    console.log(`- Quét danh sách: tìm thấy ${all.length} email SHEIN từ 01/09; xử lý ${messagesToFetch.length}, còn ${pendingAfterBatch.length}.`);
  }

  if (messagesToFetch.length === 0) {
    console.log("Không có email nào cần xử lý. Kết thúc chu kỳ.");
    if (!options.dryRun) saveSyncState(state);
    return;
  }

  // Đọc chi tiết các email
  const allOrders = await fetchOrderDetailsFromMessages(gmailAccessToken, messagesToFetch);

  // Phân tách các đơn hàng mới vs các đơn hàng trong bộ đệm
  const newMsgIdSet = new Set(newMessages.map(m => m.id));
  const bufferMsgIdSet = new Set(bufferMessages.map(m => m.id));

  const newOrders = allOrders.filter(o => o.messageId && newMsgIdSet.has(o.messageId));
  const bufferOrders = allOrders.filter(o => o.messageId && bufferMsgIdSet.has(o.messageId));

  // Tạo orderMap tổng hợp (ưu tiên email có tracking hơn email không có tracking)
  const orderMap = new Map<string, ExtractedEmailOrder>();
  for (const ord of allOrders) {
    if (ord.orderNumber) {
      const key = ord.orderNumber.toUpperCase();
      const existing = orderMap.get(key);
      if (!existing || (ord.trackingNumber && !existing.trackingNumber)) {
        orderMap.set(key, ord);
      }
    }
  }

  // 3. Đọc dữ liệu từ Google Sheets
  console.log(`\n[Bước 2] Đang kết nối Google Sheets bằng tài khoản: ${SHEETS_TARGET_ACCOUNT}...`);
  console.log(`- Đang đọc dữ liệu từ Sheet: "${tabTitle}" (GID: ${TARGET_GID})...`);
  const sheetRows = await readSheetYtoAC(sheetsToken, SPREADSHEET_ID, tabTitle);
  console.log(`- Đã đọc ${sheetRows.length} dòng từ Google Sheet.`);

  // 4. KIỂM TRA BỘ ĐỆM (BUFFER CHECK) TỪ LẦN CHẠY TRƯỚC
  if (bufferOrders.length > 0) {
    console.log(`\n================================================================`);
    console.log(`🔍 [KIỂM TRA ${bufferOrders.length} EMAIL BỘ ĐỆM TỪ LẦN CHẠY TRƯỚC]`);
    console.log(`================================================================`);
    for (let i = 0; i < bufferOrders.length; i++) {
      const b = bufferOrders[i];
      const matchRow = sheetRows.find(r => r.orderNumber.toUpperCase() === b.orderNumber?.toUpperCase());

      let statusMsg = "";
      if (matchRow) {
        if (!matchRow.trackingNumber && b.trackingNumber) {
          statusMsg = `⚡ CẦN CẬP NHẬT (Sheet Dòng ${matchRow.rowNumber} chưa có Tracking, Email đã có: ${b.trackingNumber})`;
        } else if (matchRow.trackingNumber) {
          statusMsg = `✅ HỢP LỆ & ĐÃ ĐỒNG BỘ TRÊN SHEET (Dòng ${matchRow.rowNumber} | Z: ${matchRow.trackingNumber} | AC: ${matchRow.deliveryCompany})`;
        } else {
          statusMsg = `⏳ CHỜ TRACKING (Email chỉ là xác nhận đơn, chưa có mã vận đơn)`;
        }
      } else {
        statusMsg = `⚠️ ĐƠN CHƯA CÓ TRÊN SHEET (Mã đơn ${b.orderNumber} chưa nằm ở Cột Y)`;
      }

      console.log(`[${i + 1}/${bufferOrders.length}] ID: ${b.messageId} | Ngày: ${b.date || "N/A"}`);
      console.log(`     Tiêu đề: "${b.subject || "N/A"}"`);
      console.log(`     Đơn hàng: ${b.orderNumber || "N/A"} | Tracking: ${b.trackingNumber || "N/A"} | ĐVVC: ${b.deliveryCompany || "N/A"}`);
      console.log(`     -> Trạng thái Sheet: ${statusMsg}`);
    }
  }

  // 5. HIỂN THỊ EMAIL MỚI (NẾU CÓ)
  if (newOrders.length > 0) {
    console.log(`\n================================================================`);
    console.log(`📬 [PHÁT HIỆN ${newOrders.length} EMAIL MỚI KỂ TỪ LẦN CHẠY TRƯỚC]`);
    console.log(`================================================================`);
    for (let i = 0; i < newOrders.length; i++) {
      const o = newOrders[i];
      console.log(`[${i + 1}/${newOrders.length}] ID: ${o.messageId} | Ngày: ${o.date || "N/A"}`);
      console.log(`     Đơn hàng: ${o.orderNumber || "N/A"} | Tracking: ${o.trackingNumber || "N/A"} | ĐVVC: ${o.deliveryCompany || "N/A"}`);
    }
  }

  // 6. Đối chiếu với Cột Y trên Sheet và chuẩn bị danh sách cập nhật
  const updatesToApply: Array<{
    rowNumber: number;
    orderNumber: string;
    trackingNumber: string;
    deliveryCompany: string;
    oldTracking: string;
    oldProvider: string;
  }> = [];

  let matchedCount = 0;

  for (const row of sheetRows) {
    if (!row.orderNumber) continue;

    const emailOrder = orderMap.get(row.orderNumber.toUpperCase());
    if (emailOrder) {
      matchedCount++;

      const newTracking = emailOrder.trackingNumber || "";
      const newProvider = emailOrder.deliveryCompany || "";

      const needTrackingUpdate = Boolean(newTracking && (!row.trackingNumber || row.trackingNumber.trim().length === 0));
      const needProviderUpdate = Boolean(newProvider && (!row.deliveryCompany || row.deliveryCompany.trim().length === 0));

      if (needTrackingUpdate || needProviderUpdate) {
        updatesToApply.push({
          rowNumber: row.rowNumber,
          orderNumber: row.orderNumber,
          trackingNumber: newTracking,
          deliveryCompany: newProvider,
          oldTracking: row.trackingNumber,
          oldProvider: row.deliveryCompany
        });
      }
    }
  }

  console.log(`\n- Tổng số đơn hàng khớp với Cột Y trên Sheet: ${matchedCount}`);
  console.log(`- Số dòng cần điền Tracking (Z) và Provider (AC): ${updatesToApply.length}`);

  if (updatesToApply.length > 0) {
    console.log("\nChi tiết các dòng sẽ được cập nhật:");
    for (const up of updatesToApply) {
      console.log(`  * Dòng ${up.rowNumber} | Đơn: ${up.orderNumber}`);
      console.log(`    -> Cột Z (Tracking):  "${up.oldTracking || '[Trống]'}" => "${up.trackingNumber}"`);
      console.log(`    -> Cột AC (Provider): "${up.oldProvider || '[Trống]'}" => "${up.deliveryCompany}"`);
    }
  }

  // 7. Thực hiện ghi vào Google Sheets
  if (!options.dryRun && updatesToApply.length > 0) {
    console.log(`\nĐang gửi yêu cầu ghi vào Google Sheets...`);
    const updatedCount = await updateSheetRows(sheetsToken, SPREADSHEET_ID, tabTitle, updatesToApply);
    console.log(`✅ [THÀNH CÔNG] Đã cập nhật thành công ${updatedCount} dòng vào Sheet "${tabTitle}"!`);
  } else if (options.dryRun) {
    console.log(`\n[DRY RUN] Chế độ kiểm tra, không ghi vào Google Sheets.`);
  } else {
    console.log(`\nTất cả các đơn đã có đủ Tracking number và Provider, không cần cập nhật thêm.`);
  }

  // 8. LƯU BỘ ĐỆM MỚI CHO CHU KỲ TIẾP THEO
  // Lấy N email mới nhất từ danh sách đã xử lý (đã sắp xếp theo thời gian mới nhất trước)
  state.pendingMessageIds = pendingAfterBatch;
  const scanComplete = state.pendingMessageIds.length === 0;
  const ordersByMessageId = new Map(
    allOrders
      .filter(order => Boolean(order.messageId))
      .map(order => [order.messageId as string, order] as const)
  );
  const checkpointIds = shouldRefreshCheckpoint
    ? selectCheckpointMessageIds(checkpointMessages, bufferSize)
    : state.lastProcessedMessageIds;
  const nextBufferMessages: BufferMessageInfo[] = shouldRefreshCheckpoint
    ? checkpointIds.map(id => {
      const order = ordersByMessageId.get(id);
      return {
        id,
        orderNumber: order?.orderNumber,
        trackingNumber: order?.trackingNumber,
        deliveryCompany: order?.deliveryCompany,
        providerId: order?.providerId,
        subject: order?.subject,
        date: order?.date
      };
    })
    : state.lastBufferMessages;

  if (!options.dryRun) {
    state.needsBufferMigration = state.needsBufferMigration && !isLegacyMigration;
    state.firstRunCompleted = isInitialFullScan ? scanComplete : true;
    state.bufferSize = bufferSize;
    state.lastRunTimestamp = new Date().toISOString();
    if (shouldRefreshCheckpoint && nextBufferMessages.length > 0) {
      state.lastProcessedMessageIds = checkpointIds;
      state.lastBufferMessages = nextBufferMessages;
    }
    state.history.unshift({
      timestamp: new Date().toISOString(),
      bufferSizeUsed: bufferSize,
      newEmailsCount: newOrders.length,
      bufferEmailsChecked: bufferOrders.length,
      totalEmailsScanned: messagesToFetch.length,
      validOrdersFound: orderMap.size,
      sheetsMatched: matchedCount,
      sheetsUpdated: updatesToApply.length
    });
    if (state.history.length > 50) state.history.pop();
    saveSyncState(state);
  }

  if (!scanComplete) {
    console.log(`Còn ${state.pendingMessageIds.length} email trong hàng đợi; chạy lại lệnh manual để tiếp tục.`);
  }

  console.log(`\n================================================================`);
  console.log(`💾 [LƯU BỘ ĐỆM MỚI] Đã lưu ${nextBufferMessages.length} email mới nhất làm mốc đệm cho lần chạy sau:`);
  for (let i = 0; i < nextBufferMessages.length; i++) {
    const b = nextBufferMessages[i];
    console.log(`  ${i + 1}. ID: ${b.id} | Đơn: ${b.orderNumber || "N/A"} | Tracking: ${b.trackingNumber || "N/A"} | ĐVVC: ${b.deliveryCompany || "N/A"} | Ngày: ${b.date || "N/A"}`);
  }
  console.log(`================================================================\n`);
  console.log(`Chu kỳ đồng bộ hoàn tất.\n`);
}

/**
 * Khởi động lịch chạy định kỳ (mặc định 4 tiếng / 1 lần)
 */
function startSchedule(intervalHours = 4, options: { dryRun?: boolean; bufferSize?: number } = {}): void {
  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`\n⏰ [SCHEDULER KHỞI CHẠY] Lịch chạy tự động mỗi ${intervalHours} giờ.`);
  console.log(`Lần chạy đầu tiên sẽ được thực hiện ngay bây giờ...\n`);

  // Chạy ngay lần đầu
  executeSyncCycle(options).catch((err) => {
    console.error("❌ Lỗi chu kỳ đồng bộ:", err.message);
  });

  // Lặp lại định kỳ
  setInterval(() => {
    console.log(`\n⏰ Kích hoạt chu kỳ định kỳ (sau ${intervalHours} giờ)...`);
    executeSyncCycle(options).catch((err) => {
      console.error("❌ Lỗi chu kỳ định kỳ:", err.message);
    });
  }, intervalMs);
}

async function main() {
  const args = process.argv.slice(2);
  const isSchedule = args.includes("--schedule");
  const isStatusOnly = args.includes("--status-only");
  const isVersion = args.includes("--version");
  const isDryRun = args.includes("--dry-run");
  const isReset = args.includes("--reset");

  let bufferSize: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--buffer=")) {
      bufferSize = parseInt(args[i].split("=")[1], 10);
    } else if (args[i] === "--buffer" && args[i + 1]) {
      bufferSize = parseInt(args[i + 1], 10);
    }
  }

  let intervalHours = 4;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--interval=")) {
      intervalHours = parseFloat(args[i].split("=")[1]);
    } else if (args[i] === "--interval" && args[i + 1]) {
      intervalHours = parseFloat(args[i + 1]);
    }
  }

  if (isReset) {
    console.log("🔄 Đặt lại trạng thái đồng bộ (Reset state về lần chạy đầu tiên)...");
    const state = loadSyncState();
    state.firstRunCompleted = false;
    state.pendingMessageIds = [];
    state.lastProcessedMessageIds = [];
    state.lastBufferMessages = [];
    state.syncVersion = GMAIL_SYNC_INTERFACE_VERSION;
    saveSyncState(state);
  }

  if (isVersion) {
    console.log(GMAIL_SYNC_INTERFACE_VERSION);
  } else if (isStatusOnly) {
    await executeOrderStatusSheetSync({ dryRun: isDryRun });
  } else if (isSchedule) {
    startSchedule(intervalHours, { dryRun: isDryRun, bufferSize });
  } else {
    await executeSyncCycle({ dryRun: isDryRun, bufferSize });
  }
}

main().catch((err) => {
  console.error("\n❌ [Lỗi]:", err.message);
  process.exit(1);
});
