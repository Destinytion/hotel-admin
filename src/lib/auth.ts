import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { db, schema } from "@/db";

export const MIN_PASSWORD_LENGTH = 10;

/*
  "Sign in with Zoho" is switched on by setting ZOHO_CLIENT_ID and
  ZOHO_CLIENT_SECRET, from an app registered once in the Zoho API Console.
  ZOHO_ACCOUNTS_URL picks the Zoho data centre the mail account lives in:
  https://accounts.zoho.in (India, the default) or https://accounts.zoho.com.
*/
export const zohoEnabled = () =>
  Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);

const zohoAccounts = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in").replace(/\/+$/, "");

const zoho = zohoEnabled()
  ? [
      genericOAuth({
        config: [
          {
            providerId: "zoho",
            name: "Zoho",
            clientId: process.env.ZOHO_CLIENT_ID!,
            clientSecret: process.env.ZOHO_CLIENT_SECRET!,
            discoveryUrl: `${zohoAccounts}/.well-known/openid-configuration`,
            scopes: ["openid", "email", "profile"],
            // The identity Zoho sends is checked against Zoho's published keys.
            requireIdTokenVerification: true,
            // Invite-only: a Zoho account only gets in if its email was already
            // added in Settings. Zoho never creates a new person here.
            disableSignUp: true,
            // Only an address Zoho itself has verified counts.
            requireEmailVerification: true,
            // Some providers reject the extra PKCE check; this turns it off if Zoho does.
            pkce: process.env.ZOHO_DISABLE_PKCE !== "1",
          },
        ],
      }),
    ]
  : [];

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
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/social": { window: 60, max: 10 },
    },
  },
  // nextCookies must stay last: it lets server actions set the session cookie.
  plugins: [...zoho, nextCookies()],
});
