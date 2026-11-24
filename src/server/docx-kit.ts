import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";
import type { Picture } from "./doc-assets";

/*
  Small building blocks for the Word files, so bills and receipts are laid out
  the same way. Sizes: text in points, widths in twentieths of a point (DXA),
  1440 to the inch. A4 with 0.6 inch margins leaves 10,178 across.
*/

export const PAGE = { width: 11906, height: 16838, margin: 864 };
export const CONTENT = PAGE.width - 2 * PAGE.margin;
export const FONT = "Arial";
export const MUTED = "5B616B";
export const LINE = "D9DCE1";
export const SOFT = "F6F7F9";

export const hex = (color: string) => color.replace("#", "").toUpperCase();

type RunOptions = { bold?: boolean; color?: string; size?: number; caps?: boolean };

export const run = (text: string, o: RunOptions = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, color: o.color, size: Math.round((o.size ?? 9) * 2), allCaps: o.caps });

/** A paragraph of one run, or of several. Line breaks in the text become separate lines. */
export function para(
  content: string | ParagraphChild[],
  o: RunOptions & { align?: "left" | "right" | "center"; before?: number; after?: number; borderBottom?: { color: string; size: number } } = {},
) {
  const children =
    typeof content === "string"
      ? content.split("\n").map((line, i) => new TextRun({ text: line, font: FONT, bold: o.bold, color: o.color, size: Math.round((o.size ?? 9) * 2), allCaps: o.caps, break: i ? 1 : undefined }))
      : content;
  return new Paragraph({
    children,
    alignment: o.align === "right" ? AlignmentType.RIGHT : o.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: o.before ?? 0, after: o.after ?? 0 },
    border: o.borderBottom ? { bottom: { style: BorderStyle.SINGLE, size: o.borderBottom.size, color: o.borderBottom.color, space: 1 } } : undefined,
  });
}

const none: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
export const NO_BORDERS = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
const thin = (color = LINE): IBorderOptions => ({ style: BorderStyle.SINGLE, size: 4, color });

export function cell(
  children: Paragraph[] | Table[] | (Paragraph | Table)[],
  width: number,
  o: { shade?: string; borders?: "none" | "bottom" | "all"; borderColor?: string; padding?: number; span?: number; middle?: boolean } = {},
) {
  const b = o.borders ?? "none";
  const line = thin(o.borderColor);
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    columnSpan: o.span,
    verticalAlign: o.middle ? VerticalAlign.CENTER : VerticalAlign.TOP,
    shading: o.shade ? { type: ShadingType.CLEAR, color: "auto", fill: o.shade } : undefined,
    margins: { top: o.padding ?? 70, bottom: o.padding ?? 70, left: 100, right: 100 },
    borders: {
      top: b === "all" ? line : none,
      left: b === "all" ? line : none,
      right: b === "all" ? line : none,
      bottom: b === "none" ? none : line,
    },
  });
}

/**
 * A table. `header` repeats the first row at the top of every page the table
 * runs onto; rows are never split across two pages.
 */
export function table(widths: number[], rows: TableCell[][], o: { align?: "right"; header?: boolean } = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    alignment: o.align === "right" ? AlignmentType.RIGHT : undefined,
    borders: NO_BORDERS,
    rows: rows.map((cells, i) => new TableRow({ children: cells, cantSplit: true, tableHeader: Boolean(o.header && i === 0) })),
  });
}

/** Width and height of a PNG or JPEG, read from its header. */
function pictureSize(p: Picture): { width: number; height: number } {
  const b = p.data;
  if (b[0] === 0x89 && b[1] === 0x50) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: 1, height: 1 };
}

/** A picture scaled to fit the box, keeping its shape. Sizes in pixels at 96 per inch. */
export function picture(p: Picture, maxWidth: number, maxHeight: number) {
  const size = pictureSize(p);
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
  return new ImageRun({
    type: p.mime === "image/png" ? "png" : "jpg",
    data: p.data,
    transformation: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
  });
}
