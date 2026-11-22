export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-ink text-body font-semibold text-on-ink">
            H
          </span>
          <span className="text-body font-semibold tracking-tight text-fg">
            Hotel Admin
          </span>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
