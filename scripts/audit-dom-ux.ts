import { chromium } from "playwright-core";

async function audit() {
  const browser = await chromium.launch({ channel: "chrome" });
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

  const results = [];

  for (const vp of viewports) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme as "light" | "dark",
      });
      const page = await context.newPage();

      for (const route of routes) {
        try {
          await page.goto(`http://127.0.0.1:3000${route.path}`, { waitUntil: "networkidle", timeout: 8000 });
          if (theme === "dark") {
            await page.evaluate(() => {
              document.documentElement.setAttribute("data-theme", "dark");
              document.documentElement.classList.add("dark");
            });
          }
          await page.waitForTimeout(200);

          const data = await page.evaluate((args) => {
            const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
            const bodyStyle = window.getComputedStyle(document.body);

            // Check headings
            const h1 = document.querySelector("h1");
            const h1Text = h1 ? h1.textContent?.trim() : null;
            const h1Font = h1 ? window.getComputedStyle(h1).fontFamily : null;

            // Check information architecture elements
            const allText = document.body.innerText;
            const hasBossKpi = allText.includes("Portfolio") || allText.includes("Official On Hold") || allText.includes("Total Exposure") || allText.includes("Delivery Rate") || allText.includes("Critical Shops");
            const hasTriadRule = allText.includes("RULE") || allText.includes("Rule:") || allText.includes("CONTINUE") || allText.includes("PAUSE") || allText.includes("SLOW_SELL") || allText.includes("WATCH") || allText.includes("SCALE");
            const hasAiBadge = allText.includes("AI") || allText.includes("AI Advisory") || allText.includes("ADVISORY");
            const hasBaBadge = allText.includes("BA") || allText.includes("BA Decision") || allText.includes("BA Action");
            const hasCotikOrAdsPower = allText.includes("AdsPower") || allText.includes("COTIK") || allText.includes("SELLER_CENTER");
            const hasDryRun = allText.includes("DRY_RUN") || allText.includes("Dry Run") || allText.includes("dry-run");

            // Check contrast of main card / container
            const cards = Array.from(document.querySelectorAll("div, section, article")).filter(el => {
              const bg = window.getComputedStyle(el).backgroundColor;
              return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
            });

            // Check sidebar / nav visibility
            const sidebar = document.querySelector("nav, aside");
            const sidebarVisible = sidebar ? (sidebar.getBoundingClientRect().width > 0 && sidebar.getBoundingClientRect().height > 0) : false;

            return {
              route: args.route,
              vp: args.vp,
              theme: args.theme,
              hasHorizontalScroll,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              bodyFont: bodyStyle.fontFamily,
              bodyBg: bodyStyle.backgroundColor,
              bodyColor: bodyStyle.color,
              h1Text,
              h1Font,
              sidebarVisible,
              iaCheck: {
                hasBossKpi,
                hasTriadRule,
                hasAiBadge,
                hasBaBadge,
                hasCotikOrAdsPower,
                hasDryRun,
              }
            };
          }, { route: route.name, vp: vp.name, theme });

          results.push(data);
        } catch (e: any) {
          results.push({ error: e.message, route: route.name, vp: vp.name, theme });
        }
      }
      await context.close();
    }
  }
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

audit().catch(console.error);
