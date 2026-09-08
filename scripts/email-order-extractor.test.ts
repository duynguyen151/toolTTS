import { describe, it, expect } from "vitest";
import { extractEmailOrderDetails, formatOrderDisplayText } from "./email-order-extractor.mts";

describe("Email Order Extractor & Buffer Details", () => {
  it("extracts Order, Tracking, and Provider for Gofo shipping email", () => {
    const rawText = `
      Hi John,
      Your SHEIN order has been shipped!
      Order number: GSU1SN57100246A
      Tracking number: GFUS01071272984773
      Delivery company: Gofo
      Estimated delivery date: Sep 15, 2026
    `;

    const extracted = extractEmailOrderDetails(rawText);
    expect(extracted.orderNumber).toBe("GSU1SN57100246A");
    expect(extracted.trackingNumber).toBe("GFUS01071272984773");
    expect(extracted.deliveryCompany).toBe("Gofo");
    expect(extracted.providerId).toBe("7352739623900022544");
    expect(extracted.customerName).toBe("John");
  });

  it("extracts SpeedX tracking and normalizes provider from tracking link", () => {
    const rawText = `
      Order number: GSU1SC40M002WSV
      Track your package: https://tracking.speedx.io/track?tracking_no=SPXDFW005672609080003764
      Delivery company: SpeedX
    `;

    const extracted = extractEmailOrderDetails(rawText);
    expect(extracted.orderNumber).toBe("GSU1SC40M002WSV");
    expect(extracted.trackingNumber).toBe("SPXDFW005672609080003764");
    expect(extracted.deliveryCompany).toBe("SpeedX");
    expect(extracted.providerId).toBe("7325327335803406082");
  });

  it("handles order confirmation emails with no tracking yet", () => {
    const rawText = `
      Hi Alice,
      Thank you for your order!
      Order ID: GSU1SC50M0004L3
      We will notify you when it ships.
    `;

    const extracted = extractEmailOrderDetails(rawText);
    expect(extracted.orderNumber).toBe("GSU1SC50M0004L3");
    expect(extracted.trackingNumber).toBeNull();
    expect(extracted.deliveryCompany).toBeNull();
  });

  it("formats order display text clearly with Order, Tracking, and Delivery company", () => {
    const order = {
      orderNumber: "GSU1SN57100246A",
      trackingNumber: "GFUS01071272984773",
      deliveryCompany: "Gofo",
      providerId: "7352739623900022544",
      customerName: "John"
    };

    const formatted = formatOrderDisplayText(order, 1);
    expect(formatted).toContain("[ĐƠN HÀNG #1]");
    expect(formatted).toContain("Order number:     GSU1SN57100246A");
    expect(formatted).toContain("Tracking number:  GFUS01071272984773");
    expect(formatted).toContain("Delivery company: Gofo (Provider ID: 7352739623900022544)");
  });
});
