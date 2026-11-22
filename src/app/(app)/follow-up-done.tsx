"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { setNoteDone } from "./clients/actions";

export function FollowUpDone({ noteId }: { noteId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await setNoteDone(noteId, true);
        setPending(false);
      }}
    >
      Done
    </Button>
  );
}
