import Link from "next/link";
import { Bars3Icon } from "@heroicons/react/24/outline";

import { SearchField } from "../ui/search-field";
import { NavigationList } from "./navigation";
import { ProductMark } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";

function MobileNavigation() {
  return (
    <details className="mobile-nav">
      <summary aria-label="Open navigation">
        <Bars3Icon aria-hidden="true" />
      </summary>
      <div className="mobile-nav__panel">
        <ProductMark />
        <div className="mobile-nav__search">
          <SearchField
            label="Search shops and profiles"
            name="mobile-dashboard-search"
            placeholder="Search shops or profiles"
          />
        </div>
        <NavigationList />
      </div>
    </details>
  );
}

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <MobileNavigation />
        <Link href="/" className="topbar__brand" aria-label="Tool TTS Trang chủ">
          <span className="topbar__brand-mark" aria-hidden="true" />
          <div className="topbar__brand-text">
            <strong>TOOL_TTS</strong>
            <small>TIKTOK SHOP HEALTH</small>
          </div>
        </Link>

        {/* Top Desktop Navigation matching landing page */}
        <nav className="topbar__nav" aria-label="Main navigation">
          <Link href="/" className="topbar__nav-link">Trang chủ</Link>
          <Link href="/dashboard" className="topbar__nav-link">Dashboard</Link>
          <Link href="/accounts" className="topbar__nav-link">Tài khoản Cotik</Link>
          <Link href="/shops" className="topbar__nav-link">Cửa hàng</Link>
          <Link href="/settings" className="topbar__nav-link">Cài đặt</Link>
        </nav>
      </div>

      {/* Semantic title preserved for accessibility & tests */}
      <div className="topbar__title sr-only">
        <p>Operations</p>
        <strong>Dashboard</strong>
      </div>

      <div className="topbar__search">
        <SearchField
          label="Search shops and profiles"
          name="dashboard-search"
          placeholder="Search shops or profiles"
        />
      </div>

      <div className="topbar__actions">
        <div className="operator-context" aria-label="Current workspace">
          <span className="operator-context__avatar" aria-hidden="true">
            OP
          </span>
          <span className="operator-context__copy">
            <strong>Operator</strong>
            <small>Read-only</small>
          </span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
