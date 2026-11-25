"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Field, Input } from "@/components/ui";

/** `primary` is false when "Sign in with Zoho" is the main button above this form. */
export function LoginForm({ primary = true }: { primary?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setPending(true);

    const { error: failure } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim().toLowerCase(),
      password: String(form.get("password") ?? ""),
    });

    if (failure) {
      setPending(false);
      setError(
        failure.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "The email or password is not right.",
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    // method="post" keeps the password out of the address bar if the form is
    // submitted before the page has finished loading its script.
    <form onSubmit={onSubmit} method="post" className="flex flex-col gap-4" noValidate>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {error ? (
        <p role="alert" className="text-ui font-medium text-bad">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={pending} className="w-full">
        {pending ? "Signing in" : "Sign in"}
      </Button>
      {/*
        With a handful of people, a reset email is not worth running a mail
        service for. Any owner can set a new password in Settings.
      */}
      {forgot ? (
        <p role="status" data-forgot className="text-ui text-fg-2">
          Ask the superadmin or another owner to set a new one for you in Settings, under People with a login, with Reset password.
          If your email is a Zoho mail address, you can also use Sign in with Zoho.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setForgot(true)}
          className="self-start text-ui text-accent hover:underline"
        >
          Forgot password?
        </button>
      )}
    </form>
  );
}
