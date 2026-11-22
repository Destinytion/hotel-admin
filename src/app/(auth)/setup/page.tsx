import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { countUsers } from "@/lib/session";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up | Hotel Admin" };

/** Setup is only open while there are no accounts at all. */
async function SetupGate() {
  await connection();
  if ((await countUsers()) > 0) redirect("/login");
  // A hosted install always asks for the setup code. See actions.ts.
  const needsCode = Boolean(process.env.SETUP_CODE) || process.env.NODE_ENV === "production";
  return <SetupForm needsCode={needsCode} />;
}

export default function SetupPage() {
  return (
    <>
      <h1 className="text-title font-semibold tracking-tight text-fg">Create the first account</h1>
      <p className="mb-5 text-ui text-fg-2">
        This page works once. After this, new people are added from inside the app.
      </p>
      <Suspense
        fallback={<div aria-hidden className="h-72 rounded-md bg-sunken" />}
      >
        <SetupGate />
      </Suspense>
    </>
  );
}
