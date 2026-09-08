import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

const REPO_ROOT = process.cwd();
const OAUTH_DIR = path.join(REPO_ROOT, "OauthGoogle");
const TOKEN_PATH = path.join(OAUTH_DIR, "gmail-token.json");

function loadClientConfig() {
  const files = fs.readdirSync(OAUTH_DIR);
  const secretFile = files.find(f => f.startsWith("client_secret_") && f.endsWith(".json"));
  if (!secretFile) {
    throw new Error(`Không tìm thấy file client_secret_*.json trong ${OAUTH_DIR}`);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(OAUTH_DIR, secretFile), "utf8"));
  return raw.installed || raw.web;
}

export async function exchangeCodeForTokens(inputUrlOrCode: string, redirectUri = "http://localhost") {
  const trimmed = inputUrlOrCode.trim();
  let code = trimmed;
  let resolvedRedirectUri = redirectUri;

  // Nếu người dùng dán cả URL: http://localhost/?code=4/0A... hoặc http://localhost:3000/?code=4/0A...
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsedUrl = new URL(trimmed);
      const extractedCode = parsedUrl.searchParams.get("code");
      if (extractedCode) {
        code = extractedCode;
      }
      // Lấy chính origin + pathname làm redirect_uri (bỏ query parameters)
      resolvedRedirectUri = `${parsedUrl.origin}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`;
      if (resolvedRedirectUri.endsWith("/")) {
        resolvedRedirectUri = resolvedRedirectUri.slice(0, -1);
      }
      if (resolvedRedirectUri === "http://localhost") {
        resolvedRedirectUri = "http://localhost";
      }
    } catch {
      // fallback giữ nguyên
    }
  }

  // URL decode code nếu có ký tự %2F hoặc %
  try {
    code = decodeURIComponent(code);
  } catch {
    // giữ nguyên
  }

  const client = loadClientConfig();
  console.log("[OAuth Exchange] Đang gửi yêu cầu đổi token tới Google...");
  console.log(`- Redirect URI: ${resolvedRedirectUri}`);
  console.log(`- Mã Code: ${code.slice(0, 10)}... (độ dài: ${code.length})`);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: resolvedRedirectUri
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    // Nếu lỗi mismatch redirect_uri, thử lại với http://localhost
    if (resolvedRedirectUri !== "http://localhost") {
      console.log(`[Thử lại] Đổi token với redirect_uri="http://localhost"...`);
      const retryRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          code,
          grant_type: "authorization_code",
          redirect_uri: "http://localhost"
        })
      });
      if (retryRes.ok) {
        return await handleSuccessToken(await retryRes.json());
      }
    }
    throw new Error(`Đổi token thất bại từ Google: ${errText}`);
  }

  return await handleSuccessToken(await res.json());
}

async function handleSuccessToken(tokenData: any) {
  const tokenRecord: any = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    scope: tokenData.scope,
    token_type: tokenData.token_type,
    expiry_date: Date.now() + (tokenData.expires_in ?? 3600) * 1000
  };

  // Lấy email của tài khoản
  let email = "unknown";
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenRecord.access_token}` }
    });
    if (userRes.ok) {
      const userInfo = await userRes.json() as any;
      email = userInfo.email ?? "unknown";
      tokenRecord.email = email;
      console.log(`\n✅ [Xác thực tài khoản] Email: ${userInfo.email} (${userInfo.name ?? "N/A"})`);
    }
  } catch {}

  // 1. Lưu token chung mới nhất
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenRecord, null, 2), "utf8");
  console.log(`✅ [THÀNH CÔNG] Đã cập nhật token tại: ${TOKEN_PATH}`);

  // 2. Lưu token riêng theo từng tài khoản
  const tokensDir = path.join(OAUTH_DIR, "tokens");
  if (!fs.existsSync(tokensDir)) {
    fs.mkdirSync(tokensDir, { recursive: true });
  }
  const accountTokenPath = path.join(tokensDir, `gmail-token-${email}.json`);
  fs.writeFileSync(accountTokenPath, JSON.stringify(tokenRecord, null, 2), "utf8");
  console.log(`✅ [LƯU BẢO LƯU TÀI KHOẢN] Đã lưu riêng tại: ${accountTokenPath}`);

  return tokenRecord;
}

// Chạy trực tiếp từ CLI nếu có đối số
const arg = process.argv[2];
if (arg) {
  exchangeCodeForTokens(arg)
    .then(() => console.log("\nSẵn sàng chạy đọc Gmail bằng lệnh: pnpm exec tsx scripts/gmail-api-reader.mts"))
    .catch((err) => {
      console.error("\n❌ [Lỗi]:", err.message);
      process.exit(1);
    });
}
