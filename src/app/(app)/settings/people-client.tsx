"use client";

import { useState } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { SidePanel } from "@/components/side-panel";
import { SignOutButton } from "@/components/sign-out-button";
import { addPerson, changeMyPassword, removePerson, resetPassword } from "./people-actions";

type Person = { id: string; name: string; email: string };

type Panel =
  | { mode: "add" }
  | { mode: "reset"; person: Person }
  | { mode: "change" }
  | null;

export function PeopleClient({
  people,
  meId,
  zoho,
}: {
  people: Person[];
  meId: string;
  /** True when "Sign in with Zoho" is switched on. */
  zoho: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  function open(next: Panel) {
    setError("");
    setNotice("");
    setName("");
    setEmail("");
    setPassword("");
    setCurrent("");
    setPanel(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!panel) return;
    setPending(true);
    setError("");
    const result =
      panel.mode === "add"
        ? await addPerson({ name, email, password })
        : panel.mode === "reset"
          ? await resetPassword({ userId: panel.person.id, password })
          : await changeMyPassword({ current, next: password });
    setPending(false);
    if (!result.ok) return setError(result.error);
    setNotice(
      panel.mode === "add"
        ? zoho && !password
          ? `${name.trim()} can now sign in with Zoho.`
          : `${name.trim()} can now sign in with that password.`
        : panel.mode === "reset"
          ? `${panel.person.name} has a new password and has been signed out.`
          : "Your password is changed. Your other devices have been signed out.",
    );
    setPanel(null);
  }

  async function remove(person: Person) {
    setPending(true);
    setError("");
    const result = await removePerson(person.id);
    setPending(false);
    setRemoving(null);
    if (!result.ok) return setError(result.error);
    setNotice(`${person.name} no longer has a login.`);
  }

  const title =
    panel?.mode === "add"
      ? "Add a person"
      : panel?.mode === "reset"
        ? `New password for ${panel.person.name}`
        : "Change my password";

  return (
    <section className="border-t border-line px-4 py-5 md:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-fg">People with a login</h2>
          <p className="text-ui text-fg-2">Everyone here sees and can change everything.</p>
        </div>
        <Button variant="primary" onClick={() => open({ mode: "add" })}>
          Add person
        </Button>
      </div>

      {notice ? (
        <p role="status" className="mt-3 text-ui font-medium text-ok">
          {notice}
        </p>
      ) : null}
      {!panel && error ? (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}

      <ul data-people className="mt-3 divide-y divide-line rounded-lg border border-line">
        {people.map((p) => {
          const isMe = p.id === meId;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
              <div className="min-w-40 flex-1">
                <p className="truncate text-body font-medium text-fg">
                  {p.name}
                  {isMe ? <span className="ml-2 font-normal text-fg-3">you</span> : null}
                </p>
                <p className="truncate text-ui text-fg-3">{p.email}</p>
              </div>
              {isMe ? (
                <>
                  <Button onClick={() => open({ mode: "change" })}>Change my password</Button>
                  <SignOutButton />
                </>
              ) : removing === p.id ? (
                <>
                  <span className="text-ui text-fg-2">Remove this login?</span>
                  <Button onClick={() => setRemoving(null)} disabled={pending}>
                    Keep
                  </Button>
                  <Button variant="primary" onClick={() => remove(p)} disabled={pending}>
                    Yes, remove
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => open({ mode: "reset", person: p })}>Reset password</Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError("");
                      setNotice("");
                      setRemoving(p.id);
                    }}
                  >
                    Remove
                  </Button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {panel ? (
        <SidePanel
          title={title}
          onClose={() => setPanel(null)}
          footer={
            <>
              <Button onClick={() => setPanel(null)}>Cancel</Button>
              <Button variant="primary" type="submit" form="people-form" disabled={pending}>
                {pending ? "Saving" : panel.mode === "add" ? "Add person" : "Save password"}
              </Button>
            </>
          }
        >
          <form id="people-form" onSubmit={submit} className="flex flex-col gap-4 p-4 md:p-5" noValidate>
            {panel.mode === "add" ? (
              <>
                <Field label="Name" htmlFor="pp-name">
                  <Input id="pp-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field
                  label="Email"
                  htmlFor="pp-email"
                  hint={zoho ? "Their Zoho mail address. They sign in with this." : "They sign in with this."}
                >
                  <Input
                    id="pp-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            {panel.mode === "change" ? (
              <Field label="Current password" htmlFor="pp-current">
                <Input
                  id="pp-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  autoFocus
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label={panel.mode === "add" ? (zoho ? "Password (optional)" : "Password") : "New password"}
              htmlFor="pp-password"
              hint={
                panel.mode === "change"
                  ? "At least 10 characters."
                  : panel.mode === "add" && zoho
                    ? "Leave empty if they will sign in with Zoho. Otherwise at least 10 characters."
                    : "At least 10 characters. Tell them this password; they can change it after signing in."
              }
            >
              <Input
                id="pp-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {panel.mode === "reset" ? (
              <p className="text-ui text-fg-2">
                {panel.person.name} will be signed out everywhere and must sign in with the new password.
              </p>
            ) : null}
            <ErrorText>{error}</ErrorText>
          </form>
        </SidePanel>
      ) : null}
    </section>
  );
}
