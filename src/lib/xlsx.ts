/*
  Reads the first sheet of an Excel .xlsx file in the browser, without any
  library. An .xlsx file is a zip of XML files: this finds the sheet, its
  shared text, and returns the cells as rows of text. Dates come out as Excel
  date numbers, which the date reader understands.
*/

type Entry = { method: number; compressedSize: number; offset: number };

function readZipDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-directory record sits in the last 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("This is not an Excel .xlsx file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, Entry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { method, compressedSize, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { view, entries };
}

async function readEntry(bytes: Uint8Array, view: DataView, entry: Entry) {
  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error("This Excel file is packed in a way that cannot be read here.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** "B" is column 1, "AA" is column 26. */
function columnIndex(ref: string) {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(file: Blob): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { view, entries } = readZipDirectory(bytes);
  const read = async (name: string) => {
    const entry = entries.get(name);
    return entry ? readEntry(bytes, view, entry) : null;
  };
  const parse = (xml: string) => new DOMParser().parseFromString(xml, "application/xml");

  // The first sheet in the workbook's own order, wherever its file is.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  if (workbook && rels) {
    const first = parse(workbook).getElementsByTagName("sheet")[0];
    const relId =
      first?.getAttribute("r:id") ??
      first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = [...parse(rels).getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === relId);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml
    ? [...parse(sharedXml).getElementsByTagName("si")].map((si) =>
        [...si.getElementsByTagName("t")]
          // Phonetic guides (rPh) are not part of the text.
          .filter((t) => t.parentElement?.tagName !== "rPh")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];

  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error("No sheet was found in this Excel file.");
  const rows: string[][] = [];
  for (const row of parse(sheetXml).getElementsByTagName("row")) {
    const cells: string[] = [];
    let next = 0;
    for (const c of row.getElementsByTagName("c")) {
      const ref = c.getAttribute("r");
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = [...c.getElementsByTagName("t")].map((t) => t.textContent ?? "").join("");
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else value = v;
      cells[index] = value;
    }
    rows.push(Array.from(cells, (cell) => cell ?? ""));
  }
  return rows;
}
