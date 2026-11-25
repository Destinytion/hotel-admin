import { Suspense } from "react";
import Link from "@/components/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { addDays, dayName, fmtDate, fmtDateLong, inr, round2, todayISO } from "@/lib/format";
import { ListSkeleton, cx } from "@/components/ui";
import { nights } from "@/server/availability";
import { roomCosts } from "@/server/payables";
import { SearchButton } from "@/components/command-palette";
import {
  ArrowRight,
  Bed,
  Buildings,
  CalendarCheck,
  ChatCircleText,
  CurrencyInr,
  HandCoins,
  Phone,
  Receipt,
  WhatsappLogo,
} from "@phosphor-icons/react/dist/ssr";
import { FollowUpDone } from "./follow-up-done";

/*
  Home, for people who run hospitality rather than computers: the money,
  the week's arrivals, and a short list of what to do today, each a plain
  sentence with one button (most often a WhatsApp message, already written).
  Everything comes from the records; nothing here is typed twice.
*/

const card = "rounded-lg border border-line bg-surface p-4";

/** WhatsApp link, with India's 91 in front of a 10-digit number. */
function whatsapp(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${number.length >= 8 ? number : ""}?text=${encodeURIComponent(text)}`;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** "today", "tomorrow", "on Fri 28 Nov" */
function arrivalWords(today: string, date: string) {
  const n = daysBetween(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `on ${dayName(date)} ${fmtDate(date)}`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 2)
    .join("");

type Kind = "late" | "arrival" | "follow" | "call" | "unsent" | "release";
const KINDS: Record<Kind, { tile: string; icon: React.ReactNode; label: string }> = {
  late: { tile: "bg-bad-soft text-bad", icon: <CalendarCheck size={20} />, label: "Payment" },
  arrival: { tile: "bg-warn-soft text-warn", icon: <Bed size={20} />, label: "Arrival" },
  follow: { tile: "bg-accent-soft text-accent", icon: <ChatCircleText size={20} />, label: "Enquiry" },
  call: { tile: "bg-ok-soft text-ok", icon: <Phone size={20} />, label: "Follow-up you noted" },
  unsent: { tile: "bg-sunken text-fg-2", icon: <Receipt size={20} />, label: "Not sent yet" },
  release: { tile: "bg-sunken text-fg-2", icon: <Buildings size={20} />, label: "Rooms held" },
};

type Todo = {
  key: string;
  kind: Kind;
  text: React.ReactNode;
  sub: string;
  action: { label: string; href: string; whatsapp?: boolean; external?: boolean };
  noteId?: string;
};

async function HomeContent() {
  const me = await requireUser();
  const today = todayISO();
  const monthStart = `${today.slice(0, 8)}01`;
  const weekEnd = addDays(today, 6);

  const [money, arrivals, quotes, unpaid, followUps, drafts, releasing, costs, hotelPaid] = await Promise.all([
    db.execute<{ to_collect: number; owing: number; old_due: number; collected: number; billed: number }>(sql`
      with open as (
        select b.total - coalesce((select sum(r.amount) from bill_receipts r where r.bill_id = b.id), 0) as due, b.bill_date
        from bills b where b.status = 'final' and b.is_sale
      )
      select
        coalesce((select sum(due) from open where due > 0.004), 0)::float8 as to_collect,
        (select count(*) from open where due > 0.004)::int as owing,
        coalesce((select sum(due) from open where due > 0.004 and bill_date < ${addDays(today, -30)}::date), 0)::float8 as old_due,
        coalesce((select sum(amount) from payments where status = 'active' and paid_on between ${monthStart}::date and ${today}::date), 0)::float8 as collected,
        coalesce((select sum(total) from bills where status = 'final' and is_sale and bill_date between ${monthStart}::date and ${today}::date), 0)::float8 as billed
    `),
    // Groups arriving this week: issued bills, and proformas not yet billed.
    db.execute<{
      id: string;
      number: string;
      is_sale: boolean;
      client: string;
      team: string | null;
      phone: string;
      company: string;
      members: string | null;
      hotel: string | null;
      check_in: string;
      total: number;
      paid: number;
    }>(sql`
      select * from (
        select b.id, b.number, b.is_sale,
          coalesce(b.snapshot->'client'->>'name', c.name) as client,
          nullif(b.data->'details'->>'bookingRef', '') as team,
          coalesce(nullif(b.snapshot->'client'->>'phone', ''), pc.phone, '') as phone,
          coalesce(b.snapshot->'company'->>'name', '') as company,
          nullif(b.data->'details'->>'members', '') as members,
          nullif(b.data->'details'->>'hotelName', '') as hotel,
          coalesce(
            nullif(b.data->'details'->>'checkIn', ''),
            (select min(l.check_in)::text from bill_lines l where l.bill_id = b.id and l.kind = 'room')
          ) as check_in,
          b.total::float8 as total,
          coalesce((select sum(r.amount) from bill_receipts r where r.bill_id = b.id), 0)::float8 as paid
        from bills b
        join formats f on f.id = b.format_id
        join clients c on c.id = b.client_id
        left join lateral (
          select cc.phone from client_contacts cc where cc.client_id = c.id order by cc.is_primary desc, cc.created_at limit 1
        ) pc on true
        where b.status = 'final'
          and (b.is_sale or (f.layout = 'proforma'
            and not exists (select 1 from bills ch where ch.source_bill_id = b.id and ch.status <> 'cancelled')))
      ) x
      where check_in::date between ${today}::date and ${weekEnd}::date
      order by check_in, client
    `),
    // Quotations sent and not yet answered: not declined, revised, or turned into a proforma or bill.
    db.execute<{ id: string; number: string; client: string; phone: string; company: string; event: string | null; total: number; age: number }>(sql`
      select b.id, b.number,
        coalesce(b.snapshot->'client'->>'name', c.name) as client,
        coalesce(nullif(b.snapshot->'client'->>'phone', ''), pc.phone, '') as phone,
        coalesce(b.snapshot->'company'->>'name', '') as company,
        nullif(b.data->'details'->>'eventName', '') as event,
        b.total::float8 as total,
        (${today}::date - b.bill_date)::int as age
      from bills b
      join formats f on f.id = b.format_id
      join clients c on c.id = b.client_id
      left join lateral (
        select cc.phone from client_contacts cc where cc.client_id = c.id order by cc.is_primary desc, cc.created_at limit 1
      ) pc on true
      where b.status = 'final' and f.layout = 'quotation'
        and not exists (select 1 from bills ch where ch.source_bill_id = b.id and ch.status <> 'cancelled')
      order by b.bill_date, b.created_at
    `),
    // Bills still owed on, oldest first.
    db.execute<{ id: string; number: string; title: string; client: string; phone: string; company: string; bill_date: string; due: number; age: number }>(sql`
      select * from (
        select b.id, b.number, coalesce(b.snapshot->'format'->>'title', 'Invoice') as title,
          coalesce(b.snapshot->'client'->>'name', c.name) as client,
          coalesce(nullif(b.snapshot->'client'->>'phone', ''), pc.phone, '') as phone,
          coalesce(b.snapshot->'company'->>'name', '') as company,
          b.bill_date::text as bill_date,
          (b.total - coalesce((select sum(r.amount) from bill_receipts r where r.bill_id = b.id), 0))::float8 as due,
          (${today}::date - b.bill_date)::int as age
        from bills b
        join clients c on c.id = b.client_id
        left join lateral (
          select cc.phone from client_contacts cc where cc.client_id = c.id order by cc.is_primary desc, cc.created_at limit 1
        ) pc on true
        where b.status = 'final' and b.is_sale
      ) x
      where due > 0.004 and age >= 7
      order by age desc
      limit 4
    `),
    db.execute<{ id: string; body: string; follow_up_on: string; client: string; phone: string }>(sql`
      select n.id, n.body, n.follow_up_on::text as follow_up_on, c.name as client, coalesce(pc.phone, '') as phone
      from client_notes n
      join clients c on c.id = n.client_id
      left join lateral (
        select cc.phone from client_contacts cc where cc.client_id = c.id order by cc.is_primary desc, cc.created_at limit 1
      ) pc on true
      where n.follow_up_on is not null and not n.done and n.follow_up_on <= ${today}::date
      order by n.follow_up_on
      limit 4
    `),
    db.execute<{ id: string; client: string; format: string; total: number; age: number }>(sql`
      select b.id, coalesce(nullif(b.data->'billTo'->>'name', ''), c.name) as client, f.name as format,
        b.total::float8 as total, (${today}::date - (b.updated_at at time zone 'Asia/Kolkata')::date)::int as age
      from bills b
      join clients c on c.id = b.client_id
      join formats f on f.id = b.format_id
      where b.status = 'draft'
      order by b.updated_at desc
      limit 3
    `),
    db.execute<{ id: string; room_type_id: string; room: string; hotel: string; release_date: string; first_night: string; last_night: string }>(sql`
      select sb.id, sb.room_type_id, rt.name as room, h.name as hotel,
        sb.release_date::text as release_date,
        greatest(sb.first_night, ${today}::date)::text as first_night,
        sb.last_night::text as last_night
      from stock_blocks sb
      join room_types rt on rt.id = sb.room_type_id
      join hotels h on h.id = rt.hotel_id
      where sb.release_date between ${today}::date and ${weekEnd}::date and sb.last_night >= ${today}::date
      order by sb.release_date
      limit 3
    `),
    roomCosts(db, today),
    db.execute<{ hotel_id: string; paid: number }>(sql`
      select hotel_id, sum(amount)::float8 as paid from hotel_payments where status = 'active' group by hotel_id
    `),
  ]);

  const m = money.rows[0];
  // What the hotels are still owed, from the rooms held, less what was paid.
  const owedByHotel = new Map<string, number>();
  for (const c of costs) owedByHotel.set(c.hotelId, (owedByHotel.get(c.hotelId) ?? 0) + c.owed);
  for (const p of hotelPaid.rows) owedByHotel.set(p.hotel_id, (owedByHotel.get(p.hotel_id) ?? 0) - p.paid);
  const hotelBalances = [...owedByHotel.values()].map(round2).filter((v) => v > 0.004);
  const toPayHotels = round2(hotelBalances.reduce((a, b) => a + b, 0));

  const releases = (
    await Promise.all(
      releasing.rows.map(async (b) => {
        const rows = await nights(db, b.first_night, b.last_night, b.room_type_id);
        return { ...b, unsold: rows.reduce((sum, r) => sum + Math.max(r.held - r.sold, 0), 0) };
      }),
    )
  ).filter((b) => b.unsold > 0);

  const groups = arrivals.rows.map((a) => ({
    ...a,
    name: a.team || a.client,
    // A proforma has not been billed yet, so all of it is still to collect.
    due: round2(a.is_sale ? a.total - a.paid : a.total),
  }));
  const waiting = quotes.rows;
  const waitingTotal = round2(waiting.reduce((s, q) => s + q.total, 0));

  /* Today's list, most urgent first. */
  const todos: Todo[] = [];
  for (const g of groups.filter((g) => g.due > 0.004 && daysBetween(today, g.check_in) <= 3)) {
    todos.push({
      key: `arrive-${g.id}`,
      kind: "arrival",
      text: (
        <>
          <b>{g.name}</b> arrives {arrivalWords(today, g.check_in)}, <b>{inr(g.due)}</b> still due
        </>
      ),
      sub: [g.hotel, g.members ? `${g.members} people` : ""].filter(Boolean).join(" · ") || "Arrival",
      action: {
        label: "Ask for balance",
        whatsapp: true,
        external: true,
        href: whatsapp(
          g.phone,
          `Dear ${g.client},\n\nA gentle reminder that ${inr(g.due)} is still due before your check-in on ${fmtDateLong(g.check_in)}.\n\n${g.company}`.trim(),
        ),
      },
    });
  }
  const latePay = (b: (typeof unpaid.rows)[number]): Todo => ({
    key: `due-${b.id}`,
    kind: "late",
    text: (
      <>
        <b>{b.client}</b> still owes <b>{inr(b.due)}</b>
      </>
    ),
    sub: `${b.number}, billed ${b.age} days ago`,
    action: {
      label: "Remind",
      whatsapp: true,
      external: true,
      href: whatsapp(
        b.phone,
        `Dear ${b.client},\n\nA gentle reminder that ${inr(b.due)} is still due on ${b.title} ${b.number} dated ${fmtDateLong(b.bill_date)}.\n\n${b.company}`.trim(),
      ),
    },
  });
  for (const b of unpaid.rows.filter((b) => b.age > 30)) todos.push(latePay(b));
  for (const f of followUps.rows) {
    todos.push({
      key: `note-${f.id}`,
      kind: "call",
      text: (
        <>
          <b>{f.client}</b>: {f.body}
        </>
      ),
      sub: f.follow_up_on < today ? `Was due ${fmtDate(f.follow_up_on)}` : "Due today",
      action: f.phone ? { label: "Call", href: `tel:${f.phone.replace(/[^\d+]/g, "")}` } : { label: "Open client", href: "/clients" },
      noteId: f.id,
    });
  }
  for (const q of waiting.filter((q) => q.age >= 3).slice(0, 3)) {
    todos.push({
      key: `quote-${q.id}`,
      kind: "follow",
      text: (
        <>
          No reply on the <b>{q.event ?? q.client}</b> quotation for {q.age} days
        </>
      ),
      sub: `${q.client} · ${inr(q.total)}`,
      action: {
        label: "Follow up",
        whatsapp: true,
        external: true,
        href: whatsapp(
          q.phone,
          `Dear ${q.client},\n\nFollowing up on our quotation ${q.number}${q.event ? ` for ${q.event}` : ""}. Please let us know if you would like to go ahead, or if anything should change.\n\n${q.company}`.trim(),
        ),
      },
    });
  }
  for (const b of unpaid.rows.filter((b) => b.age <= 30)) todos.push(latePay(b));
  for (const r of releases) {
    todos.push({
      key: `release-${r.id}`,
      kind: "release",
      text: (
        <>
          <b>{r.unsold} room nights</b> at {r.hotel} go back on {fmtDate(r.release_date)}
        </>
      ),
      sub: `${r.room}, unsold`,
      action: { label: "Open rooms", href: "/inventory" },
    });
  }
  for (const d of drafts.rows) {
    todos.push({
      key: `draft-${d.id}`,
      kind: "unsent",
      text: (
        <>
          {d.format} for <b>{d.client}</b> is not sent yet
        </>
      ),
      sub: d.age <= 0 ? "Started today" : d.age === 1 ? "Last changed yesterday" : `Last changed ${d.age} days ago`,
      action: { label: "Continue", href: `/bill-generator?bill=${d.id}` },
    });
  }
  const shown = todos.slice(0, 8);

  /* The greeting and the one-line summary of the day. */
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLine = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
  const soon = groups.filter((g) => daysBetween(today, g.check_in) <= 3).length;
  const nudges = todos.filter((t) => t.kind === "late" || (t.kind === "arrival" && t.action.whatsapp)).length;
  const summary =
    [
      soon ? `${soon} group${soon > 1 ? "s" : ""} arrive${soon > 1 ? "" : "s"} in the next 3 days` : "",
      nudges ? `${nudges} payment${nudges > 1 ? "s" : ""} need${nudges > 1 ? "" : "s"} a nudge` : "",
    ]
      .filter(Boolean)
      .join(", and ") || (shown.length ? "Here is what needs you today." : "Nothing urgent today.");

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    return { date, groups: groups.filter((g) => g.check_in === date) };
  });
  const collectedShare = m.billed > 0 ? Math.min(100, Math.round((m.collected / m.billed) * 100)) : null;
  const firstName = (me.name || "").split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      {/* Greeting */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-ui font-medium uppercase tracking-[0.08em] text-fg-3">{dateLine}</p>
          <h1 className="text-[30px] font-semibold leading-[38px] tracking-tight text-fg">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-body text-fg-2">{summary.charAt(0).toUpperCase() + summary.slice(1)}{summary.endsWith(".") ? "" : "."}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/bill-generator"
            className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-3 text-body font-medium text-fg hover:bg-sunken md:h-10"
          >
            New bill
          </Link>
          <Link
            href="/bill-generator?format=quotation"
            className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink hover:bg-ink-hover md:h-10"
          >
            New quotation
          </Link>
        </div>
      </header>

      {/* Money */}
      <div className="grid gap-3 md:grid-cols-3">
        <Link href="/bills" className={cx(card, "transition-colors duration-150 hover:bg-sunken")}>
          <span className="flex items-center gap-2 text-ui font-medium text-fg-2">
            <span className="grid size-7 place-items-center rounded-full bg-warn-soft text-warn" aria-hidden>
              <HandCoins size={16} />
            </span>
            To collect from clients
          </span>
          <span className="mt-3 block text-[32px] font-semibold leading-[38px] tracking-tight text-fg tabular-nums">{inr(m.to_collect)}</span>
          <span className="block text-ui text-fg-3">
            {m.owing ? `from ${m.owing} bill${m.owing > 1 ? "s" : ""}` : "Nobody owes you anything"}
            {m.old_due > 0 ? <span className="font-medium text-bad"> · {inr(m.old_due)} is over a month old</span> : null}
          </span>
        </Link>
        <Link href="/payments" className={cx(card, "transition-colors duration-150 hover:bg-sunken")}>
          <span className="flex items-center gap-2 text-ui font-medium text-fg-2">
            <span className="grid size-7 place-items-center rounded-full bg-ok-soft text-ok" aria-hidden>
              <CurrencyInr size={16} />
            </span>
            Collected this month
          </span>
          <span className="mt-3 block text-[32px] font-semibold leading-[38px] tracking-tight text-fg tabular-nums">{inr(m.collected)}</span>
          {collectedShare !== null ? (
            <>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`${collectedShare} percent of this month's billing collected`}>
                <span className="block h-full rounded-full bg-ok" style={{ width: `${collectedShare}%` }} />
              </span>
              <span className="mt-1 block text-ui text-fg-3">
                {collectedShare}% of {inr(m.billed)} billed this month
              </span>
            </>
          ) : (
            <span className="block text-ui text-fg-3">Nothing billed yet this month</span>
          )}
        </Link>
        <Link href="/payments/hotels" className={cx(card, "transition-colors duration-150 hover:bg-sunken")}>
          <span className="flex items-center gap-2 text-ui font-medium text-fg-2">
            <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
              <Buildings size={16} />
            </span>
            To pay hotels
          </span>
          <span className="mt-3 block text-[32px] font-semibold leading-[38px] tracking-tight text-fg tabular-nums">{inr(toPayHotels)}</span>
          <span className="block text-ui text-fg-3">
            {hotelBalances.length ? `${hotelBalances.length} hotel${hotelBalances.length > 1 ? "s" : ""}` : "Nothing owed to hotels"}
          </span>
        </Link>
      </div>

      {/* This week's arrivals */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-body font-semibold text-fg">Arriving this week</h2>
          <p className="flex items-center gap-1.5 text-ui text-fg-3">
            <span className="size-2 rounded-full bg-bad" aria-hidden /> money still due
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 gap-2">
            {week.map((d, i) => (
              <div key={d.date} className={cx("rounded-lg p-2", i === 0 ? "bg-ink text-on-ink" : "bg-sunken")}>
                <p className={cx("text-ui", i === 0 ? "text-on-ink/80" : "text-fg-3")}>{i === 0 ? "Today" : dayName(d.date)}</p>
                <p className="text-title font-semibold tabular-nums">{Number(d.date.slice(8))}</p>
                <div className="mt-2 space-y-1.5">
                  {d.groups.length === 0 ? (
                    <p className={cx("text-ui", i === 0 ? "text-on-ink/60" : "text-fg-3")}>—</p>
                  ) : (
                    d.groups.map((g) => (
                      <Link key={g.id} href={`/bills/${g.id}`} className="block rounded-md bg-surface px-2 py-1.5 text-fg shadow-[0_1px_0_var(--line)] hover:bg-canvas">
                        <span className="flex items-center gap-1.5 truncate text-ui font-medium">
                          {g.due > 0.004 ? <span className="size-2 shrink-0 rounded-full bg-bad" aria-label="Money still due" /> : null}
                          <span className="truncate">{g.name}</span>
                        </span>
                        <span className="block truncate text-ui text-fg-3">{g.members ? `${g.members} people` : g.hotel ?? ""}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Today */}
        <section className={card}>
          <h2 className="mb-1 text-body font-semibold text-fg">Today</h2>
          {shown.length === 0 ? (
            <p className="py-6 text-center text-body text-fg-2">You are all caught up. Nothing needs you right now.</p>
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((t) => (
                <li key={t.key} className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
                  <span className={cx("grid size-10 shrink-0 place-items-center rounded-lg", KINDS[t.kind].tile)} aria-hidden>
                    {KINDS[t.kind].icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-fg [&_b]:font-semibold">{t.text}</p>
                    <p className="text-ui text-fg-3">{t.sub}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {t.action.external ? (
                      <a
                        href={t.action.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-ui font-medium text-fg hover:bg-sunken"
                      >
                        {t.action.whatsapp ? <WhatsappLogo size={16} className="text-ok" /> : null}
                        {t.action.label}
                      </a>
                    ) : t.action.href.startsWith("tel:") ? (
                      <a href={t.action.href} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-ui font-medium text-fg hover:bg-sunken">
                        <Phone size={16} />
                        {t.action.label}
                      </a>
                    ) : (
                      <Link href={t.action.href} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-ui font-medium text-fg hover:bg-sunken">
                        {t.action.label}
                      </Link>
                    )}
                    {t.noteId ? <FollowUpDone noteId={t.noteId} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {todos.length > shown.length ? (
            <p className="pt-2 text-ui text-fg-3">and {todos.length - shown.length} more after these</p>
          ) : null}
        </section>

        {/* Enquiries */}
        <section className={cx(card, "flex flex-col")}>
          <h2 className="text-body font-semibold text-fg">Enquiries</h2>
          <p className="text-ui text-fg-3">Quotations sent, waiting for the client&rsquo;s answer</p>
          <p className="mt-4 text-[32px] font-semibold leading-[38px] tracking-tight text-fg tabular-nums">{waiting.length}</p>
          <p className="text-body text-fg-2">{waiting.length ? `worth ${inr(waitingTotal)}` : "No quotations waiting"}</p>
          {waiting.length ? (
            <ul className="mt-4 space-y-1">
              {[...waiting]
                .sort((a, b) => a.age - b.age)
                .slice(0, 5)
                .map((q) => (
                  <li key={q.id}>
                    <Link href={`/bills/${q.id}`} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-sunken">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-ui font-semibold text-fg-2" aria-hidden>
                        {initials(q.client)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-fg">{q.event ?? q.number}</span>
                        <span className="block truncate text-ui text-fg-3">{q.client}</span>
                      </span>
                      <span className={cx("text-ui tabular-nums", q.age > 7 ? "font-medium text-bad" : "text-fg-3")}>
                        {q.age === 0 ? "today" : q.age === 1 ? "1 day" : `${q.age} days`}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          ) : null}
          <Link href="/bills" className="mt-auto inline-flex items-center gap-1 pt-4 text-ui font-medium text-accent hover:underline">
            All quotations and bills <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-canvas">
      {/* On a phone there is no sidebar, so Search sits at the top of Home. */}
      <div className="px-4 pt-3 md:hidden">
        <SearchButton className="h-11" />
      </div>
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <HomeContent />
      </Suspense>

      {/* On a phone the bottom bar has room for five screens; the rest are here. */}
      <nav aria-label="More" className="px-4 pb-6 md:hidden">
        <h2 className="mb-2 text-ui font-semibold text-fg-3">More</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {[
            ["/payments", "Payments"],
            ["/payments/hotels", "Payments to hotels"],
            ["/reports", "Reports"],
            ["/import", "Import from a spreadsheet"],
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
    </div>
  );
}
