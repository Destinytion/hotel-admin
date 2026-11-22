"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { cx } from "@/components/ui";
import { search, type SearchHit } from "@/app/(app)/search-actions";

type Item = { kind: string; title: string; subtitle: string; href: string };

/** Places and actions offered before anything is typed, and matched by name after. */
const COMMANDS: Item[] = [
  { kind: "Go to", title: "Home", subtitle: "", href: "/" },
  { kind: "Go to", title: "New bill", subtitle: "Bill Generator", href: "/bill-generator" },
  { kind: "Go to", title: "Bills", subtitle: "", href: "/bills" },
  { kind: "Go to", title: "Clients", subtitle: "", href: "/clients" },
  { kind: "Go to", title: "Add client", subtitle: "Clients", href: "/clients?new=1" },
  { kind: "Go to", title: "Inventory", subtitle: "", href: "/inventory" },
  { kind: "Go to", title: "Add rooms", subtitle: "Inventory", href: "/inventory?add=1" },
  { kind: "Go to", title: "Payments", subtitle: "From clients", href: "/payments" },
  { kind: "Go to", title: "Record advance", subtitle: "Payments", href: "/payments?advance=new" },
  { kind: "Go to", title: "Payments to hotels", subtitle: "What you owe hotels", href: "/payments/hotels" },
  { kind: "Go to", title: "Reports", subtitle: "", href: "/reports" },
  { kind: "Go to", title: "Import from a spreadsheet", subtitle: "Clients or rooms, from Google Sheets or Excel", href: "/import" },
  { kind: "Go to", title: "Activity", subtitle: "Who did what", href: "/activity" },
  { kind: "Go to", title: "Settings", subtitle: "", href: "/settings" },
];

/** Anything that wants to open the search sends this event. */
export const OPEN_SEARCH = "open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH));

/*
  Search everything from anywhere: Ctrl+K (Cmd+K on a Mac), or the Search
  button. Arrow keys move, Enter opens, Escape closes.
*/
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Search as the person types, a moment after they pause. Older answers that
  // arrive late are ignored.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await search(q);
      if (ticket !== latest.current) return;
      setLoading(false);
      setHits(result.ok ? result.data : []);
      setActive(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const q = query.trim().toLowerCase();
  const commands = q ? COMMANDS.filter((c) => c.title.toLowerCase().includes(q)) : COMMANDS;
  const items: Item[] = q.length >= 2 ? [...hits, ...commands] : commands;

  function go(item: Item | undefined) {
    if (!item) return;
    close();
    if (item.href.startsWith("/api/")) window.open(item.href, "_blank", "noopener");
    else router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[12vh] print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        data-command-palette
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <MagnifyingGlass size={18} className="shrink-0 text-fg-3" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
            aria-label="Search clients, bills, rooms and receipts"
            placeholder="Search clients, bills, rooms, receipts"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (e.target.value.trim().length < 2) setHits([]);
            }}
            onKeyDown={onKeyDown}
            className="h-12 w-full bg-transparent text-body text-fg outline-none placeholder:text-fg-3"
          />
          <kbd className="hidden rounded border border-line px-1.5 text-ui text-fg-3 sm:inline">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-body text-fg-2">
              {loading ? "Searching" : `Nothing found for "${query.trim()}".`}
            </li>
          ) : (
            items.map((item, i) => (
              <li
                key={`${item.kind}-${item.href}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(item)}
                className={cx(
                  "flex cursor-pointer items-center gap-3 px-3 py-2",
                  i === active ? "bg-sunken" : "",
                )}
              >
                <span className="w-16 shrink-0 text-ui text-fg-3">{item.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{item.title}</span>
                  {item.subtitle ? <span className="block truncate text-ui text-fg-3">{item.subtitle}</span> : null}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/** The Search button for the sidebar and the phone's Home screen. */
export function SearchButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openSearch}
      data-open-search
      className={cx(
        "flex h-9 w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2 text-body text-fg-3 transition-colors duration-150 hover:border-line-strong hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
    >
      <MagnifyingGlass size={16} />
      <span className="flex-1 text-left">Search</span>
      {/* Phones have no keyboard shortcut to show. */}
      <kbd className="hidden rounded border border-line px-1 text-ui md:inline">Ctrl K</kbd>
    </button>
  );
}
