"use client";

import { useState } from "react";
import { Button, ErrorText, Field, Input, Textarea } from "@/components/ui";
import { SidePanel } from "@/components/side-panel";
import { inr } from "@/lib/format";
import { deleteService, saveService, type ServiceInput } from "./services-actions";

type Service = { id: string; name: string; details: string; rate: number };

/** The services you sell besides rooms: transfers, tours, visas and so on. */
export function ServicesClient({ services }: { services: Service[] }) {
  const [form, setForm] = useState<(Omit<ServiceInput, "rate"> & { rate: string }) | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const open = (s?: Service) => {
    setError("");
    setForm(s ? { id: s.id, name: s.name, details: s.details, rate: String(s.rate) } : { name: "", details: "", rate: "" });
  };
  const set = (patch: Partial<NonNullable<typeof form>>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setPending(true);
    setError("");
    const result = await saveService({ ...form, rate: form.rate === "" ? 0 : Number(form.rate) });
    setPending(false);
    if (result.ok) setForm(null);
    else setError(result.error);
  }

  async function remove(id: string) {
    setPending(true);
    setError("");
    const result = await deleteService(id);
    setPending(false);
    setRemoving(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <section className="border-t border-line px-4 py-5 md:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-fg">Services</h2>
          <p className="text-ui text-fg-2">
            What you sell besides rooms. Pick them when making a bill; the rate can still be changed on each bill.
          </p>
        </div>
        <Button variant="primary" onClick={() => open()}>
          Add service
        </Button>
      </div>

      {!form ? <div className="mt-2"><ErrorText>{error}</ErrorText></div> : null}

      {services.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-body text-fg-2">
          No services yet. Add the ones you bill often, such as airport transfers or sightseeing tours.
        </p>
      ) : (
        <ul data-services className="mt-3 divide-y divide-line rounded-lg border border-line">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <div className="min-w-40 flex-1">
                <p className="truncate text-body font-medium text-fg">{s.name}</p>
                {s.details ? <p className="truncate text-ui text-fg-3">{s.details}</p> : null}
              </div>
              <span className="text-body text-fg tabular-nums">{s.rate ? inr(s.rate) : "Rate varies"}</span>
              {removing === s.id ? (
                <>
                  <span className="text-ui text-fg-2">Remove? Bills already made keep it.</span>
                  <Button onClick={() => setRemoving(null)} disabled={pending}>
                    Keep
                  </Button>
                  <Button variant="primary" onClick={() => remove(s.id)} disabled={pending}>
                    Yes, remove
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => open(s)}>Edit</Button>
                  <Button variant="ghost" onClick={() => setRemoving(s.id)}>
                    Remove
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {form ? (
        <SidePanel
          title={form.id ? "Edit service" : "Add service"}
          onClose={() => setForm(null)}
          footer={
            <>
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="primary" type="submit" form="service-form" disabled={pending}>
                {pending ? "Saving" : "Save service"}
              </Button>
            </>
          }
        >
          <form id="service-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5">
            <Field label="Name" htmlFor="sv-name" hint="As it should read on the bill, for example Airport transfer.">
              <Input id="sv-name" value={form.name} autoFocus onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Details" htmlFor="sv-details" hint="Optional. Printed under the name, for example Innova, both ways.">
              <Textarea id="sv-details" rows={2} value={form.details} onChange={(e) => set({ details: e.target.value })} />
            </Field>
            <Field label="Usual rate" htmlFor="sv-rate" hint="Leave empty if it changes every time.">
              <Input
                id="sv-rate"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={form.rate}
                onChange={(e) => set({ rate: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : null}
    </section>
  );
}
