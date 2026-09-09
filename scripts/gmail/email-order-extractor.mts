import {
  matchTrackingToProvider,
  SEED_PROVIDER_CATALOG,
  SEED_PROVIDER_RULES
} from "../../packages/domain/src/provider-matcher.js";

export interface ExtractedEmailOrder {
  orderNumber: string | null;
  trackingNumber: string | null;
  deliveryCompany: string | null;
  providerId?: string | null;
  customerName?: string | null;
  deliveryDate?: string | null;
  shippingAddress?: string | null;
  trackingUrl?: string | null;
  rawSnippet?: string;
  messageId?: string;
  date?: string | null;
  subject?: string | null;
}

/**
 * Trích xuất chuẩn hóa 3 keyword chính:
 * 1. Order number
 * 2. Tracking number
 * 3. Delivery company (chính là provider)
 */
export function extractEmailOrderDetails(rawText: string, htmlContent = ""): ExtractedEmailOrder {
  const combined = `${rawText}\n${htmlContent}`;

  // 1. Trích xuất Order Number
  // Mẫu: Order number: GSU1SC10M001EJL hoặc GSU...
  let orderNumber: string | null = null;
  const orderRegexes = [
    /Order\s*(?:number|#|ID|No\.?):\s*([A-Z0-9_-]+)/i,
    /\b(GSU[A-Z0-9]{10,22})\b/i,
    /Mã\s*(?:đơn|đơn\s*hàng):\s*([A-Z0-9_-]+)/i
  ];
  for (const reg of orderRegexes) {
    const match = rawText.match(reg) || htmlContent.match(reg);
    if (match && match[1]) {
      orderNumber = match[1].trim();
      break;
    }
  }

  // 2. Trích xuất Tracking Number
  // Mẫu: Tracking number: SPXAUS005672609080003261, SPX..., UUS..., GFU...
  let trackingNumber: string | null = null;
  let trackingUrl: string | null = null;

  // Tìm trong text hoặc link tracking
  const trackingLinkMatch = combined.match(/https?:\/\/(?:tracking\.speedx\.io|tools\.usps\.com|www\.uniuni\.com)[^\s"'<>]+/i);
  if (trackingLinkMatch) {
    trackingUrl = trackingLinkMatch[0];
    const urlCodeMatch = trackingUrl.match(/\b(SPX[A-Z0-9]{18,25})\b/i) || trackingUrl.match(/[?&]track(?:ing)?(?:_?no)?=([A-Z0-9]+)/i);
    if (urlCodeMatch) {
      trackingNumber = urlCodeMatch[1].trim();
    }
  }

  if (!trackingNumber) {
    const trackingRegexes = [
      /\b(SPX[A-Z0-9]{18,25})\b/i,           // SpeedX (US)
      /\b(UUS[A-Z0-9]{20,26})\b/i,           // UniUni (US)
      /\b(GFU[A-Z0-9]{15,20})\b/i,           // Gofo (US)
      /\b(9400\d{18}|9205\d{18})\b/,         // USPS 22-digit
      /Tracking\s*(?:number|#|ID|code):\s*([A-Z0-9]+)/i,
      /Mã\s*vận\s*đơn:\s*([A-Z0-9]+)/i
    ];
    for (const reg of trackingRegexes) {
      const match = rawText.match(reg) || htmlContent.match(reg);
      if (match && match[1]) {
        trackingNumber = match[1].trim();
        break;
      }
    }
  }

  // 3. Trích xuất Delivery Company (Provider)
  let deliveryCompany: string | null = null;
  const carrierRegexes = [
    /Delivery\s*company:\s*([^\n\r<]+)/i,
    /Carrier:\s*([^\n\r<]+)/i,
    /Shipping\s*carrier:\s*([^\n\r<]+)/i,
    /Đơn\s*vị\s*vận\s*chuyển:\s*([^\n\r<]+)/i
  ];
  for (const reg of carrierRegexes) {
    const match = rawText.match(reg) || htmlContent.match(reg);
    if (match && match[1]) {
      deliveryCompany = match[1].trim();
      break;
    }
  }

  // Kiểm tra đối chiếu với provider rules hệ thống
  let providerId: string | null = null;
  if (trackingNumber) {
    const matched = matchTrackingToProvider(trackingNumber, "US", SEED_PROVIDER_RULES, SEED_PROVIDER_CATALOG);
    if (matched.status === "MATCHED") {
      providerId = matched.providerId;
      if (!deliveryCompany || deliveryCompany.toLowerCase() === "unknown") {
        deliveryCompany = matched.carrierName ?? null;
      }
    }
  }

  // Các trường bổ sung hỗ trợ
  const greetingMatch = rawText.match(/Hi\s+([^,\n\r]+),/i);
  const deliveryDateMatch = rawText.match(/Estimated delivery date:\s*([^\n\r<]+)/i);
  const addressMatch = rawText.match(/Shipping address:\s*([\s\S]*?)(?:Bật thông báo|\bItem\(s\)\s*shipped|$)/i);

  return {
    orderNumber,
    trackingNumber,
    deliveryCompany,
    providerId,
    customerName: greetingMatch ? greetingMatch[1].trim() : null,
    deliveryDate: deliveryDateMatch ? deliveryDateMatch[1].trim() : null,
    shippingAddress: addressMatch ? addressMatch[1].trim().replace(/\s*\n\s*/g, ", ") : null,
    trackingUrl,
    rawSnippet: rawText.slice(0, 200).replace(/\s+/g, " ")
  };
}

/**
 * Định dạng xuất text chuẩn, rõ ràng theo đúng yêu cầu:
 * Order number + Tracking number + Delivery company (provider)
 */
export function formatOrderDisplayText(order: ExtractedEmailOrder, index?: number): string {
  const header = index != null ? `[ĐƠN HÀNG #${index}]` : `[CHI TIẾT ĐƠN HÀNG]`;
  return [
    `==================================================`,
    `${header}`,
    `--------------------------------------------------`,
    `Order number:     ${order.orderNumber ?? "N/A"}`,
    `Tracking number:  ${order.trackingNumber ?? "N/A"}`,
    `Delivery company: ${order.deliveryCompany ?? "N/A"} (Provider ID: ${order.providerId ?? "N/A"})`,
    order.customerName ? `Customer:         ${order.customerName}` : null,
    order.deliveryDate ? `Delivery date:    ${order.deliveryDate}` : null,
    `==================================================`
  ].filter(Boolean).join("\n");
}
