import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const control =
  "h-11 md:h-9 w-full rounded-md border border-line bg-surface px-2.5 text-body text-fg outline-none transition-colors duration-150 placeholder:text-fg-3 hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-60";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(control, className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cx(control, "pr-7", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(control, "h-auto md:h-auto py-2 leading-[22px]", className)}
      {...rest}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-ui font-medium text-fg-2">
        {label}
      </label>
      {children}
      {hint ? <p className="text-ui text-fg-3">{hint}</p> : null}
    </div>
  );
}

const buttonBase =
  "inline-flex h-11 md:h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-body font-medium transition-colors duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const buttonVariants = {
  primary: "bg-ink text-on-ink hover:bg-ink-hover",
  secondary: "border border-line bg-surface text-fg hover:bg-sunken",
  ghost: "text-fg-2 hover:bg-sunken hover:text-fg",
};

export function Button({
  variant = "secondary",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      className={cx(buttonBase, buttonVariants[variant], className)}
      {...rest}
    />
  );
}

const tones = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  muted: "bg-sunken text-fg-2",
};

export type Tone = keyof typeof tones;

export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center whitespace-nowrap rounded-md px-1.5 text-ui font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Small square with a company's initials in its own colour. */
export function CompanyChip({
  initials,
  color,
  size = 20,
}: {
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-paper"
      style={{
        backgroundColor: color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.48),
        lineHeight: 1,
      }}
    >
      {initials}
    </span>
  );
}

/** Placeholder rows shown while a list loads. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2 p-4 md:p-6">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded-md bg-sunken" />
      ))}
    </div>
  );
}

/** Shown when a list has nothing in it yet. Says what goes here and how to add it. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-4 my-4 rounded-lg border border-dashed border-line-strong px-4 py-10 text-center md:mx-6">
      <p className="text-body font-semibold text-fg">{title}</p>
      {children ? (
        <p className="mx-auto mt-1 max-w-md text-body text-fg-2">{children}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-ui font-medium text-bad">
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="text-title font-semibold tracking-tight text-fg">
          {title}
        </h1>
        {description ? (
          <p className="text-ui text-fg-2">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
