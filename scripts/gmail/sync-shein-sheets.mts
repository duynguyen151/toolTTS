import fs from "node:fs";
import path from "node:path";
import { extractEmailOrderDetails, type ExtractedEmailOrder } from "./email-order-extractor.mts";
import { getSavedAccounts, getValidAccessToken } from "./gmail-api-reader.mts";

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
  firstRunCompleted: boolean;
  bufferSize: number;
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
      firstRunCompleted: false,
      bufferSize: 4,
      lastProcessedMessageIds: [],
      lastBufferMessages: [],
      history: []
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!raw.bufferSize) raw.bufferSize = 4;
    if (!raw.lastProcessedMessageIds) raw.lastProcessedMessageIds = [];
    if (!raw.lastBufferMessages) raw.lastBufferMessages = [];
    if (!raw.history) raw.history = [];
    return raw;
  } catch {
    return {
      firstRunCompleted: false,
      bufferSize: 4,
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

async function fetchWithRetry(url: string, options: any, retries = 4): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status === 403) {
      const text = await res.clone().text();
      if (text.includes("rateLimitExceeded") || text.includes("Quota exceeded")) {
        const waitTime = attempt * 6000;
        console.log(`[Rate Limit] Chạm hạn mức Google API, đợi ${waitTime / 1000}s thử lại (lần ${attempt}/${retries})...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
    }
    return res;
  }
  return await fetch(url, options);
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
}> {
  const allFetched: Array<{ id: string }> = [];
  let pageToken: string | undefined = undefined;
  let firstBufferIndex = -1;

  // Lấy email cho đến khi tìm thấy mốc đệm từ lần chạy trước (tối đa 150 email)
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "50");
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
      allFetched.push(...data.messages);
    }

    if (prevBufferIds.length > 0) {
      firstBufferIndex = allFetched.findIndex(m => prevBufferIds.includes(m.id));
      if (firstBufferIndex !== -1) {
        // Đã tìm thấy điểm nối mốc đệm!
        break;
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken && allFetched.length < 150);

  if (prevBufferIds.length > 0 && firstBufferIndex !== -1) {
    const newMessages = allFetched.slice(0, firstBufferIndex);
    const bufferMessages = allFetched.slice(firstBufferIndex, firstBufferIndex + bufferSize);
    return {
      newMessages,
      bufferMessages,
      allMessages: [...newMessages, ...bufferMessages]
    };
  }

  // Fallback nếu không khớp mốc đệm: lấy top email
  return {
    newMessages: allFetched.slice(0, Math.max(10, bufferSize)),
    bufferMessages: [],
    allMessages: allFetched.slice(0, Math.max(10, bufferSize))
  };
}

/**
 * Lấy danh sách email từ Gmail API có phân trang (dùng cho Full Scan lần đầu)
 */
async function fetchAllMessagesMatchingQuery(accessToken: string, query: string, maxMessages = 200): Promise<Array<{ id: string }>> {
  let messages: Array<{ id: string }> = [];
  let pageToken: string | undefined = undefined;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "100");
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
      messages.push(...data.messages);
    }

    pageToken = data.nextPageToken;
  } while (pageToken && messages.length < maxMessages);

  return messages;
}

/**
 * Đọc chi tiết từng email và trích xuất Order, Tracking, Provider kèm Header (song song 10 thư/lần)
 */
async function fetchOrderDetailsFromMessages(accessToken: string, messages: Array<{ id: string }>): Promise<ExtractedEmailOrder[]> {
  const orders: ExtractedEmailOrder[] = [];
  const chunkSize = 10;

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
      } catch {
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
    const res = await fetch(metaUrl, {
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

  const res = await fetch(url, {
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

/**
 * Cập nhật Cột Z (Tracking) và Cột AC (Provider) cho các dòng khớp
 */
async function updateSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabTitle: string,
  updates: Array<{ rowNumber: number; trackingNumber: string; deliveryCompany: string }>
): Promise<number> {
  if (updates.length === 0) return 0;

  const dataPayload = [];
  for (const up of updates) {
    // Cập nhật Cột Z
    if (up.trackingNumber) {
      dataPayload.push({
        range: `'${tabTitle}'!Z${up.rowNumber}`,
        values: [[up.trackingNumber]]
      });
    }
    // Cập nhật Cột AC
    if (up.deliveryCompany) {
      dataPayload.push({
        range: `'${tabTitle}'!AC${up.rowNumber}`,
        values: [[up.deliveryCompany]]
      });
    }
  }

  if (dataPayload.length === 0) return 0;

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const res = await fetch(batchUrl, {
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

  const clientConfig = loadClientConfig();
  const state = loadSyncState();

  const bufferSize = options.bufferSize || state.bufferSize || 4;
  state.bufferSize = bufferSize;

  console.log(`- Trạng thái: ${state.firstRunCompleted ? "Chạy định kỳ (Incremental với Bộ đệm)" : "Lần chạy đầu tiên (Full Scan từ 01/09)"}`);
  console.log(`- Kích thước bộ đệm (Buffer Size): ${bufferSize} email (cấu hình qua cờ --buffer=<số>)`);

  // 1. Xác định Query Gmail
  let gmailQuery = 'from:shein (subject:"shipped" OR subject:"order")';
  if (!state.firstRunCompleted) {
    gmailQuery += " after:2026/08/31";
  }

  // 2. Thu thập email từ tài khoản Gmail luongbui25072008@gmail.com
  console.log(`\n[Bước 1] Đang đọc hộp thư Gmail của: ${GMAIL_SOURCE_ACCOUNT}...`);
  const gmailAccessToken = await getValidAccessToken(clientConfig, GMAIL_SOURCE_ACCOUNT);

  let newMessages: Array<{ id: string }> = [];
  let bufferMessages: Array<{ id: string }> = [];
  let messagesToFetch: Array<{ id: string }> = [];

  if (state.firstRunCompleted && state.lastProcessedMessageIds.length > 0) {
    console.log(`- Nạp ${state.lastProcessedMessageIds.length} ID mốc đệm từ lần chạy trước: ${state.lastProcessedMessageIds.join(", ")}`);
    const fetched = await fetchMessagesWithBufferStrategy(
      gmailAccessToken,
      gmailQuery,
      state.lastProcessedMessageIds,
      bufferSize
    );
    newMessages = fetched.newMessages;
    bufferMessages = fetched.bufferMessages;
    messagesToFetch = fetched.allMessages;

    console.log(`\n----------------------------------------------------------------`);
    console.log(`📦 KẾT QUẢ PHÂN TÁCH BỘ ĐỆM:`);
    console.log(`  * Số email MỚI phát hiện:        ${newMessages.length}`);
    console.log(`  * Số email ĐỆM cần kiểm tra lại: ${bufferMessages.length}`);
    console.log(`  * Tổng số email cần xử lý:      ${messagesToFetch.length}`);
    console.log(`----------------------------------------------------------------`);
  } else {
    // Lần đầu tiên: Full scan
    const all = await fetchAllMessagesMatchingQuery(gmailAccessToken, gmailQuery, 250);
    newMessages = all;
    bufferMessages = [];
    messagesToFetch = all;
    console.log(`- Quét toàn bộ: tìm thấy ${all.length} email SHEIN từ 01/09.`);
  }

  if (messagesToFetch.length === 0) {
    console.log("Không có email nào cần xử lý. Kết thúc chu kỳ.");
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
  const sheetsToken = await getValidAccessToken(clientConfig, SHEETS_TARGET_ACCOUNT);
  const tabTitle = await resolveTabTitle(sheetsToken, SPREADSHEET_ID, TARGET_GID);
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
  const newestProcessedOrders = allOrders.slice(0, bufferSize);
  const nextBufferMessages: BufferMessageInfo[] = newestProcessedOrders.map(o => ({
    id: o.messageId || "",
    orderNumber: o.orderNumber,
    trackingNumber: o.trackingNumber,
    deliveryCompany: o.deliveryCompany,
    providerId: o.providerId,
    subject: o.subject,
    date: o.date
  })).filter(b => b.id.length > 0);

  if (!options.dryRun) {
    state.firstRunCompleted = true;
    state.bufferSize = bufferSize;
    state.lastRunTimestamp = new Date().toISOString();
    state.lastProcessedMessageIds = nextBufferMessages.map(b => b.id);
    state.lastBufferMessages = nextBufferMessages;
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
    state.lastProcessedMessageIds = [];
    state.lastBufferMessages = [];
    saveSyncState(state);
  }

  if (isSchedule) {
    startSchedule(intervalHours, { dryRun: isDryRun, bufferSize });
  } else {
    await executeSyncCycle({ dryRun: isDryRun, bufferSize });
  }
}

main().catch((err) => {
  console.error("\n❌ [Lỗi]:", err.message);
  process.exit(1);
});
