import { Suspense } from "react";
import Link from "@/components/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, fmtDate, inr, todayISO } from "@/lib/format";
import { CompanyChip, ListSkeleton, PageHeader, StatusBadge, type Tone } from "@/components/ui";
import { nights } from "@/server/availability";
import { FollowUpDone } from "./follow-up-done";

const row = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5";

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line">
      <h2 className="flex items-baseline gap-2 border-b border-line px-4 py-2.5 text-body font-semibold text-fg">
        {title}
        <span className="text-ui font-normal text-fg-3 tabular-nums">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="px-4 py-4 text-body text-fg-2">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">{children}</ul>
      )}
    </section>
  );
}

async function HomeContent() {
  await requireUser();
  const today = todayISO();

  const [unpaid, drafts, followUps, releasing] = await Promise.all([
    db.execute<{
      id: string;
      number: string;
      client: string;
      initials: string;
      color: string;
      outstanding: number;
      age: number;
    }>(sql`
      select b.id, b.number, c.name as client, co.initials, co.color,
        (b.total - coalesce(p.paid, 0))::float8 as outstanding,
        (${today}::date - b.bill_date)::int as age
      from bills b
      join clients c on c.id = b.client_id
      join companies co on co.id = b.company_id
      left join lateral (select sum(amount) as paid from payments where bill_id = b.id and status = 'active') p on true
      where b.status = 'final' and b.is_sale and b.total - coalesce(p.paid, 0) > 0
      order by b.bill_date
      limit 12
    `),
    db.execute<{ id: string; client: string; initials: string; color: string; total: number; title: string }>(sql`
      select b.id, c.name as client, co.initials, co.color, b.total::float8 as total, f.title
      from bills b
      join clients c on c.id = b.client_id
      join companies co on co.id = b.company_id
      join formats f on f.id = b.format_id
      where b.status = 'draft'
      order by b.updated_at desc
      limit 12
    `),
    db.execute<{ id: string; body: string; follow_up_on: string; client: string }>(sql`
      select n.id, n.body, n.follow_up_on::text as follow_up_on, c.name as client
      from client_notes n
      join clients c on c.id = n.client_id
      where n.follow_up_on is not null and not n.done
      order by n.follow_up_on
      limit 12
    `),
    db.execute<{
      id: string;
      room_type_id: string;
      room: string;
      hotel: string;
      city: string;
      release_date: string;
      first_night: string;
      last_night: string;
    }>(sql`
      select sb.id, sb.room_type_id, rt.name as room, h.name as hotel, h.city,
        sb.release_date::text as release_date,
        greatest(sb.first_night, ${today}::date)::text as first_night,
        sb.last_night::text as last_night
      from stock_blocks sb
      join room_types rt on rt.id = sb.room_type_id
      join hotels h on h.id = rt.hotel_id
      where sb.release_date between ${today}::date and ${addDays(today, 30)}::date
        and sb.last_night >= ${today}::date
      order by sb.release_date
      limit 12
    `),
  ]);

  // Unsold room nights still to come in each block that has a release date.
  const releases = (
    await Promise.all(
      releasing.rows.map(async (b) => {
        const rows = await nights(db, b.first_night, b.last_night, b.room_type_id);
        const unsold = rows.reduce((sum, r) => sum + Math.max(r.held - r.sold, 0), 0);
        return { ...b, unsold };
      }),
    )
  ).filter((b) => b.unsold > 0);

  const ageTone = (age: number): Tone => (age > 30 ? "bad" : age > 7 ? "warn" : "muted");
  const ageLabel = (age: number) => (age <= 0 ? "Today" : age === 1 ? "1 day old" : `${age} days old`);

  return (
    <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-2">
      <Section title="Unpaid bills" count={unpaid.rows.length} empty="Nothing is waiting for payment.">
        {unpaid.rows.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}`} className={`${row} transition-colors duration-150 hover:bg-sunken`}>
              <CompanyChip initials={b.initials} color={b.color} />
              <div className="min-w-40 flex-1">
                <p className="truncate text-body text-fg">{b.client}</p>
                <p className="text-ui text-fg-3 tabular-nums">{b.number}</p>
              </div>
              <StatusBadge tone={ageTone(b.age)}>{ageLabel(b.age)}</StatusBadge>
              <span className="w-24 text-right text-body font-medium text-fg tabular-nums">
                {inr(b.outstanding)}
              </span>
            </Link>
          </li>
        ))}
      </Section>

      <Section
        title="Rooms going back to hotels"
        count={releases.length}
        empty="No unsold rooms with a release date in the next 30 days."
      >
        {releases.map((b) => (
          <li key={b.id} className={row}>
            <div className="min-w-40 flex-1">
              <p className="truncate text-body text-fg">
                {b.room}, {b.hotel}
              </p>
              <p className="text-ui text-fg-3">{b.city}</p>
            </div>
            <span className="text-ui text-fg-2 tabular-nums">{b.unsold} room nights unsold</span>
            <StatusBadge tone="warn">Release {fmtDate(b.release_date)}</StatusBadge>
          </li>
        ))}
      </Section>

      <Section title="Follow-ups" count={followUps.rows.length} empty="No follow-ups are due.">
        {followUps.rows.map((f) => (
          <li key={f.id} className={row}>
            <div className="min-w-40 flex-1">
              <p className="truncate text-body text-fg">{f.client}</p>
              <p className="truncate text-ui text-fg-3">{f.body}</p>
            </div>
            <StatusBadge tone={f.follow_up_on < today ? "bad" : f.follow_up_on === today ? "warn" : "muted"}>
              {f.follow_up_on < today ? "Was due" : "Due"} {fmtDate(f.follow_up_on)}
            </StatusBadge>
            <FollowUpDone noteId={f.id} />
          </li>
        ))}
      </Section>

      <Section title="Drafts" count={drafts.rows.length} empty="No unfinished bills.">
        {drafts.rows.map((d) => (
          <li key={d.id}>
            <Link
              href={`/bill-generator?bill=${d.id}`}
              className={`${row} transition-colors duration-150 hover:bg-sunken`}
            >
              <CompanyChip initials={d.initials} color={d.color} />
              <div className="min-w-40 flex-1">
                <p className="truncate text-body text-fg">{d.client}</p>
                <p className="text-ui text-fg-3">{d.title}, not finalised</p>
              </div>
              <span className="w-24 text-right text-body font-medium text-fg tabular-nums">{inr(d.total)}</span>
            </Link>
          </li>
        ))}
      </Section>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <PageHeader
        title="Home"
        description="What needs attention today."
        actions={
          <Link
            href="/bill-generator"
            className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink transition-colors duration-150 hover:bg-ink-hover md:h-9"
          >
            New bill
          </Link>
        }
      />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <HomeContent />
      </Suspense>

      {/* On a phone the bottom bar has room for five screens; the rest are here. */}
      <nav aria-label="More" className="px-4 pb-6 md:hidden">
        <h2 className="mb-2 text-ui font-semibold text-fg-3">More</h2>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {[
            ["/payments", "Payments"],
            ["/reports", "Reports"],
            ["/activity", "Activity"],
            ["/settings", "Settings"],
          ].map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="flex h-12 items-center px-4 text-body text-fg">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
