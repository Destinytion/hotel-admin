"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Button, cx } from "@/components/ui";

/** The look of one choice in a Menu: a link or a button. */
export const menuItem =
  "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-body text-fg transition-colors duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

/*
  A button that opens a short list of choices. The list stays in the page
  while closed (hidden), so it can still be found and used by a screen
  reader's link list and by the tests. Escape or a click elsewhere closes it.
*/
export function Menu({ label, icon, children, primary = false }: { label: string; icon?: ReactNode; children: ReactNode; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button
        variant={primary ? "primary" : "secondary"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        {label}
        <CaretDown size={14} />
      </Button>
      <div
        role="menu"
        aria-label={label}
        hidden={!open}
        onClick={() => setOpen(false)}
        className={cx(
          // Opens to the right on a phone (the buttons start at the left edge), to the left on wider screens.
          "absolute left-0 z-30 mt-1 w-max max-w-[calc(100vw-2rem)] min-w-52 whitespace-nowrap rounded-md border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] md:left-auto md:right-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
