"use client";

import { usePathname } from "next/navigation";
import { UserProvider } from "@/contexts/UserContext";
import Sidebar from "@/components/Sidebar";
import DashboardHeader from "@/components/DashboardHeader";
import styles from "./layout.module.css";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/all-videos": "All Videos",
  "/dashboard/transcriptions": "Transcriptions",
  "/dashboard/settings": "Settings",
};

// Routes that should render with no sidebar/header — e.g. popup windows
// that are meant to be a plain, focused view (teleprompter, print views,
// etc.), not a full dashboard page.
const CHROMELESS_ROUTES = ["/dashboard/videos/teleprompter"];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChromeless = CHROMELESS_ROUTES.some((route) => pathname?.startsWith(route));

  if (isChromeless) {
    // Still wrap in UserProvider in case the chromeless page (or hooks it
    // uses) rely on user context — just skip the sidebar/header/shell.
    return <UserProvider>{children}</UserProvider>;
  }

  const title = titles[pathname] ?? "Dashboard";

  return (
    <UserProvider>
      <div className={styles.shell}>
        <Sidebar />
        <div className={styles.contentArea}>
          <DashboardHeader title={title} />
          <main className={styles.pageContent}>{children}</main>
        </div>
      </div>
    </UserProvider>
  );
}