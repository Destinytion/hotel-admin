import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/lib/auth";

/*
  When anything was last saved, from the activity record. Open screens ask
  this every few seconds and only reload their data when the answer changes,
  which costs a fraction of reloading the whole screen each time.
*/
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });

  const result = await db.execute<{ at: string | null }>(sql`select max(created_at)::text as at from audit_log`);
  return Response.json({ at: result.rows[0]?.at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
