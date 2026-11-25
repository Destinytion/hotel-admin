import { connection } from "next/server";

/*
  For the uptime check. It never touches the database, so checking it often
  does not keep the free database awake around the clock.
  connection() makes it run on the server for every request: built as a fixed
  file it would only prove the host's network is up, not the app's server.
*/
export async function GET() {
  await connection();
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
