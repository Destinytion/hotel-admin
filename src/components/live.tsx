"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/*
  Refreshing only happens while someone is actually using the tab. A tab left
  open overnight goes quiet after this long, so it does not keep the database
  awake for nobody. It catches up the moment the person comes back.
*/
const IDLE_AFTER_MS = 10 * 60 * 1000;

// When this tab last saw a key press, click, scroll or pointer movement.
let lastActivity = 0;
const isIdle = () => Date.now() - lastActivity > IDLE_AFTER_MS;
const shouldRun = () => document.visibilityState === "visible" && !isIdle();

/*
  Keeps every screen current while several people work at once: the page's data
  is fetched again every few seconds, and whenever the tab comes back into view
  or the person returns after a break. Only the data is replaced. What someone
  is typing stays as it is.
*/
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    lastActivity = Date.now();

    const onActivity = () => {
      const wasIdle = isIdle();
      lastActivity = Date.now();
      // Back after a break: show what changed straight away.
      if (wasIdle && document.visibilityState === "visible") router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastActivity = Date.now();
      router.refresh();
    };
    const tick = () => {
      if (shouldRun()) router.refresh();
    };

    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(tick, seconds * 1000);
    return () => {
      clearInterval(timer);
      for (const name of events) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router, seconds]);
  return null;
}

/** Runs a task every few seconds while the tab is in use. For panels that load their own details. */
export function useEvery(seconds: number, task: () => void) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (shouldRun()) task();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [seconds, task]);
}

/*
  Shown inside an edit form when someone else has saved the same record since
  the form was opened. The person chooses; nothing is overwritten silently.
*/
export function ConflictNotice({
  who,
  thing,
  onLoadLatest,
  onKeepMine,
}: {
  who: string;
  thing: string;
  onLoadLatest: () => void;
  onKeepMine: () => void;
}) {
  return (
    <div role="alert" data-conflict className="rounded-lg border border-warn bg-warn-soft p-3">
      <p className="text-body font-medium text-fg">
        {who || "Someone"} changed this {thing} while you had it open.
      </p>
      <p className="text-ui text-fg-2">
        Load their version to see it, or keep yours and save over theirs.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={onLoadLatest}>Load their version</Button>
        <Button variant="ghost" onClick={onKeepMine}>
          Keep mine
        </Button>
      </div>
    </div>
  );
}
