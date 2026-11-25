/*
  For an uptime monitor. It never touches the database, so checking it every
  few minutes does not keep the free database awake around the clock.
*/
export function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
