"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import {
  Bed,
  ChartBar,
  CircleHalf,
  ClockCounterClockwise,
  Files,
  GearSix,
  House,
  Receipt,
  UsersThree,
  Wallet,
} from "@phosphor-icons/react";
import { cx } from "@/components/ui";
import { SearchButton } from "@/components/command-palette";

const NAV = [
  { href: "/", label: "Home", short: "Home", icon: House, built: true, tab: true },
  { href: "/bill-generator", label: "Bill Generator", short: "New bill", icon: Receipt, built: true, tab: true },
  { href: "/bills", label: "Bills", short: "Bills", icon: Files, built: true, tab: true },
  { href: "/clients", label: "Clients", short: "Clients", icon: UsersThree, built: true, tab: true },
  { href: "/inventory", label: "Inventory", short: "Inventory", icon: Bed, built: true, tab: true },
  { href: "/payments", label: "Payments", short: "Payments", icon: Wallet, built: true, tab: false },
  { href: "/reports", label: "Reports", short: "Reports", icon: ChartBar, built: true, tab: false },
  { href: "/activity", label: "Activity", short: "Activity", icon: ClockCounterClockwise, built: true, tab: false },
  { href: "/settings", label: "Settings", short: "Settings", icon: GearSix, built: true, tab: false },
];

function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Private windows can refuse storage; the theme still switches for this visit.
  }
}

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Sidebar({ userSlot }: { userSlot?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-canvas md:flex print:hidden">
      {/* The name at the top goes Home, as on most sites. */}
      <Link
        href="/"
        aria-label="Hotel Admin, go to Home"
        className="mx-2 mt-2 flex h-12 items-center gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-ink text-ui font-semibold text-on-ink">
          H
        </span>
        <span className="text-body font-semibold tracking-tight text-fg">
          Hotel Admin
        </span>
      </Link>

      <div className="px-2 pt-2">
        <SearchButton />
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          if (!item.built) {
            return (
              <span
                key={item.href}
                aria-disabled="true"
                title="Not built yet"
                className="flex h-8 items-center gap-2.5 rounded-md px-2 text-body text-fg-3"
              >
                <Icon size={18} weight="regular" />
                {item.label}
                <span className="ml-auto text-ui">Later</span>
              </span>
            );
          }
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex h-8 items-center gap-2.5 rounded-md px-2 text-body transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent",
                active
                  ? "bg-sunken font-medium text-fg"
                  : "text-fg-2 hover:bg-sunken hover:text-fg",
              )}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-2 py-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-body text-fg-2 transition-colors duration-150 hover:bg-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          <CircleHalf size={18} />
          Switch theme
        </button>
      </div>
      {userSlot ? <div className="border-t border-line px-2 py-2">{userSlot}</div> : null}
    </aside>
  );
}

export function MobileTabs() {
  const pathname = usePathname();
  const tabs = NAV.filter((item) => item.tab);
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid h-(--tabbar-h) grid-cols-5 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      {tabs.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex flex-col items-center justify-center gap-0.5 text-ui",
              active ? "font-medium text-fg" : "text-fg-3",
            )}
          >
            <Icon size={22} weight={active ? "fill" : "regular"} />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}
