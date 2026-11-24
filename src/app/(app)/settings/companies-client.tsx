"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  CompanyChip,
  EmptyState,
  ErrorText,
  Field,
  Input,
  StatusBadge,
  Textarea,
  cx,
} from "@/components/ui";
import { ConflictNotice } from "@/components/live";
import { SidePanel } from "@/components/side-panel";
import { saveCompany, type CompanyInput } from "./actions";
import { COMPANY_COLORS } from "./colors";

type Company = Required<CompanyInput> & {
  formats: string[];
  changedBy: string;
  logoUrl: string | null;
  stampUrl: string | null;
};

const blank: CompanyInput = {
  name: "",
  initials: "",
  color: COMPANY_COLORS[0],
  address: "",
  registration: "",
  bankDetails: "",
  terms: "",
  email: "",
  phone: "",
  active: true,
};

const suggestInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const toInput = ({ id, version, name, initials, color, address, registration, bankDetails, terms, email, phone, active }: Company): CompanyInput => ({
  id,
  version,
  name,
  initials,
  color,
  address,
  registration,
  bankDetails,
  terms,
  email,
  phone,
  active,
});

/** Picks, shows and removes a company's logo or stamp. Saved as soon as it is picked. */
function PictureField({
  companyId,
  kind,
  url,
}: {
  companyId: string;
  kind: "logo" | "stamp";
  url: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const label = kind === "logo" ? "Logo" : "Stamp";

  async function send(method: "POST" | "DELETE", file?: File) {
    setPending(true);
    setError("");
    const body = new FormData();
    if (file) body.set("file", file);
    const res = await fetch(`/api/company-images/${companyId}/${kind}`, { method, body: file ? body : undefined });
    setPending(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return setError(data?.error ?? "That did not work. Try again.");
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ui font-medium text-fg-2">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-paper">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`${label} of this company`} className="max-h-14 max-w-14 object-contain" />
          ) : (
            <span className="text-ui text-fg-3">None</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-11 cursor-pointer items-center rounded-md border border-line bg-surface px-3 text-body font-medium text-fg transition-colors duration-150 hover:bg-sunken md:h-9">
            {pending ? "Saving" : url ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/png,image/jpeg"
              data-picture={kind}
              className="sr-only"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void send("POST", file);
              }}
            />
          </label>
          {url ? (
            <Button variant="ghost" onClick={() => send("DELETE")} disabled={pending}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-ui text-fg-3">
        {kind === "logo" ? "Printed at the top of bills and receipts." : "Printed at the bottom. A PNG with a clear background looks best."}
      </p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function CompaniesClient({ companies }: { companies: Company[] }) {
  const router = useRouter();
  const [form, setForm] = useState<CompanyInput | null>(null);
  const [initialsTouched, setInitialsTouched] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const open = (company?: Company) => {
    setError("");
    setInitialsTouched(Boolean(company));
    setForm(company ? toInput(company) : { ...blank });
  };
  const close = () => setForm(null);
  const set = (patch: Partial<CompanyInput>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setPending(true);
    setError("");
    const result = await saveCompany(form);
    setPending(false);
    if (result.ok) return close();
    if (result.conflict) {
      // Fetch the other person's version so the choice below can be offered.
      router.refresh();
      return;
    }
    setError(result.error);
  }

  // The same company as it is in the database right now.
  const latest = form?.id ? companies.find((c) => c.id === form.id) : undefined;
  const stale = Boolean(form && latest && !pending && latest.version !== form.version);

  return (
    <section className="px-4 py-5 md:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-fg">Companies</h2>
          <p className="text-ui text-fg-2">These appear in the Bill from dropdown.</p>
        </div>
        <Button variant="primary" onClick={() => open()}>
          Add company
        </Button>
      </div>

      {companies.length === 0 ? (
        <EmptyState title="No companies yet">
          Add the company you bill from. It needs a name and initials; the rest can be filled in later.
        </EmptyState>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {companies.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              {c.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.logoUrl} alt="" className="size-9 rounded-md border border-line bg-paper object-contain" />
              ) : (
                <CompanyChip initials={c.initials} color={c.color} size={28} />
              )}
              <div className="min-w-40 flex-1">
                <p className="truncate text-body font-medium text-fg">{c.name}</p>
                <p className="truncate text-ui text-fg-3">
                  {c.registration ? `GSTIN ${c.registration}` : "No GSTIN"}, {c.formats.join(", ")}
                </p>
              </div>
              {c.active ? null : <StatusBadge tone="muted">Hidden</StatusBadge>}
              <Button onClick={() => open(c)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <SidePanel
          title={form.id ? "Edit company" : "Add company"}
          onClose={close}
          footer={
            <>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" type="submit" form="company-form" disabled={pending}>
                {pending ? "Saving" : "Save company"}
              </Button>
            </>
          }
        >
          <form id="company-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
            {stale && latest ? (
              <ConflictNotice
                who={latest.changedBy}
                thing="company"
                onLoadLatest={() => {
                  setError("");
                  setForm(toInput(latest));
                }}
                onKeepMine={() => set({ version: latest.version })}
              />
            ) : null}
            <Field label="Company name" htmlFor="co-name">
              <Input
                id="co-name"
                value={form.name}
                autoFocus
                onChange={(e) =>
                  set({
                    name: e.target.value,
                    ...(initialsTouched ? {} : { initials: suggestInitials(e.target.value) }),
                  })
                }
              />
            </Field>
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
              <Field label="Initials" htmlFor="co-initials">
                <Input
                  id="co-initials"
                  value={form.initials}
                  maxLength={3}
                  onChange={(e) => {
                    setInitialsTouched(true);
                    set({ initials: e.target.value.toUpperCase() });
                  }}
                />
              </Field>
              <Field label="Colour">
                <div role="radiogroup" aria-label="Colour" className="flex h-11 items-center gap-2 md:h-9">
                  {COMPANY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={form.color === color}
                      aria-label={color}
                      onClick={() => set({ color })}
                      style={{ backgroundColor: color }}
                      className={cx(
                        "size-7 rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
                        form.color === color && "outline-2 outline-ink",
                      )}
                    />
                  ))}
                </div>
              </Field>
            </div>
            <Field label="Address" htmlFor="co-address" hint="Printed under the company name.">
              <Textarea
                id="co-address"
                rows={3}
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Field>
            <Field label="GSTIN" htmlFor="co-reg" hint="Printed on GST bills and proformas. Leave empty if none.">
              <Input
                id="co-reg"
                value={form.registration}
                onChange={(e) => set({ registration: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" htmlFor="co-email">
                <Input
                  id="co-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </Field>
              <Field label="Phone" htmlFor="co-phone">
                <Input id="co-phone" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
            </div>
            <Field label="Bank details" htmlFor="co-bank" hint="Printed on proformas, so clients know where to pay.">
              <Textarea
                id="co-bank"
                rows={4}
                value={form.bankDetails}
                onChange={(e) => set({ bankDetails: e.target.value })}
              />
            </Field>
            {form.id ? (
              <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <PictureField companyId={form.id} kind="logo" url={latest?.logoUrl ?? null} />
                <PictureField companyId={form.id} kind="stamp" url={latest?.stampUrl ?? null} />
              </div>
            ) : (
              <p className="text-ui text-fg-3">Save the company first, then add its logo and stamp.</p>
            )}
            <Field label="Terms printed on every bill" htmlFor="co-terms">
              <Textarea
                id="co-terms"
                rows={2}
                value={form.terms}
                onChange={(e) => set({ terms: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-body text-fg">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set({ active: e.target.checked })}
                className="size-4 accent-ink"
              />
              Show in the Bill from dropdown
            </label>
            {form.id ? null : (
              <p className="text-ui text-fg-3">
                The company gets your three formats: the GST bill, the Non-GST bill and the Proforma Invoice.
              </p>
            )}
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : null}
    </section>
  );
}
