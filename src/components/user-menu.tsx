import { requireUser } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";

/** Who is signed in. Also sends anyone with a dead session back to login. */
export async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium text-fg">{user.name}</p>
        <p className="truncate text-ui text-fg-3">{user.email}</p>
      </div>
      <SignOutButton />
    </div>
  );
}
