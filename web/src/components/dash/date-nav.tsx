"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toDate = (day: string) => new Date(`${day}T12:00:00`);
const toDay = (d: Date) => d.toLocaleDateString("sv");
const shift = (day: string, n: number) => {
  const d = toDate(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
};
const hrefFor = (day: string, today: string) => (day === today ? "/" : `/day/${day}`);

/** Previous / pick a date / next. Days that have data are marked in the calendar. */
export function DateNav({ day, today, dataDays }: { day: string; today: string; dataDays: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const has = new Set(dataDays);
  const label = day === today ? "Today" : day === shift(today, -1) ? "Yesterday"
    : toDate(day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: toDate(day).getFullYear() === toDate(today).getFullYear() ? undefined : "numeric" });

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon-sm" asChild aria-label="Previous day">
        <Link href={hrefFor(shift(day, -1), today)}><ChevronLeft /></Link>
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-28 gap-1.5">
            <CalendarDays className="text-muted-foreground" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={toDate(day)}
            defaultMonth={toDate(day)}
            disabled={{ after: toDate(today) }}
            modifiers={{ hasData: (d: Date) => has.has(toDay(d)) }}
            modifiersClassNames={{ hasData: "[&>button]:font-semibold [&>button]:underline [&>button]:decoration-activity [&>button]:decoration-2 [&>button]:underline-offset-4" }}
            onSelect={(d) => {
              if (!d) return;
              setOpen(false);
              router.push(hrefFor(toDay(d), today));
            }}
          />
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="underline decoration-activity decoration-2 underline-offset-4">Underlined</span>
            <span>days have data</span>
            <Button variant="ghost" size="xs" onClick={() => { setOpen(false); router.push("/"); }}>Today</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon-sm" asChild aria-label="Next day" disabled={day >= today}>
        {day >= today ? <span aria-disabled className="pointer-events-none opacity-40"><ChevronRight /></span>
          : <Link href={hrefFor(shift(day, 1), today)}><ChevronRight /></Link>}
      </Button>
    </div>
  );
}
