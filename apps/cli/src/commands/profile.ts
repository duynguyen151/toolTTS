import {
  getAdsPowerProfile,
  listAdsPowerProfiles,
  listReadyAdsPowerProfileShops,
} from "@shop-health/db";
import {
  AdsPowerClient,
  SellerCenterBrowserDataSource,
} from "@shop-health/seller-center";
import {
  runSequentialProfileQueue,
  runShopSync,
  verifySelectedProfile,
} from "@shop-health/sync";
import type { Command } from "commander";

import { withDatabase } from "../db-runtime.js";
import { CliError } from "../errors.js";
import { printJson, printKeyValues, printTable } from "../presentation/output.js";
import type { CliRuntime } from "../runtime.js";

function adsPower(runtime: CliRuntime): AdsPowerClient {
  return new AdsPowerClient({
    baseUrl: runtime.config.ADSPOWER_BASE_URL,
    ...(runtime.config.ADSPOWER_API_KEY === undefined ? {} : { apiKey: runtime.config.ADSPOWER_API_KEY }),
  });
}

function source(runtime: CliRuntime): SellerCenterBrowserDataSource {
  return new SellerCenterBrowserDataSource({
    baseUrl: runtime.config.ADSPOWER_BASE_URL,
    logger: runtime.logger,
    ...(runtime.config.ADSPOWER_API_KEY === undefined ? {} : { apiKey: runtime.config.ADSPOWER_API_KEY }),
  });
}

async function selectedProfile(runtime: CliRuntime, profileNo: string) {
  const profile = (await adsPower(runtime).listProfiles()).find((item) => item.profileNo === profileNo);
  if (profile === undefined) {
    throw new CliError({ failureType: "PROFILE_NOT_FOUND", message: `AdsPower profile ${profileNo} was not found` });
  }
  return profile;
}

async function syncShops(runtime: CliRuntime, profileNos: readonly string[], allEligible: boolean) {
  return withDatabase(runtime, async (context) => {
    const shops = await listReadyAdsPowerProfileShops(context.db);
    const selected = allEligible ? shops : shops.filter((shop) => profileNos.includes(shop.profileNo));
    if (!allEligible && selected.length !== profileNos.length) {
      const ready = new Set(selected.map((shop) => shop.profileNo));
      const blocked = profileNos.find((profileNo) => !ready.has(profileNo));
      throw new CliError({
        failureType: "PROFILE_NOT_READY",
        message: `Profile ${blocked} is not READY and eligible for LIVE sync`,
      });
    }
    const shopsByProfileNo = new Map(selected.map((shop) => [shop.profileNo, shop]));
    const browserSource = source(runtime);
    return runSequentialProfileQueue(selected.map((shop) => shop.profileNo), async (profileNo) => {
      const shop = shopsByProfileNo.get(profileNo);
      if (shop === undefined) throw new Error(`Eligible profile ${profileNo} has no linked shop`);
      await runShopSync({ context, source: browserSource, shop, kind: "orders", logger: runtime.logger });
      await runShopSync({ context, source: browserSource, shop, kind: "finance", logger: runtime.logger });
    });
  });
}

export function registerProfileCommands(program: Command, runtime: CliRuntime): void {
  const profile = program.command("profile").description("Operate explicitly selected AdsPower profiles");

  profile.command("list").option("--json").action(async (options: { json?: boolean }) => {
    const [available, persisted] = await Promise.all([
      adsPower(runtime).listProfiles(),
      withDatabase(runtime, ({ db }) => listAdsPowerProfiles(db)),
    ]);
    const persistedById = new Map(persisted.map((item) => [item.profileId, item]));
    const rows = available.map((item) => ({
      ...item,
      verificationState: persistedById.get(item.profileId)?.verificationState ?? "UNVERIFIED",
    }));
    if (options.json === true) printJson({ schemaVersion: "profile-list.v1", profiles: rows });
    else printTable(["PROFILE", "STATE", "VERIFICATION", "GROUP"], rows.map((item) => [item.profileNo, item.state, item.verificationState, item.groupName ?? "-"]));
  });

  profile.command("open <profileNo>").option("--json").action(async (profileNo: string, options: { json?: boolean }) => {
    const selected = await selectedProfile(runtime, profileNo);
    await adsPower(runtime).openReady(selected.profileId);
    if (options.json === true) printJson({ schemaVersion: "profile-open.v1", profileNo, state: "OPEN" });
    else printKeyValues([["Profile", profileNo], ["State", "OPEN"]]);
  });

  profile.command("verify <profileNo>").option("--json").action(async (profileNo: string, options: { json?: boolean }) => {
    const selected = await selectedProfile(runtime, profileNo);
    const result = await withDatabase(runtime, ({ db }) => verifySelectedProfile(db, selected, source(runtime)));
    if (options.json === true) printJson({ schemaVersion: "profile-verification.v1", ...result });
    else printKeyValues([["Profile", profileNo], ["Verification", result.verificationState], ["Shop", result.shop?.id ?? "-"]]);
  });

  profile.command("sync <profileNo>").option("--json").action(async (profileNo: string, options: { json?: boolean }) => {
    const results = await syncShops(runtime, [profileNo], false);
    if (options.json === true) printJson({ schemaVersion: "profile-sync.v1", results });
    else printTable(["PROFILE", "STATUS", "ERROR"], results.map((item) => [item.profileNo, item.status, item.error ?? "-"]));
  });

  profile.command("sync-selected <profileNos...>").option("--json").action(async (profileNos: string[], options: { json?: boolean }) => {
    const results = await syncShops(runtime, [...new Set(profileNos)], false);
    if (options.json === true) printJson({ schemaVersion: "profile-sync.v1", results });
    else printTable(["PROFILE", "STATUS", "ERROR"], results.map((item) => [item.profileNo, item.status, item.error ?? "-"]));
  });

  profile.command("sync-all-eligible").option("--json").action(async (options: { json?: boolean }) => {
    const results = await syncShops(runtime, [], true);
    if (options.json === true) printJson({ schemaVersion: "profile-sync.v1", results });
    else printTable(["PROFILE", "STATUS", "ERROR"], results.map((item) => [item.profileNo, item.status, item.error ?? "-"]));
  });
}
