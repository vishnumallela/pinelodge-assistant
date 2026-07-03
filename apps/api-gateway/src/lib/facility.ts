import { env } from "../env";

// Facility facts: plain data the assistant may reference when answering general
// questions. Business decisions (routing, availability) never live here — they
// belong to the routing engine and the staff schedule.

export interface OfficeHours {
  days: string[];
  open: string;
  close: string;
  label: string;
}

export const OFFICE_HOURS: OfficeHours = {
  days: ["mon", "tue", "wed", "thu", "fri"],
  open: "08:00",
  close: "18:00",
  label: "Monday to Friday, 8:00 AM to 6:00 PM",
};

export const FACILITY = {
  name: env.FACILITY_NAME,
  address: "4200 Bluebonnet Trail, Cedar Falls, Texas 76021",
  phone: "(817) 555-0142",
  officeHours: OFFICE_HOURS.label,
  visitingHours:
    "Every day, 9:00 AM to 7:00 PM. Family may visit outside these hours by arrangement with the front office.",
  care: "Licensed assisted living community offering private apartments, daily living assistance, medication management, and around-the-clock on-site nursing.",
  dining:
    "Three chef-prepared meals daily with dietician-reviewed menus; family members are welcome to join residents for meals.",
  parking: "Free visitor parking in the front lot off Bluebonnet Trail.",
} as const;

export type FacilityInfo = typeof FACILITY;
