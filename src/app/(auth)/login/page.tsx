import { Suspense } from "react";
import { redirect } from "next/navigation";
import { countUsers, getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in | Hotel Admin" };

/** Already signed in goes to the app. A brand new install goes to setup. */
async function LoginRedirects() {
  if (await getSession()) redirect("/");
  if ((await countUsers()) === 0) redirect("/setup");
  return null;
}

export default function LoginPage() {
  return (
    <>
      <h1 className="text-title font-semibold tracking-tight text-fg">Sign in</h1>
      <p className="mb-5 text-ui text-fg-2">Use the email and password for your account.</p>
      <LoginForm />
      <Suspense fallback={null}>
        <LoginRedirects />
      </Suspense>
    </>
  );
}
