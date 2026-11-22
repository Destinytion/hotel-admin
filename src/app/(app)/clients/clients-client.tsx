"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, Phone, WhatsappLogo } from "@phosphor-icons/react";
import {
  Button,
  EmptyState,
  ErrorText,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  cx,
} from "@/components/ui";
import { ConflictNotice, useEvery } from "@/components/live";
import { SidePanel } from "@/components/side-panel";
import { fmtDate, inr } from "@/lib/format";
import {
  addClientNote,
  deleteClient,
  getClientDetail,
  saveClient,
  setNoteDone,
  type ClientDetail,
  type ClientInput,
  type ClientType,
} from "./actions";

export type ClientRow = {
  id: string;
  name: string;
  type: ClientType;
  address: string;
  registration: string;
  tags: string[];
  contactName: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
  outstanding: number;
  lastActivity: string;
  /** Goes up on every save; used to notice someone else's change. */
  version: number;
  changedBy: string;
};

const toInput = (client: ClientRow): ClientInput => ({
  id: client.id,
  version: client.version,
  name: client.name,
  type: client.type,
  address: client.address,
  registration: client.registration,
  tags: client.tags.join(", "),
  contactName: client.contactName,
  contactRole: client.contactRole,
  contactPhone: client.contactPhone,
  contactEmail: client.contactEmail,
});

const TYPE_LABEL: Record<ClientType, string> = {
  company: "Company",
  agent: "Agent",
  individual: "Individual",
};
const FILTERS = ["all", "company", "agent", "individual"] as const;

const blank: ClientInput = {
  name: "",
  type: "company",
  address: "",
  registration: "",
  tags: "",
  contactName: "",
  contactRole: "",
  contactPhone: "",
  contactEmail: "",
};

function Balance({ value }: { value: number }) {
  if (value > 0) return <span className="font-medium text-fg">{inr(value)}</span>;
  if (value < 0) return <span className="text-ok">Advance {inr(-value)}</span>;
  return <span className="text-fg-3">Settled</span>;
}

export function ClientsClient({ rows }: { rows: ClientRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [form, setForm] = useState<ClientInput | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows.filter(
      (c) =>
        (filter === "all" || c.type === filter) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.contactName.toLowerCase().includes(q) ||
          (qDigits.length > 2 && c.contactPhone.replace(/\D/g, "").includes(qDigits))),
    );
  }, [rows, query, filter]);

  const open = rows.find((c) => c.id === openId) ?? null;
  const panelOpen = Boolean(open || form);

  const loadDetail = useCallback(async (id: string) => {
    const result = await getClientDetail(id);
    if (result.ok) setDetail(result.data);
  }, []);

  // The open client's timeline is kept current while others add bills and payments.
  const reloadOpen = useCallback(() => {
    if (openId) void loadDetail(openId);
  }, [openId, loadDetail]);
  useEvery(15, reloadOpen);

  // The client being edited, as it is in the database right now.
  const latest = form?.id ? rows.find((c) => c.id === form.id) : undefined;
  const stale = Boolean(form && latest && !pending && latest.version !== form.version);
  const deletedMeanwhile = Boolean(form?.id && !latest && !pending);

  function openClient(id: string) {
    setForm(null);
    setError("");
    setDetail(null);
    setOpenId(id);
    void loadDetail(id);
  }

  function startForm(client?: ClientRow) {
    setError("");
    setForm(client ? toInput(client) : { ...blank });
  }

  const closeAll = () => {
    setForm(null);
    setOpenId(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setPending(true);
    setError("");
    const result = await saveClient(form);
    setPending(false);
    if (!result.ok) {
      // On a conflict, fetch the other person's version so the choice can be offered.
      if (result.conflict) return router.refresh();
      return setError(result.error);
    }
    setForm(null);
    openClient(result.data.id);
  }

  const set = (patch: Partial<ClientInput>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className={cx("transition-[padding] duration-150", panelOpen && "lg:pr-[420px]")}>
      <PageHeader
        title="Clients"
        description={rows.length === 1 ? "1 client" : `${rows.length} clients`}
        actions={
          <Button variant="primary" onClick={() => startForm()}>
            Add client
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No clients yet"
          action={
            <Button variant="primary" onClick={() => startForm()}>
              Add client
            </Button>
          }
        >
          Clients are the companies, agents and guests you bill. Add one to start.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlass
                size={16}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3"
              />
              <Input
                type="search"
                aria-label="Search clients"
                placeholder="Search name, contact or phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div role="group" aria-label="Client type" className="flex rounded-md border border-line p-0.5">
              {FILTERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={filter === t}
                  onClick={() => setFilter(t)}
                  className={cx(
                    "h-10 rounded-md px-2.5 text-ui font-medium transition-colors duration-150 md:h-8",
                    filter === t ? "bg-sunken text-fg" : "text-fg-3 hover:text-fg",
                  )}
                >
                  {t === "all" ? "All" : TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No clients match">Clear the search or change the type.</EmptyState>
          ) : (
            <>
              <table className="hidden w-full border-collapse md:table">
                <thead>
                  <tr className="border-y border-line bg-canvas text-left text-ui text-fg-3">
                    <th className="px-6 py-2 font-medium">Client</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className={cx("px-3 py-2 font-medium", panelOpen && "hidden")}>Last activity</th>
                    <th className="px-6 py-2 text-right font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => openClient(c.id)}
                      aria-selected={openId === c.id}
                      className={cx(
                        "h-10 cursor-pointer border-b border-line text-body transition-colors duration-150",
                        openId === c.id ? "bg-accent-soft" : "hover:bg-sunken",
                      )}
                    >
                      <td className="px-6 font-medium text-fg">
                        <button
                          type="button"
                          className="rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          {c.name}
                        </button>
                      </td>
                      <td className="px-3 text-fg-2">{TYPE_LABEL[c.type]}</td>
                      <td className="px-3 text-fg-2">
                        {c.contactName}
                        <span className={cx("ml-2 text-fg-3 tabular-nums", panelOpen && "hidden")}>
                          {c.contactPhone}
                        </span>
                      </td>
                      <td className={cx("px-3 text-fg-2 tabular-nums", panelOpen && "hidden")}>
                        {fmtDate(c.lastActivity)}
                      </td>
                      <td className="px-6 text-right tabular-nums">
                        <Balance value={c.outstanding} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <ul className="divide-y divide-line border-y border-line md:hidden">
                {visible.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => openClient(c.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body font-medium text-fg">{c.name}</p>
                        <p className="truncate text-ui text-fg-3">
                          {[TYPE_LABEL[c.type], c.contactName].filter(Boolean).join(", ")}
                        </p>
                      </div>
                      <span className="text-body tabular-nums">
                        <Balance value={c.outstanding} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {form ? (
        <SidePanel
          title={form.id ? "Edit client" : "Add client"}
          onClose={() => setForm(null)}
          footer={
            <>
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" type="submit" form="client-form" disabled={pending}>
                {pending ? "Saving" : "Save client"}
              </Button>
            </>
          }
        >
          <form id="client-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
            {stale && latest ? (
              <ConflictNotice
                who={latest.changedBy}
                thing="client"
                onLoadLatest={() => {
                  setError("");
                  setForm(toInput(latest));
                }}
                onKeepMine={() => set({ version: latest.version })}
              />
            ) : null}
            {deletedMeanwhile ? (
              <p role="alert" data-conflict className="rounded-lg border border-bad bg-bad-soft p-3 text-body font-medium text-fg">
                This client was deleted by someone else while you had it open. It can no longer be saved.
              </p>
            ) : null}
            <Field label="Client name" htmlFor="cl-name">
              <Input id="cl-name" value={form.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Type" htmlFor="cl-type">
              <Select
                id="cl-type"
                value={form.type}
                onChange={(e) => set({ type: e.target.value as ClientType })}
              >
                <option value="company">Company</option>
                <option value="agent">Agent</option>
                <option value="individual">Individual</option>
              </Select>
            </Field>
            <Field label="Address" htmlFor="cl-address">
              <Textarea
                id="cl-address"
                rows={2}
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Field>
            <Field label="Registration line" htmlFor="cl-reg" hint="Printed on bills as typed. Leave empty if none.">
              <Input
                id="cl-reg"
                value={form.registration}
                onChange={(e) => set({ registration: e.target.value })}
              />
            </Field>
            <Field label="Tags" htmlFor="cl-tags" hint="Separate with commas.">
              <Input id="cl-tags" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
            </Field>

            <h3 className="border-t border-line pt-4 text-body font-semibold text-fg">Contact person</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name" htmlFor="cl-cname">
                <Input
                  id="cl-cname"
                  value={form.contactName}
                  onChange={(e) => set({ contactName: e.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="cl-crole">
                <Input
                  id="cl-crole"
                  value={form.contactRole}
                  onChange={(e) => set({ contactRole: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Phone" htmlFor="cl-cphone">
              <Input
                id="cl-cphone"
                type="tel"
                inputMode="tel"
                value={form.contactPhone}
                onChange={(e) => set({ contactPhone: e.target.value })}
              />
            </Field>
            <Field label="Email" htmlFor="cl-cemail">
              <Input
                id="cl-cemail"
                type="email"
                inputMode="email"
                value={form.contactEmail}
                onChange={(e) => set({ contactEmail: e.target.value })}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : open ? (
        <ClientPanel
          key={open.id}
          client={open}
          detail={detail}
          onClose={closeAll}
          onEdit={() => startForm(open)}
          onChanged={() => loadDetail(open.id)}
          onDeleted={closeAll}
        />
      ) : null}
    </div>
  );
}

function ClientPanel({
  client,
  detail,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  client: ClientRow;
  detail: ClientDetail | null;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [note, setNote] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const phoneDigits = client.contactPhone.replace(/\D/g, "");

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await addClientNote({ clientId: client.id, body: note, followUpOn });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setNote("");
    setFollowUpOn("");
    await onChanged();
  }

  async function toggleDone(id: string, done: boolean) {
    const result = await setNoteDone(id, done);
    if (result.ok) await onChanged();
  }

  async function remove() {
    setPending(true);
    setError("");
    const result = await deleteClient(client.id);
    setPending(false);
    if (!result.ok) {
      setConfirmDelete(false);
      return setError(result.error);
    }
    onDeleted();
  }

  return (
    <SidePanel
      title={client.name}
      subtitle={[TYPE_LABEL[client.type], client.address].filter(Boolean).join(", ")}
      onClose={onClose}
      footer={
        <>
          {confirmDelete ? (
            <>
              <span className="mr-auto text-ui text-fg-2">Delete this client?</span>
              <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
              <Button variant="primary" onClick={remove} disabled={pending}>
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="mr-auto">
                Delete
              </Button>
              <Button onClick={onEdit}>Edit</Button>
              <Link
                href={`/bill-generator?client=${client.id}`}
                className="inline-flex h-11 items-center rounded-md bg-ink px-3 text-body font-medium text-on-ink transition-colors duration-150 hover:bg-ink-hover md:h-9"
              >
                New bill
              </Link>
            </>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 border-b border-line">
        <div className="border-r border-line px-4 py-3 md:px-5">
          <p className="text-ui text-fg-3">Outstanding</p>
          <p className="text-title font-semibold tracking-tight tabular-nums">
            <Balance value={client.outstanding} />
          </p>
        </div>
        <div className="px-4 py-3 md:px-5">
          <p className="text-ui text-fg-3">Last activity</p>
          <p className="text-title font-semibold tracking-tight text-fg tabular-nums">
            {fmtDate(client.lastActivity)}
          </p>
        </div>
      </div>

      <section className="border-b border-line px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">Contact person</h3>
        {client.contactName || client.contactPhone || client.contactEmail ? (
          <>
            <p className="mt-1 text-body font-medium text-fg">{client.contactName || "No name"}</p>
            {client.contactRole ? <p className="text-ui text-fg-2">{client.contactRole}</p> : null}
            {client.contactEmail ? <p className="text-ui text-fg-2">{client.contactEmail}</p> : null}
            {phoneDigits ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`tel:${client.contactPhone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9"
                >
                  <Phone size={16} />
                  {client.contactPhone}
                </a>
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9"
                >
                  <WhatsappLogo size={16} />
                  WhatsApp
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-body text-fg-2">No contact person yet. Use Edit to add one.</p>
        )}
        {client.registration ? <p className="mt-3 text-ui text-fg-2">{client.registration}</p> : null}
        {client.tags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {client.tags.map((t) => (
              <StatusBadge key={t} tone="muted">
                {t}
              </StatusBadge>
            ))}
          </div>
        ) : null}
      </section>

      <section className="border-b border-line px-4 py-4 md:px-5">
        <form onSubmit={saveNote} className="flex flex-col gap-2">
          <label htmlFor="note" className="text-ui font-medium text-fg-3">
            Add a note
          </label>
          <Textarea
            id="note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was said or agreed"
          />
          <div className="flex items-end gap-2">
            <Field label="Follow up on" htmlFor="followUp" className="flex-1">
              <Input
                id="followUp"
                type="date"
                value={followUpOn}
                onChange={(e) => setFollowUpOn(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={pending || !note.trim()}>
              Add note
            </Button>
          </div>
        </form>
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </section>

      <section className="px-4 py-4 md:px-5">
        <h3 className="text-ui font-medium text-fg-3">Timeline</h3>
        {!detail ? (
          <div aria-hidden className="mt-2 space-y-2">
            <div className="h-10 rounded-md bg-sunken" />
            <div className="h-10 rounded-md bg-sunken" />
          </div>
        ) : detail.timeline.length === 0 ? (
          <p className="mt-2 text-body text-fg-2">
            Nothing yet. Bills, payments and notes for this client appear here.
          </p>
        ) : (
          <ol data-timeline className="mt-2 divide-y divide-line">
            {detail.timeline.map((item) => (
              <li key={item.kind + item.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto] gap-x-3 py-2.5">
                <span className="text-ui text-fg-3 tabular-nums">{fmtDate(item.date)}</span>
                <div className="min-w-0">
                  <p className="text-ui font-medium text-fg-2">{item.kind}</p>
                  {item.href ? (
                    <Link href={item.href} className="text-body text-accent hover:underline">
                      {item.text}
                    </Link>
                  ) : (
                    <p className="whitespace-pre-wrap text-body text-fg">{item.text}</p>
                  )}
                  {item.followUpOn ? (
                    <label className="mt-1 flex items-center gap-2 text-ui text-fg-2">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) => toggleDone(item.id, e.target.checked)}
                        className="size-4 accent-ink"
                      />
                      Follow up {fmtDate(item.followUpOn)}
                      {item.done ? ", done" : ""}
                    </label>
                  ) : null}
                </div>
                <span
                  className={cx(
                    "text-body font-medium tabular-nums",
                    item.kind === "Payment" ? "text-ok" : "text-fg",
                    item.cancelled && "text-fg-3 line-through",
                  )}
                >
                  {item.amount === null ? "" : inr(item.amount)}
                </span>
              </li>
            ))}
          </ol>
        )}
        {detail ? (
          <p data-record-history className="mt-4 border-t border-line pt-3 text-ui text-fg-3">
            Added by {detail.addedBy} on {fmtDate(detail.addedOn)}. Last changed by {detail.changedBy} on{" "}
            {fmtDate(detail.changedOn)}.
          </p>
        ) : null}
      </section>
    </SidePanel>
  );
}
