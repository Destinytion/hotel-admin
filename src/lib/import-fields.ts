import { headerKey } from "./sheet";

export type ImportKind = "clients" | "rooms";

export type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Column headings that usually mean this field, in headerKey form. */
  matches: string[];
};

/** What an import can fill in, and the headings that are matched to each field. */
export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  clients: [
    { key: "name", label: "Client name", required: true, matches: ["client", "clientname", "name", "company", "companyname", "agency", "agencyname", "customer", "customername", "party", "partyname", "account"] },
    { key: "type", label: "Type", hint: "Company, Agent or Individual. Company if empty.", matches: ["type", "clienttype", "category", "kind"] },
    { key: "contactName", label: "Contact person", matches: ["contact", "contactperson", "contactname", "person", "pointofcontact", "poc", "spoc"] },
    { key: "contactRole", label: "Contact's role", matches: ["role", "designation", "title", "position"] },
    { key: "phone", label: "Phone", matches: ["phone", "mobile", "mobileno", "mobilenumber", "phoneno", "phonenumber", "contactno", "contactnumber", "whatsapp", "cell", "tel", "telephone"] },
    { key: "email", label: "Email", matches: ["email", "emailid", "emailaddress", "mail"] },
    { key: "address", label: "Address", matches: ["address", "billingaddress", "city", "location"] },
    { key: "registration", label: "GSTIN", hint: "Printed on GST bills and receipts.", matches: ["gst", "gstin", "gstno", "gstnumber", "registration", "pan", "taxid", "vat"] },
    { key: "tags", label: "Tags", hint: "Separated by commas.", matches: ["tags", "tag", "labels", "group", "segment"] },
  ],
  rooms: [
    { key: "hotel", label: "Hotel", required: true, matches: ["hotel", "hotelname", "property", "propertyname"] },
    { key: "city", label: "City", hint: "Used only when the hotel is new.", matches: ["city", "location", "destination", "place"] },
    { key: "roomType", label: "Room type", required: true, matches: ["room", "roomtype", "roomcategory", "category", "roomname"] },
    { key: "firstNight", label: "First night", required: true, matches: ["firstnight", "from", "fromdate", "checkin", "checkindate", "start", "startdate", "datefrom"] },
    { key: "lastNight", label: "Last night", hint: "The last night held. Or pick a check-out column below instead.", matches: ["lastnight", "to", "todate", "end", "enddate", "dateto", "till", "until"] },
    { key: "checkOut", label: "Check-out day", hint: "Instead of the last night: the last night is the day before.", matches: ["checkout", "checkoutdate", "departure", "departuredate"] },
    { key: "roomsHeld", label: "Rooms held each night", required: true, matches: ["rooms", "roomsheld", "noofrooms", "numberofrooms", "qty", "quantity", "inventory", "allotment", "count"] },
    { key: "sellPrice", label: "Selling price a night", required: true, matches: ["sellprice", "sellingprice", "price", "rate", "sellrate", "sellingrate", "salerate", "saleprice", "b2brate", "tariff"] },
    { key: "costPrice", label: "Your cost a night", matches: ["cost", "costprice", "costrate", "buyrate", "buyingrate", "netrate", "purchaserate", "purchaseprice", "contractrate"] },
    { key: "releaseDate", label: "Release date", matches: ["release", "releasedate", "cutoff", "cutoffdate"] },
    { key: "payFor", label: "Pay the hotel for", hint: '"Sold" or "allotment" means only rooms sold. Anything else: every room held.', matches: ["payfor", "paythehotelfor", "paymentterms", "terms", "basis", "contracttype"] },
  ],
};

/**
 * Picks a column for each field from the headings: an exact match first, then
 * a heading that contains one of the usual words. A column is used once.
 */
export function guessMapping(kind: ImportKind, headings: string[]): Record<string, number> {
  const keys = headings.map(headerKey);
  const used = new Set<number>();
  const mapping: Record<string, number> = {};
  for (const pass of ["exact", "contains"] as const) {
    for (const field of IMPORT_FIELDS[kind]) {
      if (mapping[field.key] !== undefined) continue;
      const index = keys.findIndex(
        (k, i) =>
          !used.has(i) &&
          k !== "" &&
          field.matches.some((m) => (pass === "exact" ? k === m : m.length > 3 && k.includes(m))),
      );
      if (index >= 0) {
        mapping[field.key] = index;
        used.add(index);
      }
    }
  }
  return mapping;
}

export const IMPORT_MAX_ROWS = 2000;
