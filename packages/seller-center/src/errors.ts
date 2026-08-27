export type SellerCenterFailureType =
  | "ADSPOWER_UNAVAILABLE"
  | "PROFILE_START_FAILED"
  | "BROWSER_DISCONNECTED"
  | "PROXY_TIMEOUT"
  | "LOGIN_REQUIRED"
  | "CHALLENGE_REQUIRED"
  | "AUTH_FAILED"
  | "SHOP_IDENTITY_CHANGED"
  | "LAYOUT_CHANGED"
  | "ROUTE_CHANGED"
  | "ENDPOINT_NOT_OBSERVED"
  | "API_SCHEMA_CHANGED"
  | "API_REJECTED"
  | "INCOMPLETE_RESPONSE"
  | "SOURCE_TIMEOUT";

export class SellerCenterError extends Error {
  constructor(
    readonly failureType: SellerCenterFailureType,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SellerCenterError";
  }
}
