import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Sticky top bar for each page: sidebar toggle, title, and page controls on the right. */
export function PageHeader({ title, subtitle, children }: {
  title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 transition-[min-height] duration-200 ease-linear md:min-h-16 md:px-6 md:py-1.5 md:group-has-data-[collapsible=icon]/sidebar-wrapper:min-h-12">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 data-vertical:h-5 data-vertical:self-center" />
        {/* The basis keeps the title readable on a phone: page controls wrap below it instead of squeezing it. */}
        <div className="min-w-0 flex-1 basis-36">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 md:px-6 md:py-6">{children}</div>;
}
