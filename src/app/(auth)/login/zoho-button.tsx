"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, ErrorText } from "@/components/ui";

/*
  Sends the browser to Zoho's sign-in page. Zoho sends it back to "/" signed
  in, or to /login with the reason it did not work.

  - `ready` is false until the Zoho Client ID and Secret have been filled in.
    The button is still shown, and says what is missing when pressed.
  - With `auto`, it goes as soon as the page opens, so nobody has to press anything.
*/
export function ZohoButton({ ready, auto = false }: { ready: boolean; auto?: boolean }) {
  const [pending, setPending] = useState(auto && ready);
  const [error, setError] = useState("");
  const started = useRef(false);

  const go = useCallback(async () => {
    const { error: failure } = await authClient.signIn.social({
      provider: "zoho",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
    if (failure) {
      setPending(false);
      setError(
        failure.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Could not reach Zoho. Try again, or use your password.",
      );
    }
  }, []);

  useEffect(() => {
    if (!auto || !ready || started.current) return;
    started.current = true;
    void go();
  }, [auto, ready, go]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={ready ? "primary" : "secondary"}
        disabled={pending}
        className="w-full"
        onClick={() => {
          if (!ready) {
            setError(
              "Zoho sign-in is not switched on yet. It needs the Client ID and Client Secret from the Zoho API Console in the app's settings file. Until then, use your password below.",
            );
            return;
          }
          setPending(true);
          setError("");
          void go();
        }}
      >
        {pending ? "Taking you to Zoho" : "Sign in with Zoho"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
