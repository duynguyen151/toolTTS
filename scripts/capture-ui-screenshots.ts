import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots/ui-consolidation");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 375, height: 812 },
];

const routes = [
  { name: "dashboard", path: "/dashboard" },
  { name: "shops", path: "/shops" },
  { name: "shop_detail", path: "/shops/DEMO-001" },
  { name: "orders", path: "/orders?profile=DEMO-001" },
  { name: "settings", path: "/settings" },
];

async function capture() {
  const browser = await chromium.launch({
    channel: "chrome",
  });

  for (const vp of viewports) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme as "light" | "dark",
      });
      const page = await context.newPage();

      for (const route of routes) {
        try {
          await page.goto(`http://127.0.0.1:3000${route.path}`, { waitUntil: "networkidle", timeout: 10000 });
          if (theme === "dark") {
            await page.evaluate(() => {
              document.documentElement.setAttribute("data-theme", "dark");
              document.documentElement.classList.add("dark");
            });
          }
          await page.waitForTimeout(300);
          const filename = `${route.name}_${vp.name}_${theme}.png`;
          await page.screenshot({ path: path.join(screenshotsDir, filename), fullPage: true });
          console.log(`Captured ${filename}`);
        } catch (e: any) {
          console.error(`Failed ${route.name} (${vp.name}, ${theme}): ${e.message}`);
        }
      }
      await context.close();
    }
  }

  await browser.close();
  console.log("All screenshots completed!");
}

capture().catch((e) => {
  console.error(e);
  process.exit(1);
});
