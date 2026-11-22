import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";

export const MIN_PASSWORD_LENGTH = 10;

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Invite-only. Nobody can create an account from the login page.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "admin", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14, // stay signed in for 14 days
    updateAge: 60 * 60 * 24,
  },
  // Slows down password guessing. On in development too, so it is tested.
  // Sign-in allows 10 tries a minute from one place: enough for a whole office
  // signing in together in the morning, far too few to guess a password.
  rateLimit: {
    enabled: true,
    customRules: { "/sign-in/email": { window: 60, max: 10 } },
  },
  // Must stay last: it lets server actions set the session cookie.
  plugins: [nextCookies()],
});
