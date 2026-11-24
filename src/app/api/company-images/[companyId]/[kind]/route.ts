import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { auth } from "@/lib/auth";
import { isUuid } from "@/lib/result";
import { logActivity } from "@/server/activity";
import { companyPicture } from "@/server/doc-assets";

/*
  A company's logo or stamp. GET shows it (signed-in people only, since bills
  on screen use it); POST replaces it with an uploaded PNG or JPEG; DELETE
  removes it.
*/
type Params = { params: Promise<{ companyId: string; kind: string }> };

const MAX_BYTES = 2 * 1024 * 1024;

async function check(request: Request, params: Params["params"]) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { error: new Response("Sign in first.", { status: 401 }) };
  const { companyId, kind } = await params;
  if (!isUuid(companyId) || (kind !== "logo" && kind !== "stamp")) {
    return { error: new Response("Not found.", { status: 404 }) };
  }
  return { session, companyId, kind: kind as "logo" | "stamp" };
}

export async function GET(request: Request, { params }: Params) {
  const c = await check(request, params);
  if (c.error) return c.error;
  const row = await companyPicture(db, c.companyId, c.kind);
  if (!row) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      // The address carries the upload time, so a cached copy is never stale.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/** Tells PNG and JPEG apart by their first bytes, whatever the file is called. */
function sniff(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export async function POST(request: Request, { params }: Params) {
  const c = await check(request, params);
  if (c.error) return c.error;
  const [company] = await db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, c.companyId));
  if (!company) return Response.json({ error: "That company could not be found." }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file) return Response.json({ error: "Pick an image file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Use an image under 2 MB." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return Response.json({ error: "Use a PNG or JPEG image." }, { status: 400 });

  await db
    .insert(schema.companyImages)
    .values({ companyId: c.companyId, kind: c.kind, mime, data: Buffer.from(bytes) })
    .onConflictDoUpdate({
      target: [schema.companyImages.companyId, schema.companyImages.kind],
      set: { mime, data: Buffer.from(bytes), updatedAt: new Date() },
    });
  await logActivity(db, {
    userId: c.session.user.id,
    action: "changed",
    entity: "company",
    entityId: c.companyId,
    summary: `the ${c.kind} of ${company.name}`,
  });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const c = await check(request, params);
  if (c.error) return c.error;
  await db
    .delete(schema.companyImages)
    .where(and(eq(schema.companyImages.companyId, c.companyId), eq(schema.companyImages.kind, c.kind)));
  await logActivity(db, {
    userId: c.session.user.id,
    action: "removed",
    entity: "company",
    entityId: c.companyId,
    summary: `a ${c.kind}`,
  });
  return Response.json({ ok: true });
}
