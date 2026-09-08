"use client";

import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = localStorage.getItem("tool_tts_theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.setAttribute("data-theme", initialTheme);
    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("tool_tts_theme", nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }
  };

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={theme === "light" ? "Chuyển sang Giao diện Tối (Dark mode)" : "Chuyển sang Giao diện Sáng (Light mode)"}
      title={theme === "light" ? "Đổi sang Đêm Kyoto (Dark)" : "Đổi sang Sương mai Kyoto (Light)"}
    >
      {theme === "light" ? (
        <MoonIcon className="theme-toggle-icon" style={{ width: 18, height: 18, display: "block" }} aria-hidden="true" />
      ) : (
        <SunIcon className="theme-toggle-icon" style={{ width: 18, height: 18, display: "block" }} aria-hidden="true" />
      )}
    </button>
  );
}
