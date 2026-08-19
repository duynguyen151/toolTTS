import type { ReactNode } from "react";

import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to dashboard content
      </a>
      <Sidebar />
      <TopBar />
      <div id="mobile-log-slot" />
      <main id="main-content" className="dashboard-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
