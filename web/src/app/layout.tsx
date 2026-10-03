import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { nowMs } from "@/lib/analytics";
import { fmtAgo } from "@/lib/format";
import { dataCoverage } from "@/lib/queries";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Today · Watch Health", template: "%s · Watch Health" },
  description: "Personal Galaxy Watch health dashboard",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const last = dataCoverage().lastAndroidSync;
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased", geist.variable, geistMono.variable)}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            <SidebarProvider>
              <AppSidebar lastSync={last ? fmtAgo(Date.parse(last), nowMs()) : null} />
              <SidebarInset className="md:h-[calc(100svh-1rem)] md:overflow-y-auto md:border">{children}</SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
