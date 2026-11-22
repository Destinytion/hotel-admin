import { Suspense } from "react";
import { redirect } from "next/navigation";
import { zohoEnabled } from "@/lib/auth";
import { countUsers, getSession } from "@/lib/session";
import { ErrorText } from "@/components/ui";
import Link from "@/components/link";
import { LoginForm } from "./login-form";
import { ZohoButton } from "./zoho-button";

export const metadata = { title: "Sign in | Hotel Admin" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** What to tell someone when signing in with Zoho did not work. */
function zohoError(code: string) {
  switch (code) {
    case "signup_disabled":
      return "That Zoho account is not on the list of people who can use this app. Ask an owner to add your email in Settings.";
    case "email_not_verified":
    case "account_not_linked":
    case "unable_to_link_account":
      return "Zoho has not verified that email address, so it could not be matched to your login here.";
    case "access_denied":
      return "Sign-in with Zoho was cancelled.";
    default:
      return "Sign-in with Zoho did not work. Try again, or use your password.";
  }
}

async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  // Already signed in goes to the app. A brand new install goes to setup.
  if (await getSession()) redirect("/");
  if ((await countUsers()) === 0) redirect("/setup");

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  const signedOut = params.signedout !== undefined;
  const wantsPassword = params.password !== undefined;
  const zoho = zohoEnabled();

  /*
    With Zoho switched on, opening the app goes straight to Zoho's own sign-in
    page and comes back signed in. This page only stays on screen when that
    would be wrong:
    - after signing out (or Zoho would sign the person straight back in),
    - after a failed attempt (or it would loop),
    - when someone asks for the password form.
  */
  if (zoho && !error && !signedOut && !wantsPassword) {
    return (
      <>
        <ZohoButton ready auto />
        <p className="mt-4 text-ui text-fg-3">
          <Link href="/login?password" className="text-accent hover:underline">
            Use a password instead
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      {signedOut ? (
        <p role="status" className="mb-4 text-body text-fg-2">
          You are signed out.
        </p>
      ) : null}
      {error ? (
        <div className="mb-4">
          <ErrorText>{zohoError(error)}</ErrorText>
        </div>
      ) : null}
      {/* Always shown. Until Zoho is set up it explains what is missing when pressed. */}
      <ZohoButton ready={zoho} />
      <p className="my-4 flex items-center gap-3 text-ui text-fg-3">
        <span className="h-px flex-1 bg-line" />
        or use a password
        <span className="h-px flex-1 bg-line" />
      </p>
      <LoginForm primary={!zoho} />
    </>
  );
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1 className="mb-5 text-title font-semibold tracking-tight text-fg">Sign in</h1>
      {/* Decided at request time: who is signed in, and whether Zoho is switched on. */}
      <Suspense fallback={<div aria-hidden className="h-56 rounded-md bg-sunken" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
