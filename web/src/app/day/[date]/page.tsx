import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DayView } from "@/components/dash/day-view";
import { nowMs, todayLocal } from "@/lib/analytics";

export async function generateMetadata({ params }: PageProps<"/day/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) };
}

export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  await connection();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) notFound();
  const today = todayLocal();
  if (date === today) redirect("/");
  if (date > today) notFound();
  return <DayView day={date} today={today} now={nowMs()} />;
}
