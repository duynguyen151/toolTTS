export type SellerCenterFailureType =
  | "ADSPOWER_UNAVAILABLE"
  | "PROFILE_START_FAILED"
  | "BROWSER_DISCONNECTED"
  | "PROXY_TIMEOUT"
  | "LOGIN_REQUIRED"
  | "CHALLENGE_REQUIRED"
  | "SHOP_IDENTITY_CHANGED"
  | "LAYOUT_CHANGED"
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
