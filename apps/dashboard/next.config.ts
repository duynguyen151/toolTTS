import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceEnv = resolve(process.cwd(), "../../.env");

if (process.env.DATABASE_URL === undefined && existsSync(workspaceEnv)) {
  process.loadEnvFile(workspaceEnv);
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: [
    "@shop-health/db",
    "@shop-health/seller-center",
    "@shop-health/sync",
  ],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    config.module.rules.push({
      test: /packages[\\/]db[\\/]src[\\/]migrations\.ts$/,
      parser: { url: false },
    });

    return config;
  },
};

export default nextConfig;
