import path from "node:path";
import { and, eq } from "drizzle-orm";
import { Font } from "@react-pdf/renderer";
import { schema } from "@/db";
import type { Executor } from "./availability";

export type Picture = { data: Buffer; mime: string };
export type CompanyPictures = { logo: Picture | null; stamp: Picture | null };

/** A company's logo and stamp, if uploaded. */
export async function companyPictures(ex: Executor, companyId: string): Promise<CompanyPictures> {
  const rows = await ex
    .select({ kind: schema.companyImages.kind, mime: schema.companyImages.mime, data: schema.companyImages.data })
    .from(schema.companyImages)
    .where(eq(schema.companyImages.companyId, companyId));
  const pick = (kind: string) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? { data: Buffer.from(row.data), mime: row.mime } : null;
  };
  return { logo: pick("logo"), stamp: pick("stamp") };
}

export async function companyPicture(ex: Executor, companyId: string, kind: "logo" | "stamp") {
  const [row] = await ex
    .select()
    .from(schema.companyImages)
    .where(and(eq(schema.companyImages.companyId, companyId), eq(schema.companyImages.kind, kind)));
  return row ?? null;
}

/*
  Inter, the app's own typeface, is embedded in every PDF so documents look
  the same on every device and the rupee sign prints. The files live in
  public/fonts so the hosted container carries them.
*/
let registered = false;
export function registerPdfFonts() {
  if (registered) return;
  registered = true;
  const fonts = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Inter",
    fonts: [
      { src: path.join(fonts, "Inter-Regular.ttf"), fontWeight: 400 },
      { src: path.join(fonts, "Inter-SemiBold.ttf"), fontWeight: 600 },
    ],
  });
  // Names and addresses are never broken across lines with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);
}

/** A file name safe on every system: "Invoice AC-26-27-0001.pdf". */
export const fileName = (title: string, number: string | null, ext: "pdf" | "docx") =>
  `${title} ${(number ?? "draft").replace(/[\\/:*?"<>|]+/g, "-")}.${ext}`;

/** The picture as react-pdf wants it. */
export const pdfImage = (p: Picture) => ({ data: p.data, format: p.mime === "image/png" ? ("png" as const) : ("jpg" as const) });
