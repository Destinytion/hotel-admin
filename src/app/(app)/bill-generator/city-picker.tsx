"use client";

import { useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { Button, Field, Input, cx } from "@/components/ui";

const citiesByState = {
  "Andaman and Nicobar Islands": ["Sri Vijaya Puram (Port Blair)"],
  "Andhra Pradesh": ["Amaravati", "Anantapur", "Guntur", "Kakinada", "Kurnool", "Nellore", "Rajamahendravaram (Rajahmundry)", "Tirupati", "Vijayawada", "Visakhapatnam"],
  "Arunachal Pradesh": ["Itanagar", "Pasighat", "Tawang"],
  Assam: ["Dibrugarh", "Guwahati", "Jorhat", "Silchar", "Tezpur"],
  Bihar: ["Bhagalpur", "Darbhanga", "Gaya", "Muzaffarpur", "Patna", "Purnia"],
  Chandigarh: ["Chandigarh"],
  Chhattisgarh: ["Bilaspur", "Durg", "Jagdalpur", "Korba", "Raipur"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Silvassa"],
  Delhi: ["Delhi", "New Delhi"],
  Goa: ["Calangute", "Mapusa", "Margao", "Panaji", "Vasco da Gama"],
  Gujarat: ["Ahmedabad", "Anand", "Bhavnagar", "Bhuj", "Gandhinagar", "Jamnagar", "Junagadh", "Rajkot", "Surat", "Vadodara", "Valsad"],
  Haryana: ["Ambala", "Faridabad", "Gurugram (Gurgaon)", "Hisar", "Karnal", "Kurukshetra", "Panipat", "Panchkula", "Rohtak", "Sonipat"],
  "Himachal Pradesh": ["Dalhousie", "Dharamshala", "Kasauli", "Kullu", "Manali", "Mandi", "Shimla", "Solan"],
  "Jammu and Kashmir": ["Gulmarg", "Jammu", "Pahalgam", "Srinagar"],
  Jharkhand: ["Bokaro", "Deoghar", "Dhanbad", "Hazaribagh", "Jamshedpur", "Ranchi"],
  Karnataka: ["Bengaluru (Bangalore)", "Belagavi", "Chikkamagaluru", "Davanagere", "Hassan", "Hosapete", "Hubballi", "Kalaburagi", "Madikeri", "Mangaluru", "Mysuru (Mysore)", "Shivamogga", "Udupi", "Vijayapura"],
  Kerala: ["Alappuzha", "Kannur", "Kochi", "Kollam", "Kottayam", "Kozhikode", "Munnar", "Palakkad", "Thiruvananthapuram", "Thrissur", "Varkala"],
  Ladakh: ["Kargil", "Leh"],
  Lakshadweep: ["Agatti", "Kavaratti"],
  "Madhya Pradesh": ["Bhopal", "Dewas", "Gwalior", "Indore", "Jabalpur", "Khajuraho", "Rewa", "Sagar", "Satna", "Ujjain"],
  Maharashtra: ["Ahilyanagar (Ahmednagar)", "Akola", "Amravati", "Chhatrapati Sambhajinagar (Aurangabad)", "Jalgaon", "Kolhapur", "Latur", "Lonavala", "Mahabaleshwar", "Mumbai", "Nagpur", "Nanded", "Nashik", "Navi Mumbai", "Pune", "Ratnagiri", "Satara", "Shirdi", "Solapur", "Thane"],
  Manipur: ["Imphal", "Ukhrul"],
  Meghalaya: ["Shillong", "Sohra (Cherrapunji)", "Tura"],
  Mizoram: ["Aizawl", "Lunglei"],
  Nagaland: ["Dimapur", "Kohima"],
  Odisha: ["Balasore", "Berhampur", "Bhubaneswar", "Cuttack", "Jharsuguda", "Puri", "Rourkela", "Sambalpur"],
  Puducherry: ["Karaikal", "Puducherry (Pondicherry)"],
  Punjab: ["Amritsar", "Bathinda", "Jalandhar", "Ludhiana", "Mohali", "Pathankot", "Patiala"],
  Rajasthan: ["Ajmer", "Alwar", "Bharatpur", "Bikaner", "Chittorgarh", "Jaipur", "Jaisalmer", "Jodhpur", "Kota", "Mount Abu", "Pushkar", "Sawai Madhopur", "Udaipur"],
  Sikkim: ["Gangtok", "Namchi", "Pelling"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Erode", "Hosur", "Kanchipuram", "Kanyakumari", "Kodaikanal", "Madurai", "Ooty", "Rameswaram", "Salem", "Thanjavur", "Tiruchirappalli", "Tirunelveli", "Tiruppur", "Vellore"],
  Telangana: ["Hyderabad", "Karimnagar", "Khammam", "Nalgonda", "Nizamabad", "Secunderabad", "Warangal"],
  Tripura: ["Agartala", "Udaipur"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Ayodhya", "Bareilly", "Ghaziabad", "Gorakhpur", "Greater Noida", "Jhansi", "Kanpur", "Lucknow", "Mathura", "Meerut", "Moradabad", "Noida", "Prayagraj (Allahabad)", "Varanasi", "Vrindavan"],
  Uttarakhand: ["Almora", "Dehradun", "Haldwani", "Haridwar", "Mussoorie", "Nainital", "Rishikesh", "Rudrapur"],
  "West Bengal": ["Asansol", "Darjeeling", "Digha", "Durgapur", "Howrah", "Kalimpong", "Kharagpur", "Kolkata", "Malda", "Siliguri"],
};

const cities = Object.entries(citiesByState)
  .flatMap(([state, names]) => names.map((name) => {
    const city = name.split(" (")[0];
    return { label: `${city}, ${state}`, search: `${name} ${state}`.toLowerCase() };
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function CityPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const matches = cities.filter(({ search }) => words.every((word) => search.includes(word)));

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function select(label: string) {
    onChange(label);
    close();
  }

  return (
    <Field label="Select City" htmlFor="d-city" className="min-w-0">
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <Button
          ref={trigger}
          id="d-city"
          aria-expanded={open}
          aria-controls={open ? "d-city-panel" : undefined}
          className="w-full justify-between px-2.5 font-normal"
          onClick={() => {
            setQuery("");
            setActive(-1);
            setOpen(!open);
          }}
        >
          <span className={cx("truncate", !value && "text-fg-3")}>{value || "Choose a city"}</span>
          <CaretDown size={14} className="shrink-0" />
        </Button>
        {open && (
          <div id="d-city-panel" className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-line bg-surface p-2 shadow-lg">
            <Input
              ref={(input) => { input?.focus(); }}
              type="search"
              role="combobox"
              aria-label="Search by city or state"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls="d-city-options"
              aria-activedescendant={matches[active] ? `d-city-option-${active}` : undefined}
              placeholder="Search by city or state"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (matches[active]) select(matches[active].label);
                  return;
                }
                if (!matches.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
                event.preventDefault();
                const next = event.key === "ArrowDown"
                  ? (active + 1) % matches.length
                  : active <= 0 ? matches.length - 1 : active - 1;
                setActive(next);
                document.getElementById(`d-city-option-${next}`)?.scrollIntoView({ block: "nearest" });
              }}
            />
            <ul id="d-city-options" role="listbox" aria-label="Indian cities" className="mt-1 max-h-52 overflow-auto">
              {matches.map(({ label }, index) => (
                <li
                  key={label}
                  id={`d-city-option-${index}`}
                  role="option"
                  aria-selected={label === value}
                  className={cx("cursor-pointer rounded px-2 py-2 text-ui hover:bg-sunken", index === active && "bg-sunken")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(label)}
                >
                  {label}
                </li>
              ))}
            </ul>
            {!matches.length && <p role="status" className="px-2 py-1 text-ui text-fg-3">No matching cities. Try a different city or state.</p>}
            {value && <Button className="mt-1 w-full" onClick={() => select("")}>Clear selection</Button>}
          </div>
        )}
      </div>
    </Field>
  );
}
