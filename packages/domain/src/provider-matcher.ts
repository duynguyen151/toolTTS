import type {
  ProviderCatalogItem,
  ProviderMatchResult,
  ProviderRegion,
  ProviderRuleItem
} from "./contracts/provider-matcher.js";

export const SEED_PROVIDER_CATALOG: ProviderCatalogItem[] = [
  // US
  { providerId: "7117858858072016686", carrierName: "USPS", region: "US", isActive: true },
  { providerId: "7352739623900022544", carrierName: "Gofo", region: "US", isActive: true },
  { providerId: "7352738314622863120", carrierName: "UniUni", region: "US", isActive: true },
  { providerId: "7325327335803406082", carrierName: "SpeedX", region: "US", isActive: true },
  // UK
  { providerId: "6639580521074524161", carrierName: "DHL_UK", region: "UK", isActive: true },
  { providerId: "6599541761693270018", carrierName: "EVRi", region: "UK", isActive: true },
  { providerId: "6671794738251726849", carrierName: "Royal_Mail", region: "UK", isActive: true }
];

export const SEED_PROVIDER_RULES: ProviderRuleItem[] = [
  // US
  { region: "US", prefix: "GFU", trackingLength: 18, providerId: "7352739623900022544", isActive: true },
  { region: "US", prefix: "UUS", trackingLength: 26, providerId: "7352738314622863120", isActive: true },
  { region: "US", prefix: "SPX", trackingLength: 24, providerId: "7325327335803406082", isActive: true },
  // UK
  { region: "UK", prefix: "JJD", trackingLength: 19, providerId: "6639580521074524161", isActive: true },
  { region: "UK", prefix: "H022|H023", trackingLength: 16, providerId: "6599541761693270018", isActive: true },
  { region: "UK", prefix: "HD3|HD5|GV5", trackingLength: 13, providerId: "6671794738251726849", isActive: true }
];

export function matchTrackingToProvider(
  tracking: string | null | undefined,
  region: ProviderRegion,
  rules: ProviderRuleItem[],
  catalog?: ProviderCatalogItem[]
): ProviderMatchResult {
  if (!tracking || typeof tracking !== "string") {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: "Tracking number is empty or not a string"
    };
  }

  const trimmed = tracking.trim();
  if (trimmed.length === 0) {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: "Tracking number is blank"
    };
  }

  // Explicit unproven / replay / placeholder patterns:
  // RELP / Replay, REL, numeric-only -> NOT_PROVEN_SUPPORTED
  if (/^REL/i.test(trimmed)) {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: "Tracking prefix starts with unproven or replay pattern (REL/RELP)"
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: "Numeric-only tracking numbers are not proven supported in V1"
    };
  }

  // Build catalog lookup for region validation — REQUIRED for MATCHED status
  if (!catalog || catalog.length === 0) {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: "Provider catalog is empty or not provided — cannot validate provider"
    };
  }

  const catalogMap = new Map<string, ProviderCatalogItem>(
    catalog
      .filter((c) => c.region === region && c.isActive !== false)
      .map((c) => [c.providerId, c])
  );

  // Filter valid rules for this region
  const applicableRules = rules.filter((rule) => {
    if (rule.region !== region) return false;
    if (rule.isActive === false) return false;
    if (!catalogMap.has(rule.providerId)) {
      return false; // Rule references a provider ID not in catalog or not active for this region
    }
    return true;
  });

  const upperTracking = trimmed.toUpperCase();
  const matchedRules: { rule: ProviderRuleItem; matchedPrefix: string }[] = [];

  for (const rule of applicableRules) {
    // Prefix may be pipe-separated
    const prefixes = rule.prefix.split("|").map((p) => p.trim().toUpperCase());
    const matchedPrefix = prefixes.find((p) => p.length > 0 && upperTracking.startsWith(p));
    if (!matchedPrefix) {
      continue;
    }

    // Length check if trackingLength specified
    if (rule.trackingLength != null && rule.trackingLength > 0) {
      if (trimmed.length !== rule.trackingLength) {
        continue;
      }
    }

    // Charset check if charsetPattern specified — anchored to full-string match
    if (rule.charsetPattern && rule.charsetPattern.trim().length > 0) {
      try {
        // Anchor pattern to full string to prevent partial matches
        let pattern = rule.charsetPattern.trim();
        if (!pattern.startsWith("^")) pattern = "^" + pattern;
        if (!pattern.endsWith("$")) pattern = pattern + "$";
        const regex = new RegExp(pattern);
        if (!regex.test(trimmed)) {
          continue;
        }
      } catch {
        // Invalid regex -> skip rule for safety
        continue;
      }
    }

    matchedRules.push({ rule, matchedPrefix });
  }

  if (matchedRules.length === 0) {
    return {
      status: "NOT_PROVEN_SUPPORTED",
      reason: `No proven provider rule matched tracking for region ${region}`
    };
  }

  // Deduplicate by providerId
  const providerIds = Array.from(new Set(matchedRules.map((m) => m.rule.providerId)));

  if (providerIds.length > 1) {
    return {
      status: "AMBIGUOUS",
      candidateProviderIds: providerIds,
      reason: `Multiple distinct provider rules matched tracking: ${providerIds.join(", ")}`
    };
  }

  const primaryMatch = matchedRules[0]!;
  const providerId = primaryMatch.rule.providerId;
  const carrierName = catalogMap.get(providerId)?.carrierName;

  return {
    status: "MATCHED",
    providerId,
    carrierName,
    ruleId: primaryMatch.rule.id,
    prefix: primaryMatch.matchedPrefix
  };
}
