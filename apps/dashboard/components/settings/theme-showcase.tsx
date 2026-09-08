"use client";

import { useState, useEffect } from "react";
import { CheckCircleIcon, SparklesIcon, SunIcon } from "@heroicons/react/24/solid";

interface ThemeOption {
  id: string;
  name: string;
  subtitle: string;
  desc: string;
  imgSrc: string;
  badge?: string;
  themeValue: "light" | "dark";
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "suong-mai",
    name: "Sương mai Kyoto",
    subtitle: "Misty Morning",
    desc: "Nền giấy Washi ngà ấm, kính sương bán trong suốt, chữ mực tàu xám đen chống lóa mỏi mắt, điểm nhấn đỏ son vermilion cổ điển.",
    imgSrc: "/images/kyoto/kyoto_dashboard_light.jpg",
    badge: "Được đề xuất",
    themeValue: "light",
  },
  {
    id: "binh-minh",
    name: "Bình minh Torii",
    subtitle: "Torii Sunrise",
    desc: "Nền xám bạc phớt hồng sương mai nhẹ, kính khói nhạt, chữ xám slate đậm, điểm nhấn đỏ cam chu sa ấm áp.",
    imgSrc: "/images/kyoto/kyoto_home_light.jpg",
    themeValue: "light",
  },
  {
    id: "thien-dinh",
    name: "Thiền định Tối giản",
    subtitle: "Minimal Zen",
    desc: "Nền xám sỏi đá mát mẻ, các khối thẻ phẳng đơn giản, chữ than đen, viền nét mảnh tinh tế và tĩnh tại.",
    imgSrc: "/images/kyoto/kyoto_settings_light.jpg",
    themeValue: "light",
  },
];

export function ThemeShowcase() {
  const [selectedPreset, setSelectedPreset] = useState("suong-mai");
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">("dark");
  const [appliedFeedback, setAppliedFeedback] = useState<string | null>(null);

  useEffect(() => {
    const docTheme = document.documentElement.getAttribute("data-theme");
    const savedTheme = localStorage.getItem("tool_tts_theme");
    const current = docTheme === "light" || savedTheme === "light" ? "light" : "dark";
    setActiveTheme(current);
  }, []);

  const handleApply = (themeVal: "light" | "dark", presetName: string) => {
    setActiveTheme(themeVal);
    localStorage.setItem("tool_tts_theme", themeVal);
    document.documentElement.setAttribute("data-theme", themeVal);
    if (themeVal === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
    setAppliedFeedback(`Đã áp dụng giao diện: ${presetName}`);
    setTimeout(() => setAppliedFeedback(null), 3500);
  };

  return (
    <section
      className="theme-showcase-card"
      aria-labelledby="theme-showcase-title"
      style={{
        borderRadius: 16,
        padding: "24px 28px",
        background: "var(--color-surface)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
        marginBottom: 24,
      }}
    >
      {/* Section Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
          }}
        >
          <SunIcon style={{ width: 20, height: 20 }} aria-hidden="true" />
        </div>
        <div>
          <h2
            id="theme-showcase-title"
            style={{
              margin: 0,
              fontSize: "1.0625rem",
              fontWeight: 700,
              color: "var(--color-ink)",
              lineHeight: 1.25,
            }}
          >
            Chế độ Light Kyoto
          </h2>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: "0.8125rem",
              color: "var(--color-ink-muted)",
            }}
          >
            Ba sắc thái, ba khoảnh khắc khác nhau của Kyoto. Chọn phong cách để đồng hành cùng bạn mỗi ngày.
          </p>
        </div>
      </div>

      {/* 3 Preset Theme Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {THEME_OPTIONS.map((opt) => {
          const isSelected = selectedPreset === opt.id;
          const isActuallyActive = activeTheme === "light" && isSelected;

          return (
            <div
              key={opt.id}
              onClick={() => setSelectedPreset(opt.id)}
              style={{
                borderRadius: 14,
                border: isSelected
                  ? "2px solid var(--color-primary)"
                  : "1px solid var(--color-border)",
                background: isSelected
                  ? "var(--color-surface-strong)"
                  : "var(--color-surface-subtle)",
                boxShadow: isSelected ? "var(--shadow-action)" : "none",
                padding: "14px 14px 16px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              {/* Image thumbnail & Selection indicator */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 120,
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 12,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={opt.imgSrc}
                  alt={opt.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {opt.badge && (
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      left: 8,
                      padding: "3px 8px",
                      borderRadius: 6,
                      fontSize: "0.625rem",
                      fontWeight: 700,
                      background: "rgba(184, 58, 40, 0.9)",
                      color: "#ffffff",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {opt.badge}
                  </span>
                )}
                <div
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isSelected ? "var(--color-primary)" : "rgba(255, 255, 255, 0.75)",
                    display: "grid",
                    placeItems: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                  }}
                >
                  {isSelected ? (
                    <CheckCircleIcon style={{ width: 18, height: 18, color: "#ffffff" }} />
                  ) : (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        border: "1px solid rgba(0,0,0,0.3)",
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Title & Desc */}
              <h3
                style={{
                  margin: "0 0 2px",
                  fontSize: "0.9375rem",
                  fontWeight: 700,
                  color: "var(--color-ink)",
                }}
              >
                {opt.name}
              </h3>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-ink-muted)",
                  marginBottom: 8,
                }}
              >
                {opt.subtitle}
              </span>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.775rem",
                  lineHeight: 1.45,
                  color: "var(--color-ink-soft)",
                  flexGrow: 1,
                }}
              >
                {opt.desc}
              </p>
            </div>
          );
        })}
      </div>

      {/* Action Row matching Image 4 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          paddingTop: 16,
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SparklesIcon style={{ width: 18, height: 18, color: "var(--color-primary)" }} />
          <span style={{ fontSize: "0.8125rem", color: "var(--color-ink-soft)" }}>
            Trạng thái hiện tại:{" "}
            <strong style={{ color: "var(--color-primary)" }}>
              {activeTheme === "light" ? "Giao diện Sáng (Light Kyoto)" : "Giao diện Tối (Đêm Kyoto ThreeUI)"}
            </strong>
          </span>
          {appliedFeedback && (
            <span
              style={{
                marginLeft: 8,
                padding: "2px 8px",
                borderRadius: 4,
                background: "var(--color-success-soft)",
                color: "var(--color-success)",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              ✓ {appliedFeedback}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => handleApply("dark", "Đêm Kyoto (Dark)")}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface-subtle)",
              color: "var(--color-ink-soft)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Về Đêm Kyoto (Dark)
          </button>
          <button
            type="button"
            onClick={() => {
              const selectedOpt = THEME_OPTIONS.find((o) => o.id === selectedPreset);
              handleApply("light", selectedOpt ? selectedOpt.name : "Sương mai Kyoto");
            }}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "none",
              background: "var(--color-primary)",
              color: "#ffffff",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "var(--shadow-action)",
            }}
          >
            Áp dụng giao diện này
          </button>
        </div>
      </div>
    </section>
  );
}
