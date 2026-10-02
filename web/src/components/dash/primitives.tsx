import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type Domain = "activity" | "sleep" | "exercise" | "heart" | "body" | "energy" | "neutral";

/** Static class names per health area (Tailwind needs literal strings). */
export const DOMAIN = {
  activity: { text: "text-activity", chip: "bg-activity/12 text-activity", bar: "bg-activity", color: "var(--activity)" },
  sleep: { text: "text-sleep", chip: "bg-sleep/12 text-sleep", bar: "bg-sleep", color: "var(--sleep)" },
  exercise: { text: "text-exercise", chip: "bg-exercise/12 text-exercise", bar: "bg-exercise", color: "var(--exercise)" },
  heart: { text: "text-heart", chip: "bg-heart/12 text-heart", bar: "bg-heart", color: "var(--heart)" },
  body: { text: "text-body", chip: "bg-body/12 text-body", bar: "bg-body", color: "var(--body)" },
  energy: { text: "text-energy", chip: "bg-energy/12 text-energy", bar: "bg-energy", color: "var(--energy)" },
  neutral: { text: "text-foreground", chip: "bg-muted text-foreground", bar: "bg-foreground", color: "var(--foreground)" },
} as const;

export function IconChip({ icon: Icon, domain, size = "md" }: { icon: LucideIcon; domain: Domain; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", DOMAIN[domain].chip,
      size === "sm" ? "size-7" : "size-9")}>
      <Icon className={size === "sm" ? "size-3.5" : "size-[18px]"} strokeWidth={2} />
    </span>
  );
}

/** A card section with a header row (icon, title, description, optional action). */
export function Panel({
  title, description, icon, domain = "neutral", action, children, className, bodyClassName,
}: {
  title?: React.ReactNode; description?: React.ReactNode; icon?: LucideIcon; domain?: Domain;
  action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(24_24_27/0.04)]", className)}>
      {(title || action) && (
        <div className="flex items-start gap-3 px-5 pt-4">
          {icon && <IconChip icon={icon} domain={domain} size="sm" />}
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold leading-7">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("flex-1 px-5 pb-5", title || action ? "pt-3" : "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      {children}
    </Link>
  );
}

/**
 * Change vs a reference, as an arrow + text. Colour says whether the change is good;
 * the arrow says the direction. Small changes read as neutral.
 */
export function Delta({ value, reference, upIsGood, format, suffix = "vs usual", threshold = 0.02 }: {
  value: number | null | undefined; reference: number | null | undefined; upIsGood: boolean;
  format: (absDiff: number) => string; suffix?: string; threshold?: number;
}) {
  if (value == null || reference == null || reference === 0) return null;
  const diff = value - reference;
  const rel = Math.abs(diff / reference);
  if (rel < threshold) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" /> about usual
      </span>
    );
  }
  const good = diff > 0 === upIsGood;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-good" : "text-bad")}>
      <Icon className="size-3.5" />
      {format(Math.abs(diff))} {diff > 0 ? "above" : "below"}
      <span className="font-normal text-muted-foreground">&nbsp;{suffix}</span>
    </span>
  );
}

/** Headline metric: icon, label, big value with unit, and a line of context. */
export function StatTile({
  label, value, unit, icon, domain, footer, href, children, className,
}: {
  label: string; value: React.ReactNode; unit?: string; icon: LucideIcon; domain: Domain;
  footer?: React.ReactNode; href?: string; children?: React.ReactNode; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <IconChip icon={icon} domain={domain} size="sm" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="tabular text-2xl font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {footer && <div className="mt-1 min-h-4">{footer}</div>}
      {children && <div className="mt-3">{children}</div>}
    </>
  );
  const cls = cn("block min-w-0 rounded-2xl border bg-card p-4 shadow-[0_1px_2px_rgb(24_24_27/0.04)]", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition-[border-color,transform] hover:border-ring/60 active:scale-[0.99]")}>{body}</Link>
  ) : <div className={cls}>{body}</div>;
}

/** Segmented control made of links, for server-rendered range switches. */
export function SegmentedLinks({ options, current, href }: {
  options: { value: string; label: string }[]; current: string; href: (v: string) => string;
}) {
  return (
    <nav className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
      {options.map((o) => (
        <Link key={o.value} href={href(o.value)} aria-current={o.value === current ? "page" : undefined}
          className={cn("rounded-md px-2.5 py-1.5 transition-colors",
            o.value === current ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

export function EmptyHint({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/** Small key/value row used inside panels. */
export function KV({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular text-sm font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
