import { redirect } from "next/navigation";

// Trends now live on each area's page (Activity, Sleep, Heart & body).
export default function TrendsPage() {
  redirect("/activity");
}
