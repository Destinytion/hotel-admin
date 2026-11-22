import { Suspense } from "react";
import { AutoRefresh } from "@/components/live";
import { MobileTabs, Sidebar } from "@/components/shell";
import { UserMenu } from "@/components/user-menu";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        The menus highlight the current page, which they read from the address.
        On pages whose address is only known at request time (a single bill),
        they stream in, so each sits in its own Suspense with an empty frame.
      */}
      <Suspense
        fallback={
          <div
            aria-hidden
            className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-line bg-canvas md:block print:hidden"
          />
        }
      >
        <Sidebar
          userSlot={
            <Suspense fallback={<div aria-hidden className="h-12 rounded-md bg-sunken" />}>
              <UserMenu />
            </Suspense>
          }
        />
      </Suspense>
      <main className="min-h-dvh pb-(--tabbar-h) md:pb-0 md:pl-60 print:min-h-0 print:p-0">
        {children}
      </main>
      <Suspense
        fallback={
          <div
            aria-hidden
            className="fixed inset-x-0 bottom-0 z-20 h-(--tabbar-h) border-t border-line bg-canvas md:hidden print:hidden"
          />
        }
      >
        <MobileTabs />
      </Suspense>
      <AutoRefresh />
    </>
  );
}
