"use client";

import { useEffect, useState } from "react";
import * as NextNav from "next/navigation";
import { KageLandingPage } from "../landing/kage-landing-page";
import { KyotoLightLanding } from "../landing/kyoto-light-landing";
import { ThemeToggle } from "./theme-toggle";

export type PageSceneryMeta = {
  title: string;
  themeTag: string;
  darkImg: string;
  lightImg: string;
  alt: string;
  desc: string;
};

export const PAGE_SCENERY_MAP: Record<string, PageSceneryMeta> = {
  "/": {
    title: "Trang Chủ Vận Hành",
    themeTag: "KYOTO · TORII GATE",
    darkImg: "/images/kyoto/kyoto_torii_bloodmoon.jpg",
    lightImg: "/images/kyoto/kyoto_home_light.jpg",
    alt: "Cổng Torii vươn giữa sương mây Kyoto",
    desc: "Cổng Torii linh thiêng đánh dấu ngưỡng cửa vận hành TikTok Shop.",
  },
  "/dashboard": {
    title: "Bảng Điều Khiển Vận Hành",
    themeTag: "KYOTO PAGODA · MIST",
    darkImg: "/images/kyoto/kyoto_zen_temple.jpg",
    lightImg: "/images/kyoto/kyoto_dashboard_light.jpg",
    alt: "Chùa tháp Kyoto sương sớm ẩn hiện giữa núi thu",
    desc: "Chùa tháp thanh tịnh giữa sương sớm, tĩnh tâm giám sát toàn diện vận hành.",
  },
  "/shops": {
    title: "Danh Mục Cửa Hàng",
    themeTag: "PORTFOLIO · 42 SHOPS",
    darkImg: "/images/kyoto/kyoto_river_bridge.jpg",
    lightImg: "/images/kyoto/kyoto_shops_light.jpg",
    alt: "Cầu suối Kyoto soi bóng trong sương mai",
    desc: "Cầu gỗ nối nhịp hai bờ suối trong, vững bước luân chuyển đơn hàng và đối soát.",
  },
  "/accounts": {
    title: "Quản Trị 5 Tài Khoản Cotik",
    themeTag: "AL-TOKENS · 5 TÀI KHOẢN",
    darkImg: "/images/kyoto/kyoto_stone_lantern.jpg",
    lightImg: "/images/kyoto/kyoto_accounts_light.jpg",
    alt: "Lối mòn đèn đá rêu phong và rừng trúc sương mai",
    desc: "Ngọn đèn đá soi sáng đường dẫn qua rừng trúc, ổn định kết nối 5 phiên làm việc.",
  },
  "/settings": {
    title: "Cài Đặt & Giao Diện",
    themeTag: "ZEN AESTHETIC · SYSTEM",
    darkImg: "/images/kyoto/kyoto_settings_dark.jpg",
    lightImg: "/images/kyoto/kyoto_settings_light.jpg",
    alt: "Vườn thiền sỏi đá tối giản sương sớm",
    desc: "Vườn thiền cát trắng cào gợn sóng, tối giản hóa cấu hình và chuẩn mực hệ thống.",
  },
};

export const DEFAULT_SCENERY: PageSceneryMeta = PAGE_SCENERY_MAP["/dashboard"] as PageSceneryMeta;

export function getSceneryForPathname(pathname?: string | null): PageSceneryMeta {
  const p = pathname || "/";
  if (PAGE_SCENERY_MAP[p]) {
    return PAGE_SCENERY_MAP[p]!;
  }
  if (p.startsWith("/shops")) return PAGE_SCENERY_MAP["/shops"] ?? DEFAULT_SCENERY;
  if (p.startsWith("/accounts")) return PAGE_SCENERY_MAP["/accounts"] ?? DEFAULT_SCENERY;
  if (p.startsWith("/settings")) return PAGE_SCENERY_MAP["/settings"] ?? DEFAULT_SCENERY;
  if (p.startsWith("/dashboard")) return PAGE_SCENERY_MAP["/dashboard"] ?? DEFAULT_SCENERY;
  return DEFAULT_SCENERY;
}

export function SubpageSceneryBackground() {
  let pathname = "/";
  try {
    if (typeof NextNav.usePathname === "function") {
      pathname = NextNav.usePathname() || "/";
    }
  } catch {
    pathname = "/";
  }
  const isLanding = pathname === "/";
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const readCurrentTheme = () => {
      const docTheme = document.documentElement.getAttribute("data-theme");
      const savedTheme = localStorage.getItem("tool_tts_theme");
      const nextTheme = docTheme === "light" || savedTheme === "light" ? "light" : "dark";
      setTheme(nextTheme);
    };

    readCurrentTheme();

    const observer = new MutationObserver(() => {
      readCurrentTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    window.addEventListener("storage", readCurrentTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", readCurrentTheme);
    };
  }, []);

  const meta = getSceneryForPathname(pathname);
  const currentBgUrl = theme === "light" ? meta.lightImg : meta.darkImg;

  return (
    <div
      className="subpage-scenery-backdrop"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: isLanding ? 10 : 0,
        pointerEvents: isLanding ? "auto" : "none",
        overflow: isLanding && theme === "light" ? "auto" : "hidden",
      }}
    >
      {/* Landing page in dark mode gets the persistent 3D WebGL stage */}
      {isLanding && theme === "dark" ? (
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <KageLandingPage
            headingFont="onest"
            bodyFont="onest"
            headingWeight="400"
            bodyWeight="300"
            primaryColor="#e0231c"
            headingSize={46}
            bodySize={17}
            headingLetterSpacing={-0.012}
          />
          {/* Theme toggle floating button on landing page */}
          <div
            style={{
              position: "fixed",
              top: "22px",
              right: "32px",
              zIndex: 100,
              pointerEvents: "auto",
            }}
          >
            <ThemeToggle />
          </div>
        </div>
      ) : isLanding && theme === "light" ? (
        /* Landing page in light mode renders complete 3D interactive WebGL stage in Kyoto Morning Light */
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <KageLandingPage
            headingFont="onest"
            bodyFont="onest"
            headingWeight="400"
            bodyWeight="300"
            primaryColor="#e0231c"
            headingSize={46}
            bodySize={17}
            headingLetterSpacing={-0.012}
            sourceUrl="/landing-pages/kage.html?theme=light"
          />
          {/* Theme toggle floating button on landing page */}
          <div
            style={{
              position: "fixed",
              top: "22px",
              right: "32px",
              zIndex: 100,
              pointerEvents: "auto",
            }}
          >
            <ThemeToggle />
          </div>
        </div>
      ) : (
        /* Scenery landscape image background for subpages */
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${currentBgUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
            transition: "background-image 0.4s ease-in-out, filter 0.4s ease-in-out",
            filter: theme === "dark" ? "brightness(0.85) contrast(1.05)" : "brightness(0.98) saturate(1.05)",
          }}
        />
      )}

      {/* Atmospheric overlays for contrast and readability on subpages */}
      {!isLanding && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              theme === "dark"
                ? "radial-gradient(ellipse at 50% 35%, rgba(6, 10, 18, 0.45) 0%, rgba(5, 7, 12, 0.88) 100%)"
                : "radial-gradient(ellipse at 50% 35%, rgba(246, 243, 237, 0.38) 0%, rgba(246, 243, 237, 0.85) 100%)",
            backdropFilter: theme === "dark" ? "blur(3px)" : "blur(2px)",
            WebkitBackdropFilter: theme === "dark" ? "blur(3px)" : "blur(2px)",
            transition: "background 0.3s ease",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Light mode subtle washi paper grain overlay on subpages */}
      {!isLanding && theme === "light" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(rgba(140, 120, 90, 0.04) 1px, transparent 0)",
            backgroundSize: "24px 24px",
            opacity: 0.7,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
