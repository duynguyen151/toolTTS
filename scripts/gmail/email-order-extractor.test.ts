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

  it("extracts Gofo provider and tracking from the SHEIN tracking URL", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC40M002WSX
      Track your package: https://www.gofo.com/us/track?searchID=GFUS01072393427136?url_from=notification_SE_US
    `);

    expect(extracted.trackingNumber).toBe("GFUS01072393427136");
    expect(extracted.deliveryCompany).toBe("Gofo");
    expect(extracted.providerId).toBe("7352739623900022544");
  });

  it("prefers the provider label over the tracking URL provider", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC40M002WSW
      Tracking number: 12345
      Logistics Provider: USPS
      Track: https://tracking.speedx.io/track?tracking_no=12345
    `);

    expect(extracted.deliveryCompany).toBe("USPS");
    expect(extracted.providerId).toBe("7117858858072016686");
  });

  it("extracts USPS tracking from the HTML link used by SHEIN", () => {
    const html = ["Order number: GSU1S3581000JP5 Tracking number <a href=\"https://tools.usps.com/go/TrackConfirmAction?tLabels=9261290347969270498397\">9261290347969270498397</a> View Details on USPS Delivery company:", "<a>USPS</a>", "View Details"].join("\n");

    const extracted = extractEmailOrderDetails("", html);

    expect(extracted.orderNumber).toBe("GSU1S3581000JP5");
    expect(extracted.trackingNumber).toBe("9261290347969270498397");
    expect(extracted.deliveryCompany).toBe("USPS");
  });

  it("extracts YunExpress tracking without requiring a colon", () => {
    const rawText = "Order number: GSU1S417N00M6XA Tracking number YT2625401001269647 View Details on YunExpress Delivery company: YunExpress";

    const extracted = extractEmailOrderDetails(rawText);

    expect(extracted.orderNumber).toBe("GSU1S417N00M6XA");
    expect(extracted.trackingNumber).toBe("YT2625401001269647");
    expect(extracted.deliveryCompany).toBe("YunExpress");
  });

  it("parses HTML when Gmail places it in the raw body field", () => {
    const htmlBody = [
      "Order number: GSU1S446N000ACN Tracking number",
      "<a href=\"https://tools.usps.com/go/TrackConfirmAction?tLabels=9361210739100038934120\">9361210739100038934120</a>",
      "Delivery company:",
      "<a>USPS</a>",
      "View Details"
    ].join("\n");

    const extracted = extractEmailOrderDetails(htmlBody);

    expect(extracted.orderNumber).toBe("GSU1S446N000ACN");
    expect(extracted.trackingNumber).toBe("9361210739100038934120");
    expect(extracted.deliveryCompany).toBe("USPS");
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

  it("extracts Logistics Provider and a short UniUni tracking value", () => {
    const rawText = `
      Order number: GSU1S142500MKJG
      Parcel ID: UUS6981970021236791
      Logistics Provider: UniUni
      View Details
    `;

    const extracted = extractEmailOrderDetails(rawText);

    expect(extracted.trackingNumber).toBe("UUS6981970021236791");
    expect(extracted.deliveryCompany).toBe("UniUni");
    expect(extracted.providerId).toBe("7352738314622863120");
  });

  it("accepts a numeric Parcel ID when the email supplies the provider", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1RV21X00MUSN
      Parcel ID: 876458058248
      Logistics Provider: USPS
      Shipping address: hidden
    `);

    expect(extracted.trackingNumber).toBe("876458058248");
    expect(extracted.deliveryCompany).toBe("USPS");
    expect(extracted.providerId).toBe("7117858858072016686");
  });

  it("accepts labeled tracking values without provider-specific length rules", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC07200M66V
      Tracking ID: UUS12345
      Logistics Provider: UniUni
    `);

    expect(extracted.trackingNumber).toBe("UUS12345");
    expect(extracted.deliveryCompany).toBe("UniUni");
  });

  it("accepts a non-empty labeled tracking value even when it is very short", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC07200M66X
      Parcel ID: 7
      Logistics Provider: USPS
    `);

    expect(extracted.trackingNumber).toBe("7");
    expect(extracted.deliveryCompany).toBe("USPS");
  });

  it("does not include SHEIN URL metadata in a USPS tracking number", () => {
    const html = `
      Order number: GSU1S3581000JP6
      Tracking number <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9300120842400023638571?url_from=notification_SE_US">9300120842400023638571</a>
      Delivery company: USPS
    `;

    expect(extractEmailOrderDetails("", html).trackingNumber).toBe("9300120842400023638571");
  });

  it("accepts punctuation in an explicitly labeled tracking value", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC07200M77W
      Tracking number: ABC/12.34-X
      Logistics Provider: Gofo
    `);

    expect(extracted.trackingNumber).toBe("ABC/12.34-X");
    expect(extracted.deliveryCompany).toBe("Gofo");
  });

  it("does not infer a provider from the tracking shape", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1SC07200M77X
      Tracking number: UUS12345
    `);

    expect(extracted.trackingNumber).toBe("UUS12345");
    expect(extracted.deliveryCompany).toBeNull();
    expect(extracted.providerId).toBeNull();
  });

  it("does not turn tracking placeholders into tracking values", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1S402T002CBW
      Tracking number: will be provided later
      Logistics Provider: USPS
    `);

    expect(extracted.trackingNumber).toBeNull();
    expect(extracted.deliveryCompany).toBe("USPS");
  });

  it("does not extract the word tracking from a full placeholder sentence", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1S402T002CBX
      Tracking ID: tracking will be provided later
      Logistics Provider: USPS
    `);

    expect(extracted.trackingNumber).toBeNull();
  });

  it("does not extract a conjunction from tracking information prose", () => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1S402T002CBY
      Tracking number and shipping information will be provided later
    `);

    expect(extracted.trackingNumber).toBeNull();
  });

  it.each(["N/A", "not available"])('does not extract the placeholder "%s"', (placeholder) => {
    const extracted = extractEmailOrderDetails(`
      Order number: GSU1S402T002CBZ
      Tracking ID: ${placeholder}
    `);

    expect(extracted.trackingNumber).toBeNull();
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
