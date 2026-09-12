import { SEED_PROVIDER_CATALOG } from "../../packages/domain/src/provider-matcher.js";

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

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\u200b|\uFEFF/g, " ");
}

function cleanProviderName(value: string): string {
  return value
    .replace(/\s*(?:View Details|View More)\s*>?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTrackingNumber(value: string | null | undefined): string | null {
  const tracking = value?.trim() ?? "";
  if (!tracking || tracking.length > 200 || /[\x00-\x1f\x7f]/.test(tracking)) return null;
  if (/^(?:and|n\/?a|none|not|tracking|will|later|pending|unknown|unavailable|provided|not\s+available)$/i.test(tracking)) return null;
  return tracking;
}

function normalizeProviderValue(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function providerFromTrackingUrl(url: string | null): string | null {
  if (!url) return null;
  if (/tracking\.speedx\.io/i.test(url)) return "SpeedX";
  if (/tools\.usps\.com/i.test(url)) return "USPS";
  if (/uniuni\.com/i.test(url)) return "UniUni";
  if (/gofo\.com/i.test(url)) return "Gofo";
  return null;
}

/**
 * Trích xuất chuẩn hóa 3 keyword chính:
 * 1. Order number
 * 2. Tracking number
 * 3. Delivery company (chính là provider)
 */
export function extractEmailOrderDetails(rawText: string, htmlContent = ""): ExtractedEmailOrder {
  const combined = `${rawText}\n${htmlContent}`;
  const searchableText = stripHtmlTags(rawText) + "\n" + stripHtmlTags(htmlContent);

  // 1. Trích xuất Order Number
  // Mẫu: Order number: GSU1SC10M001EJL hoặc GSU...
  let orderNumber: string | null = null;
  const orderRegexes = [
    /Order\s*(?:number|#|ID|No\.?):\s*([A-Z0-9_-]+)/i,
    /\b(GSU[A-Z0-9]{10,22})\b/i,
    /Mã\s*(?:đơn|đơn\s*hàng):\s*([A-Z0-9_-]+)/i
  ];
  for (const reg of orderRegexes) {
    const match = searchableText.match(reg);
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
  const trackingLinkMatch = combined.match(/https?:\/\/(?:tracking\.speedx\.io|tools\.usps\.com|www\.uniuni\.com|www\.gofo\.com)[^\s"'<>]+/i);
  if (trackingLinkMatch) {
    trackingUrl = trackingLinkMatch[0];
    const urlCodeMatch = trackingUrl.match(/[?&](?:track(?:ing)?(?:_?no)?|searchID)=([^?&#\s"'<>]+)/i);
    if (urlCodeMatch) {
      trackingNumber = cleanTrackingNumber(urlCodeMatch[1]);
    }
  }

  if (!trackingNumber) {
    const uspsLinkMatch = combined.match(/[?&]tLabels=([^?&#\s"'<>]+)/i);
    if (uspsLinkMatch) trackingNumber = cleanTrackingNumber(uspsLinkMatch[1]);
  }

  if (!trackingNumber) {
    const trackingRegexes = [
      /(?:Tracking\s*(?:number|#|ID|code)|Parcel\s*ID)\s*:?\s*([^\s<>"']{1,200})/i,
      /Mã\s*vận\s*đơn\s*:?\s*([^\s<>"']{1,200})/i,
      /\b((?:SPX|UUS|GFU|YT)[A-Z0-9_-]{1,197})\b/i,
      /\b(9\d{19,21})\b/
    ];
    for (const reg of trackingRegexes) {
      const match = searchableText.match(reg);
      if (match && match[1]) {
        trackingNumber = cleanTrackingNumber(match[1]);
        if (trackingNumber) break;
      }
    }
  }

  // 3. Trích xuất Delivery Company (Provider)
  let deliveryCompany: string | null = null;
  const carrierRegexes = [
    /(?:Logistics\s*Provider|Delivery\s*company|Shipping\s*carrier|Carrier|Đơn\s*vị\s*vận\s*chuyển)\s*:\s*([^\s<][\s\S]*?)(?=\s+(?:View Details|View More|Shipping address|Estimated delivery date|Track(?:\s+your\s+package)?\s*:|Tracking\s*(?:number|ID|code)|Parcel\s*ID|Order\s*(?:number|ID))|$)/i
  ];
  for (const reg of carrierRegexes) {
    const match = searchableText.match(reg);
    if (match && match[1]) {
      deliveryCompany = cleanProviderName(match[1]);
      break;
    }
  }
  if (!deliveryCompany) deliveryCompany = providerFromTrackingUrl(trackingUrl);

  let providerId: string | null = null;
  if (deliveryCompany) {
    const requestedProvider = normalizeProviderValue(deliveryCompany);
    const matches = SEED_PROVIDER_CATALOG.filter((provider) =>
      provider.region === "US" && provider.isActive !== false &&
      (normalizeProviderValue(provider.carrierName) === requestedProvider ||
        normalizeProviderValue(provider.providerId) === requestedProvider)
    );
    if (matches.length === 1) providerId = matches[0]!.providerId;
  }

  // Các trường bổ sung hỗ trợ
  const greetingMatch = searchableText.match(/Hi\s+([^,\n\r]+),/i);
  const deliveryDateMatch = searchableText.match(/Estimated delivery date:\s*([^\n\r<]+)/i);
  const addressMatch = searchableText.match(/Shipping address:\s*([\s\S]*?)(?:Bật thông báo|\bItem\(s\)\s*shipped|$)/i);

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
