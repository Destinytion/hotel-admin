import { db } from "@/db";
import { auth } from "@/lib/auth";
import { isUuid } from "@/lib/result";
import { renderBillDocx } from "@/server/bill-docx";
import { loadBillDoc } from "@/server/bill-doc";
import { renderBillPdf } from "@/server/bill-pdf";
import { companyPictures, fileName } from "@/server/doc-assets";

/*
  A bill as a file, made fresh from the database each time: ?as=pdf (the
  default) or ?as=docx for Word. Add &inline=1 to open a PDF in the browser
  instead of downloading it. Signed-in people only.
*/
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Sign in to see bills.", { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return new Response("No such bill.", { status: 404 });

  const loaded = await loadBillDoc(db, id);
  if (!loaded) return new Response("No such bill.", { status: 404 });
  const pictures = await companyPictures(db, loaded.companyId);
  const url = new URL(request.url);
  const word = url.searchParams.get("as") === "docx";
  const inline = !word && url.searchParams.get("inline") === "1";

  const body = word ? await renderBillDocx(loaded.doc, pictures) : await renderBillPdf(loaded.doc, pictures);
  const name = fileName(loaded.doc.title, loaded.doc.number, word ? "docx" : "pdf");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
