"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

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
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
