/** What every save or delete returns to the screen that asked for it. */
export type Result<T = null> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      /** True when someone else changed the same record first. */
      conflict?: boolean;
    };

/** A problem the person can fix, shown to them as written. */
export class UserError extends Error {}

/** Someone else saved the same record first. The screen offers to load their version. */
export class ConflictError extends UserError {}

/**
 * Runs a save and turns a UserError into a message for the screen.
 * Anything else (including redirects) is passed on untouched.
 */
export async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof ConflictError) return { ok: false, error: error.message, conflict: true };
    if (error instanceof UserError) return { ok: false, error: error.message };
    throw error;
  }
}

export const text = (value: unknown, max = 2000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
