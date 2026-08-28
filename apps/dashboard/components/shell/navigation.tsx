import {
  ArrowPathRoundedSquareIcon,
  BuildingStorefrontIcon,
  Cog6ToothIcon,
  HomeIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

type NavigationItem = {
  current?: boolean;
  href: string;
  icon: NavigationIcon;
  label: string;
};

const navigation: NavigationItem[] = [
  { current: true, href: "/dashboard", icon: HomeIcon, label: "Dashboard" },
  {
    href: "/dashboard#shops",
    icon: BuildingStorefrontIcon,
    label: "Shops",
  },
  { href: "/settings", icon: Cog6ToothIcon, label: "Settings" },
  {
    href: "/dashboard#decision-trace",
    icon: ShieldCheckIcon,
    label: "Decision trace",
  },
  {
    href: "/dashboard#sync-state",
    icon: ArrowPathRoundedSquareIcon,
    label: "Sync state",
  },
];

export function NavigationList() {
  return (
    <nav aria-label="Primary navigation" className="primary-nav">
      <p className="primary-nav__label">Workspace</p>
      <ul>
        {navigation.map((item) => {
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <a
                className="primary-nav__item"
                data-current={item.current ? "true" : "false"}
                href={item.href}
                aria-current={item.current ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
