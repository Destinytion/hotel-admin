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

type Company = Required<CompanyInput> & { formats: string[]; changedBy: string };

const blank: CompanyInput = {
  name: "",
  initials: "",
  color: COMPANY_COLORS[0],
  address: "",
  registration: "",
  bankDetails: "",
  terms: "",
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

const toInput = ({ id, version, name, initials, color, address, registration, bankDetails, terms, active }: Company): CompanyInput => ({
  id,
  version,
  name,
  initials,
  color,
  address,
  registration,
  bankDetails,
  terms,
  active,
});

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
              <CompanyChip initials={c.initials} color={c.color} size={28} />
              <div className="min-w-40 flex-1">
                <p className="truncate text-body font-medium text-fg">{c.name}</p>
                <p className="truncate text-ui text-fg-3">
                  {c.registration || "No registration number"}, {c.formats.length} formats
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
            <Field
              label="Registration line"
              htmlFor="co-reg"
              hint="Printed as typed, for example GSTIN 08AAAAA0000A1Z5. Leave empty if none."
            >
              <Input
                id="co-reg"
                value={form.registration}
                onChange={(e) => set({ registration: e.target.value })}
              />
            </Field>
            <Field label="Bank details" htmlFor="co-bank">
              <Textarea
                id="co-bank"
                rows={2}
                value={form.bankDetails}
                onChange={(e) => set({ bankDetails: e.target.value })}
              />
            </Field>
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
                Three starter formats are added with the company: invoice with a tax line, invoice
                without, and quotation. Your own formats replace them later.
              </p>
            )}
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : null}
    </section>
  );
}
