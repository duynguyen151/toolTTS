"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as NextNav from "next/navigation";
import { getSceneryForPathname, type PageSceneryMeta } from "./subpage-scenery-background";

interface PageSidePanelProps {
  customMeta?: Partial<PageSceneryMeta>;
  children?: ReactNode;
  badgeText?: string;
  pathname?: string;
}

export function PageSidePanel({ customMeta, children, badgeText, pathname: explicitPath }: PageSidePanelProps) {
  let pathname = explicitPath || "/";
  if (!explicitPath) {
    try {
      if (typeof NextNav.usePathname === "function") {
        pathname = NextNav.usePathname() || "/";
      }
    } catch {
      pathname = "/";
    }
  }
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
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

    return () => observer.disconnect();
  }, []);

  const routeMeta = getSceneryForPathname(pathname);
  const meta: PageSceneryMeta = { ...routeMeta, ...customMeta };
  const currentImg = theme === "light" ? meta.lightImg : meta.darkImg;

  return (
    <aside
      className="page-side-panel"
      aria-label={`${meta.title} - Thanh công cụ & Tổng quan`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: 200,
        minWidth: 200,
        flexShrink: 0,
        borderRadius: 12,
        position: "sticky",
        top: 60,
        maxHeight: "calc(100vh - 72px)",
        overflowY: "auto",
        alignSelf: "flex-start",
        padding: "8px 10px 10px",
        background:
          theme === "light"
            ? "rgba(255, 255, 255, 0.78)"
            : "rgba(10, 15, 26, 0.72)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        border:
          theme === "light"
            ? "1px solid rgba(215, 207, 194, 0.75)"
            : "1px solid rgba(255, 255, 255, 0.09)",
        boxShadow:
          theme === "light"
            ? "0 4px 24px -2px rgba(110, 95, 75, 0.08)"
            : "0 8px 32px rgba(0, 0, 0, 0.45)",
        transition: "all 0.3s ease",
        overflow: "hidden",
      }}
    >
      {/* 1. Header: Thumbnail Artwork Card synchronized with current subpage */}
      <div
        className="page-side-panel__thumb-wrap"
        style={{
          position: "relative",
          width: "100%",
          height: 72,
          borderRadius: 8,
          overflow: "hidden",
          border:
            theme === "light"
              ? "1px solid rgba(215, 207, 194, 0.6)"
              : "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow:
            theme === "light"
              ? "0 3px 12px rgba(110, 95, 75, 0.08)"
              : "0 4px 16px rgba(0, 0, 0, 0.35)",
          marginBottom: 8,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentImg}
          alt={meta.alt}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            transition: "transform 0.5s ease, filter 0.3s ease",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              theme === "light"
                ? "linear-gradient(to top, rgba(246, 243, 237, 0.95) 0%, rgba(246, 243, 237, 0.25) 50%, transparent 100%)"
                : "linear-gradient(to top, rgba(6, 10, 18, 0.95) 0%, rgba(6, 10, 18, 0.35) 50%, transparent 100%)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "8px 10px",
          }}
        >
          <span
            style={{
              fontSize: "0.58rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--color-primary)",
              marginBottom: 1,
            }}
          >
            {badgeText || meta.themeTag}
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--color-ink)",
              lineHeight: 1.2,
            }}
          >
            {meta.title}
          </h2>
        </div>
      </div>

      {/* 2. Middle Body: Page-specific quick widgets & stats */}
      <div
        className="page-side-panel__body"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexGrow: 1,
        }}
      >
        <p
          style={{
            margin: "0 0 4px",
            fontSize: "0.775rem",
            lineHeight: 1.5,
            color: "var(--color-ink-soft)",
          }}
        >
          {meta.desc}
        </p>

        {children}
      </div>

      {/* 3. Footer: Operational audit note & subtle Japanese Kyoto watermark */}
      <div
        className="page-side-panel__footer"
        style={{
          marginTop: "auto",
          paddingTop: 8,
          borderTop:
            theme === "light"
              ? "1px solid rgba(215, 207, 194, 0.55)"
              : "1px solid rgba(255, 255, 255, 0.08)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: "0.55rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-primary)",
            }}
          >
            Dấu vết kiểm toán
          </span>
          <span
            style={{
              fontSize: "0.58rem",
              fontWeight: 600,
              color: "var(--color-ink-muted)",
              letterSpacing: "0.04em",
            }}
          >
            京都 · V1
          </span>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: "0.65rem",
            lineHeight: 1.35,
            color: "var(--color-ink-muted)",
          }}
        >
          Minh bạch theo thiết kế: Quy tắc, AI, BA và Thực thi luôn phân tách độc lập.
        </p>

        {/* Decorative vermilion seal mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
            opacity: theme === "light" ? 0.75 : 0.6,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              border: "1px solid var(--color-primary)",
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.55rem",
              fontWeight: 700,
              color: "var(--color-primary)",
              userSelect: "none",
            }}
            title="Dấu ấn Kyoto ThreeUI"
          >
            京
          </div>
          <span
            style={{
              fontSize: "0.625rem",
              fontWeight: 500,
              color: "var(--color-ink-soft)",
              letterSpacing: "0.04em",
            }}
          >
            A calmer operational flow
          </span>
        </div>
      </div>
    </aside>
  );
}
