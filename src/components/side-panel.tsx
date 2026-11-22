"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

/** Panel that slides over the right edge. Full screen on a phone. */
export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={title}
      data-panel
      className="fixed inset-0 z-30 flex flex-col bg-surface lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[420px] lg:border-l lg:border-line print:hidden"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle ? <p className="text-ui text-fg-2">{subtitle}</p> : null}
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close" className="w-11 px-0 md:w-9">
          <X size={18} />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 md:px-5">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}
