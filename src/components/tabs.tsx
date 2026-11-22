import Link from "@/components/link";
import { cx } from "@/components/ui";

/** A row of tabs that are links, so each tab has its own address. */
export function LinkTabs({
  label,
  current,
  tabs,
}: {
  label: string;
  current: string;
  tabs: { href: string; label: string }[];
}) {
  return (
    <nav aria-label={label} className="flex gap-1 border-b border-line px-4 md:px-6">
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "-mb-px inline-flex h-11 items-center border-b-2 px-2 text-body font-medium transition-colors duration-150 md:h-10",
              active ? "border-ink text-fg" : "border-transparent text-fg-3 hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const PAYMENT_TABS = [
  { href: "/payments", label: "From clients" },
  { href: "/payments/hotels", label: "To hotels" },
];
