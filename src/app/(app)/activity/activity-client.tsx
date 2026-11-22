"use client";

import { useState } from "react";
import Link from "@/components/link";
import { EmptyState, Select } from "@/components/ui";

export type ActivityRow = {
  id: string;
  who: string;
  action: string;
  summary: string;
  href: string | null;
  day: string;
  time: string;
};

export function ActivityClient({ rows }: { rows: ActivityRow[] }) {
  const [person, setPerson] = useState("");
  const people = [...new Set(rows.map((r) => r.who))].sort();
  const visible = person ? rows.filter((r) => r.who === person) : rows;

  // Group under a heading per day.
  const days: { day: string; items: ActivityRow[] }[] = [];
  for (const row of visible) {
    const last = days[days.length - 1];
    if (last?.day === row.day) last.items.push(row);
    else days.push({ day: row.day, items: [row] });
  }

  if (rows.length === 0) {
    return (
      <EmptyState title="Nothing has happened yet">
        Every bill, payment, client and inventory change is listed here with the name of the person who made it.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="px-4 py-3 md:px-6">
        <Select
          aria-label="Show activity by"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className="sm:w-64"
        >
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </Select>
      </div>

      <div data-activity>
        {days.map((group) => (
          <section key={group.day}>
            <h2 className="border-y border-line bg-canvas px-4 py-1.5 text-ui font-semibold text-fg md:px-6">
              {group.day}
            </h2>
            <ul className="divide-y divide-line">
              {group.items.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 px-4 py-2.5 md:px-6">
                  <span className="w-16 shrink-0 text-ui text-fg-3 tabular-nums">{r.time}</span>
                  <p className="min-w-0 flex-1 text-body text-fg">
                    <span className="font-medium">{r.who}</span> {r.action}{" "}
                    {r.href ? (
                      <Link href={r.href} className="text-accent hover:underline">
                        {r.summary}
                      </Link>
                    ) : (
                      r.summary
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
