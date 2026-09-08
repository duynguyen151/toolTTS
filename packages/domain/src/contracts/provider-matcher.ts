export type ProviderRegion = "US" | "UK";

export interface ProviderCatalogItem {
  id?: string | undefined;
  providerId: string;
  carrierName: string;
  region: ProviderRegion;
  isActive?: boolean | undefined;
}

export interface ProviderRuleItem {
  id?: string | undefined;
  region: ProviderRegion;
  prefix: string;
  trackingLength?: number | null | undefined;
  charsetPattern?: string | null | undefined;
  providerId: string;
  version?: number | undefined;
  isActive?: boolean | undefined;
}

export type ProviderMatchStatus = "MATCHED" | "AMBIGUOUS" | "NOT_PROVEN_SUPPORTED";

export interface ProviderMatchSuccess {
  status: "MATCHED";
  providerId: string;
  carrierName?: string | undefined;
  ruleId?: string | undefined;
  prefix: string;
}

export interface ProviderMatchAmbiguous {
  status: "AMBIGUOUS";
  candidateProviderIds: string[];
  reason: string;
}

export interface ProviderMatchUnsupported {
  status: "NOT_PROVEN_SUPPORTED";
  reason: string;
}

export type ProviderMatchResult =
  | ProviderMatchSuccess
  | ProviderMatchAmbiguous
  | ProviderMatchUnsupported;
