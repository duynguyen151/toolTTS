"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { GlobalTaskProvider } from "../operations/global-task-context";
import { FloatingTaskBar } from "../operations/floating-task-bar";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { SubpageSceneryBackground } from "./subpage-scenery-background";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <GlobalTaskProvider>
      {/* Dynamic Subpage Kyoto Scenery Backdrop in background */}
      <SubpageSceneryBackground />

      <div
        className={`app-shell ${isLanding ? "app-shell--landing" : ""}`}
        style={{
          position: "relative",
          zIndex: isLanding ? 0 : 10,
          pointerEvents: isLanding ? "none" : "auto",
          display: isLanding ? "none" : undefined,
        }}
      >
        <a className="skip-link" href="#main-content">
          Skip to dashboard content
        </a>
        {!isLanding && <Sidebar />}
        {!isLanding && <TopBar />}
        <div id="mobile-log-slot" />
        <main id="main-content" className={isLanding ? "landing-main" : "dashboard-main"} tabIndex={-1}>
          {children}
        </main>
        {!isLanding && <FloatingTaskBar />}
      </div>
    </GlobalTaskProvider>
  );
}
