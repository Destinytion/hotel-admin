"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createFirstUser, type SetupState } from "./actions";

const initial: SetupState = {};

export function SetupForm({ needsCode }: { needsCode: boolean }) {
  const [state, action, pending] = useActionState(createFirstUser, initial);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {needsCode ? (
        <Field
          label="Setup code"
          htmlFor="code"
          hint="The code set on the server when this app was installed."
        >
          <Input id="code" name="code" type="password" autoComplete="off" required />
        </Field>
      ) : null}
      <Field label="Your name" htmlFor="name">
        <Input
          id="name"
          name="name"
          autoComplete="name"
          defaultValue={state.values?.name}
          required
          autoFocus
        />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          defaultValue={state.values?.email}
          required
        />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 10 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field label="Password again" htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      {state.error ? (
        <p role="alert" className="text-ui font-medium text-bad">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Creating account" : "Create account"}
      </Button>
    </form>
  );
}
