"use client";

import {
  BuildingStorefrontIcon,
  Cog6ToothIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type NavigationItem = {
  href: string;
  icon: NavigationIcon;
  label: string;
  matchPrefix?: string;
};

const navigation: NavigationItem[] = [
  { href: "/dashboard", icon: HomeIcon, label: "Tổng quan Dashboard", matchPrefix: "/dashboard" },
  { href: "/shops", icon: BuildingStorefrontIcon, label: "Danh sách Cửa hàng", matchPrefix: "/shops" },
  { href: "/settings", icon: Cog6ToothIcon, label: "Cài đặt", matchPrefix: "/settings" },
];

export function NavigationList() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="primary-nav">
      <p className="primary-nav__label">Không gian vận hành</p>
      <ul>
        {navigation.map((item) => {
          const Icon = item.icon;
          const isCurrent = item.matchPrefix
            ? (item.href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(item.matchPrefix))
            : pathname === item.href;

          return (
            <li key={item.href}>
              <Link
                className="primary-nav__item"
                data-current={isCurrent ? "true" : "false"}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

