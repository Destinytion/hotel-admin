"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignOut } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    // "signedout" keeps the login page on screen. Without it, a Zoho sign-in
    // would start at once and sign the person straight back in.
    router.replace("/login?signedout");
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      onClick={signOut}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
      className="w-11 px-0 md:w-9"
    >
      <SignOut size={18} />
    </Button>
  );
}
