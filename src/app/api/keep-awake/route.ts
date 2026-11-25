import { sql } from "drizzle-orm";
import { db } from "@/db";

/*
  Called once a day by the host's scheduler (vercel.json, 3:00 am India time).
  A free Supabase database is paused after a week with no use, for example over
  a holiday. One small read a day keeps it counted as in use.
  When CRON_SECRET is set, only the scheduler can call this.
*/
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from companies`);
  return Response.json({ ok: true, companies: result.rows[0]?.n ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
