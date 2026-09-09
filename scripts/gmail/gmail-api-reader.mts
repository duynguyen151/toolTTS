import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { URL } from "node:url";
import { extractEmailOrderDetails, formatOrderDisplayText, type ExtractedEmailOrder } from "./email-order-extractor.mts";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const REPO_ROOT = process.cwd();
const OAUTH_DIR = path.join(REPO_ROOT, "OauthGoogle");
const TOKEN_PATH = path.join(OAUTH_DIR, "gmail-token.json");

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

interface StoredToken {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number; // timestamp in ms
}

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body?: {
    data?: string;
    size?: number;
  };
  parts?: GmailMessagePart[];
}

interface GmailMessageDetail {
  id: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailMessageHeader[];
    body?: {
      data?: string;
    };
    parts?: GmailMessagePart[];
  };
}

/**
 * Tìm file client_secret_*.json trong thư mục OauthGoogle
 */
function findClientSecretFile(): string {
  if (!fs.existsSync(OAUTH_DIR)) {
    throw new Error(`Thư mục ${OAUTH_DIR} không tồn tại. Vui lòng tạo thư mục và cung cấp file client secret.`);
  }

  const files = fs.readdirSync(OAUTH_DIR);
  const secretFile = files.find(f => f.startsWith("client_secret_") && f.endsWith(".json"));
  if (!secretFile) {
    // Thử tìm bất kỳ file secret nào
    const anySecret = files.find(f => f.toLowerCase().includes("secret") && f.endsWith(".json"));
    if (anySecret) return path.join(OAUTH_DIR, anySecret);
    throw new Error(`Không tìm thấy file client_secret_*.json trong ${OAUTH_DIR}. Vui lòng sao chép file OAuth client của bạn vào đây.`);
  }
  return path.join(OAUTH_DIR, secretFile);
}

/**
 * Đọc cấu hình client_secret
 */
function loadClientConfig(): OAuthClientConfig {
  // Có thể dùng qua biến môi trường nếu có
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return {
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      redirect_uris: ["http://localhost:3000", "http://localhost"]
    };
  }

  const secretPath = findClientSecretFile();
  const raw = JSON.parse(fs.readFileSync(secretPath, "utf8"));
  const config = raw.installed || raw.web;
  if (!config) {
    throw new Error(`Cấu hình OAuth trong ${secretPath} không hợp lệ (thiếu key 'installed' hoặc 'web').`);
  }
  return config;
}

/**
 * Danh sách tài khoản đã cấp quyền trong OauthGoogle/tokens/
 */
export function getSavedAccounts(): string[] {
  const tokensDir = path.join(OAUTH_DIR, "tokens");
  if (!fs.existsSync(tokensDir)) return [];
  return fs.readdirSync(tokensDir)
    .filter(f => f.startsWith("gmail-token-") && f.endsWith(".json"))
    .map(f => f.replace("gmail-token-", "").replace(".json", ""));
}

/**
 * Đọc token đã lưu (hỗ trợ chỉ định email tài khoản cụ thể)
 */
function loadStoredToken(accountEmail?: string): StoredToken | null {
  if (accountEmail) {
    const specificPath = path.join(OAUTH_DIR, "tokens", `gmail-token-${accountEmail}.json`);
    if (fs.existsSync(specificPath)) {
      try { return JSON.parse(fs.readFileSync(specificPath, "utf8")); } catch { return null; }
    }
  }

  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Lưu token
 */
function saveToken(token: StoredToken, accountEmail?: string): void {
  if (!fs.existsSync(OAUTH_DIR)) {
    fs.mkdirSync(OAUTH_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf8");

  const email = accountEmail || (token as any).email;
  if (email) {
    const tokensDir = path.join(OAUTH_DIR, "tokens");
    if (!fs.existsSync(tokensDir)) fs.mkdirSync(tokensDir, { recursive: true });
    const accPath = path.join(tokensDir, `gmail-token-${email}.json`);
    fs.writeFileSync(accPath, JSON.stringify(token, null, 2), "utf8");
  }
}

/**
 * Refresh Access Token nếu đã hết hạn
 */
async function refreshAccessToken(client: OAuthClientConfig, token: StoredToken, accountEmail?: string): Promise<string> {
  if (!token.refresh_token) {
    throw new Error("Token đã hết hạn và không có refresh_token. Vui lòng cấp quyền lại.");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token"
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Lỗi khi refresh Google Access Token: ${errText}`);
  }

  const data = await res.json() as any;
  token.access_token = data.access_token;
  token.expiry_date = Date.now() + (data.expires_in ?? 3600) * 1000;
  saveToken(token, accountEmail);
  return token.access_token;
}

/**
 * Đảm bảo access token hợp lệ cho một tài khoản
 */
export async function getValidAccessToken(client: OAuthClientConfig, accountEmail?: string): Promise<string> {
  const token = loadStoredToken(accountEmail);
  if (!token) {
    throw new Error(`Chưa có token xác thực cho ${accountEmail ?? "tài khoản này"}.`);
  }

  if (token.expiry_date && token.expiry_date > Date.now() + 60_000) {
    return token.access_token;
  }

  console.log(`[Gmail API] Access token của ${accountEmail ?? "tài khoản"} đã hết hạn, đang tự động refresh...`);
  return await refreshAccessToken(client, token, accountEmail);
}

/**
 * Quy trình xác thực OAuth 2.0 (mở trình duyệt / local server callback)
 */
async function authorizeFlow(client: OAuthClientConfig, targetEmail?: string): Promise<void> {
  const redirectUri = "http://localhost:3000";
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  if (targetEmail) {
    authUrl.searchParams.set("login_hint", targetEmail);
  }

  console.log("\n=======================================================");
  console.log("XÁC THỰC GOOGLE GMAIL API OAUTH 2.0");
  console.log("=======================================================");
  console.log("Vui lòng mở đường link sau trên trình duyệt để cấp quyền đọc Gmail:");
  console.log(`\n${authUrl.toString()}\n`);
  console.log("Đang chờ callback tại http://localhost:3000 ...");
  console.log("(Hoặc bạn có thể dán mã code sau khi chuyển hướng vào đây nếu server không nhận)");
  console.log("=======================================================\n");

  const codePromise = new Promise<string>((resolve, reject) => {
    let resolved = false;

    // 1. Dựng local server bắt callback
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? "/", "http://localhost:3000");
        const code = reqUrl.searchParams.get("code");
        if (code) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h3>Xác thực Google Gmail thành công!</h3><p>Bạn có thể đóng tab này và quay lại terminal.</p>");
          server.close();
          if (!resolved) {
            resolved = true;
            resolve(code);
          }
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h3>Không tìm thấy code xác thực trong callback URL.</h3>");
        }
      } catch (e) {
        // ignore
      }
    });

    server.listen(3000, () => {}).on("error", () => {
      // Port 3000 bận, chuyển sang nhập code thủ công
    });

    // 2. Nhập code thủ công từ console nếu cần
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Nhập mã Code (nếu copy thủ công): ", (manualCode) => {
      rl.close();
      if (!resolved && manualCode.trim()) {
        resolved = true;
        server.close();
        resolve(manualCode.trim());
      }
    });
  });

  const code = await codePromise;
  console.log("\nĐang đổi authorization code lấy access & refresh token...");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Đổi token thất bại: ${errText}`);
  }

  const tokenData = await tokenRes.json() as any;
  const stored: StoredToken = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    token_type: tokenData.token_type,
    expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000
  };

  saveToken(stored);
  console.log(`[Thành công] Đã lưu token an toàn vào: ${TOKEN_PATH}\n`);
}

/**
 * Giải mã Base64URL trong Gmail API Payload
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

/**
 * Lấy nội dung text và HTML từ payload message
 */
function extractBodyContent(payload: GmailMessageDetail["payload"]): { rawText: string; htmlContent: string } {
  let rawText = "";
  let htmlContent = "";

  function traverseParts(parts?: GmailMessagePart[]) {
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

  if (payload.body?.data) {
    rawText += decodeBase64Url(payload.body.data);
  }

  traverseParts(payload.parts);
  return { rawText, htmlContent };
}

/**
 * Đọc danh sách và chi tiết email từ Gmail API
 */
async function fetchAndExtractGmailOrders(
  accessToken: string,
  query = 'from:shein (subject:"shipped" OR subject:"order")',
  maxResults = 10
): Promise<Array<{ id: string; subject: string; date: string; order: ExtractedEmailOrder }>> {
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Gmail API list messages error: ${err}`);
  }

  const listData = await listRes.json() as any;
  const messages = listData.messages as Array<{ id: string }> | undefined;

  if (!messages || messages.length === 0) {
    console.log(`[Gmail API] Không tìm thấy email nào khớp với query: "${query}"`);
    return [];
  }

  console.log(`[Gmail API] Tìm thấy ${messages.length} email. Đang đọc chi tiết và trích xuất...\n`);
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const msgId = messages[i].id;
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`;
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!msgRes.ok) continue;
    const msg = await msgRes.json() as GmailMessageDetail;

    const headers = msg.payload?.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "No Subject";
    const date = headers.find(h => h.name.toLowerCase() === "date")?.value || "";

    const { rawText, htmlContent } = extractBodyContent(msg.payload);
    const order = extractEmailOrderDetails(rawText || msg.snippet, htmlContent);

    results.push({
      id: msgId,
      subject,
      date,
      order
    });
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const isAuthOnly = args.includes("--auth");
  const isJson = args.includes("--json");
  const isAll = args.includes("--all");
  const isListAccounts = args.includes("--list-accounts") || args.includes("--accounts");
  const accountArg = args.find(a => a.startsWith("--account="))?.split("=")[1];
  const emailArg = args.find(a => a.startsWith("--email="))?.split("=")[1];
  const queryArg = args.find(a => a.startsWith("--query="))?.split("=")[1] || 'from:shein (subject:"shipped" OR subject:"order")';
  const maxArg = parseInt(args.find(a => a.startsWith("--max="))?.split("=")[1] || "5", 10);

  if (isListAccounts) {
    const accounts = getSavedAccounts();
    console.log(`\nDANH SÁCH TÀI KHOẢN ĐÃ CẤP QUYỀN GMAIL API (${accounts.length}):`);
    accounts.forEach((acc, idx) => console.log(`  ${idx + 1}. ${acc}`));
    console.log("");
    return;
  }

  const clientConfig = loadClientConfig();

  if (isAuthOnly || !fs.existsSync(TOKEN_PATH)) {
    await authorizeFlow(clientConfig, emailArg || accountArg);
    if (isAuthOnly) return;
  }

  const savedAccounts = getSavedAccounts();
  const accountsToProcess: string[] = [];

  if (isAll) {
    accountsToProcess.push(...savedAccounts);
    if (accountsToProcess.length === 0) {
      console.log("Chưa có tài khoản nào được lưu.");
      return;
    }
  } else if (accountArg) {
    accountsToProcess.push(accountArg);
  } else if (savedAccounts.length > 0) {
    accountsToProcess.push(savedAccounts[0]);
  } else {
    accountsToProcess.push("default");
  }

  const allResults: Record<string, any[]> = {};

  for (const acc of accountsToProcess) {
    try {
      const accessToken = await getValidAccessToken(clientConfig, acc === "default" ? undefined : acc);
      const items = await fetchAndExtractGmailOrders(accessToken, queryArg, maxArg);
      allResults[acc] = items;

      if (!isJson) {
        console.log(`\n==================================================`);
        console.log(`KẾT QUẢ ĐỌC GMAIL API CHO: ${acc} (Số lượng: ${items.length})`);
        console.log(`Query: ${queryArg}`);
        console.log(`==================================================\n`);

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          console.log(`[Thư #${i + 1}] ID: ${item.id} | Tiêu đề: ${item.subject}`);
          console.log(`Thời gian: ${item.date}`);
          console.log(formatOrderDisplayText(item.order, i + 1));
          console.log("");
        }
      }
    } catch (e: any) {
      console.error(`❌ Lỗi khi đọc tài khoản ${acc}:`, e.message);
    }
  }

  if (isJson) {
    console.log(JSON.stringify(allResults, null, 2));
  }
}

import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase().includes(path.basename(process.argv[1]).toLowerCase())) {
  main().catch((err) => {
    console.error("\n[Lỗi]:", err.message);
    process.exit(1);
  });
}
