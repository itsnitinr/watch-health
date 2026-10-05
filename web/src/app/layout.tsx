import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { nowMs } from "@/lib/analytics";
import { fmtAgo } from "@/lib/format";
import { THEME_COLORS } from "@/lib/palette";
import { dataCoverage } from "@/lib/queries";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "Today · Watch Health", template: "%s · Watch Health" },
  description: "Personal Galaxy Watch health dashboard",
  appleWebApp: { title: "Watch Health", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Lets the page reach under Android's gesture bar; the tab bar pads itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const last = dataCoverage().lastAndroidSync;
  const lastSync = last ? fmtAgo(Date.parse(last), nowMs()) : null;
  return (
    <html lang="en" suppressHydrationWarning className={cn("antialiased", geist.variable, geistMono.variable)}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={200}>
            <SidebarProvider>
              <AppSidebar lastSync={lastSync} />
              <SidebarInset className="pb-(--bottom-nav) md:h-[calc(100svh-1rem)] md:overflow-y-auto md:border md:pb-0">{children}</SidebarInset>
              <BottomNav lastSync={lastSync} />
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
