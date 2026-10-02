import { connection } from "next/server";
import { DayView } from "@/components/dash/day-view";
import { nowMs, todayLocal } from "@/lib/analytics";

export default async function TodayPage() {
  await connection();
  const today = todayLocal();
  return <DayView day={today} today={today} now={nowMs()} />;
}
