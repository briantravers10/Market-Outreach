import { redirect } from "next/navigation";

// Renamed to /analytics and extended with the new breakdowns. Kept as a
// redirect so any existing links/bookmarks still land somewhere useful.
export default function ReportsRedirect() {
  redirect("/analytics");
}
