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
  Anything not in the activity record (a follow-up ticked done, "2 minutes
  ago" labels) still catches up this often while the tab is in use.
*/
const FULL_REFRESH_MS = 2 * 60 * 1000;

/** When anything was last saved, or undefined if the app could not be reached. */
async function lastSaved(): Promise<string | null | undefined> {
  try {
    const response = await fetch("/api/changes", { cache: "no-store" });
    if (!response.ok) return undefined;
    return ((await response.json()) as { at: string | null }).at;
  } catch {
    return undefined;
  }
}

/*
  Keeps every screen current while several people work at once. Every few
  seconds the tab asks when anything was last saved, a tiny request, and
  reloads the page's data only when that has changed. It also reloads whenever
  the tab comes back into view or the person returns after a break. Only the
  data is replaced. What someone is typing stays as it is.
*/
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    lastActivity = Date.now();
    let lastFull = Date.now();
    // What this screen's data already includes. Unknown until the first answer.
    let seen: string | null | undefined;
    void lastSaved().then((at) => {
      if (seen === undefined) seen = at;
    });

    const reload = () => {
      lastFull = Date.now();
      router.refresh();
    };
    const onActivity = () => {
      const wasIdle = isIdle();
      lastActivity = Date.now();
      // Back after a break: show what changed straight away.
      if (wasIdle && document.visibilityState === "visible") reload();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastActivity = Date.now();
      reload();
    };
    const tick = async () => {
      if (!shouldRun()) return;
      if (Date.now() - lastFull >= FULL_REFRESH_MS) return reload();
      const at = await lastSaved();
      if (at === undefined) return; // offline for a moment: ask again next time
      if (seen === undefined) {
        seen = at;
        return;
      }
      if (at !== seen) {
        seen = at;
        reload();
      }
    };

    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(() => void tick(), seconds * 1000);
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
