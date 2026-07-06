import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "@/lib/utils";

/** shadcn-style calendar: react-day-picker themed to the ledger tokens via
 *  its CSS custom properties (see globals.css .rdp-root overrides). */
export function Calendar({ className, ...props }: React.ComponentProps<typeof DayPicker>) {
  return <DayPicker className={cn("pinelodge-calendar", className)} {...props} />;
}
