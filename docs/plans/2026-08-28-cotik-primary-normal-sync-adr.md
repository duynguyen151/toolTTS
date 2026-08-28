# ADR: COTIK-Primary Normal Sync and Explicit AdsPower / Seller Center Fallback Semantics

- **Date:** 2026-08-28
- **Status:** Accepted
- **Context:** Tool_TTS V1 Synchronization Architecture

## Context

Tool_TTS was originally wired such that normal background/batch synchronization actions (`syncSelected` and `syncAllEligible`) in the dashboard called `updateData`, which unconditionally required launching/opening AdsPower browser profiles and scraping TikTok Seller Center via CDP.

COTIK provides lightweight GET-only API endpoints for Orders ingestion (`runCotikOrdersSync`) and supplementary Finance ingestion (`runCotikSupplementaryFinanceSync`) bound via per-shop `shop_provider_bindings`.

## Invariants & Decisions

1. **COTIK is Primary Normal Path for Orders & Supplementary Finance**:
   - For all bound and enabled shops, normal sync actions (`/api/sync/selected`, `/api/sync/all-eligible`, and direct COTIK triggers) invoke the GET-only COTIK sync pipeline.
   - Exact per-shop `providerShopId` is resolved via `findEnabledShopProviderBinding(db, shop.id, "COTIK")`.

2. **No Silent Fallback to AdsPower / Seller Center**:
   - If a COTIK binding is disabled, missing, unconfigured, or returns `SKIPPED`, the normal sync returns a failed result closed without launching AdsPower or connecting to Seller Center.
   - Missing `COTIK_TOKEN` or `COTIK_API_KEY` environment variables fail closed; dummy token fallbacks are forbidden.

3. **Authoritative Finance Boundary**:
   - Seller Center remains the sole authoritative source for **Official Finance On Hold**.
   - COTIK statement and payout records are classified strictly as `SUPPLEMENTARY_FINANCE` and do not satisfy the Official-OH Rule condition or overwrite Seller Center authoritative proofs.

4. **Explicit Fallback Path**:
   - `updateData` (`/api/update-data`) remains the explicit, operator-triggered Seller Center authoritative synchronization / fallback path.
   - It is explicitly labeled in UI operations as "Update data (Seller Center)" / "Retry update (Seller Center)" to make the provider boundary unmistakable.

5. **Risk Evaluation**:
   - Following successful COTIK normal synchronization, deterministic risk facts are evaluated and persisted from the updated database state via `evaluateAndStoreRiskControl`.
