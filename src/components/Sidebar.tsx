"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import styles from "./Sidebar.module.css";
import {
  SignMarkIcon,
  DashboardIcon,
  VideosIcon,
  RawVideosIcon,
  ClipsIcon,
  TranscriptIcon,
  SettingsIcon,
  AdminsIcon,
  EditorsIcon,
  PermissionsIcon,
  UsersIcon,
  ChevronIcon,
} from "./icons/DashboardIcons";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  {
    label: "Videos",
    icon: VideosIcon,
    basePath: "/dashboard/videos",
    children: [
      { href: "/dashboard/videos/raw", label: "Raw Videos", icon: RawVideosIcon },
      { href: "/dashboard/videos/clips", label: "Clips", icon: ClipsIcon },
    ],
  },
  { href: "/dashboard/transcriptions", label: "Transcriptions", icon: TranscriptIcon },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon },
];

const superAdminNavItems = [
  { href: "/dashboard/admins", label: "Admins", icon: AdminsIcon },
  { href: "/dashboard/editors", label: "Editors", icon: EditorsIcon },
  { href: "/dashboard/users", label: "Users", icon: UsersIcon },
  { href: "/dashboard/permissions", label: "Permissions", icon: PermissionsIcon },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const canViewAdminSection = user?.role === "SuperAdmin" || user?.role === "Admin";

  const [openVideos, setOpenVideos] = useState(pathname.startsWith("/dashboard/videos"));

  // Keep the section open if navigating directly to a child route (e.g. on refresh)
  useEffect(() => {
    if (pathname.startsWith("/dashboard/videos")) {
      setOpenVideos(true);
    }
  }, [pathname]);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandGroup}>
        <div className={styles.logoWrap} aria-hidden="true">
          <SignMarkIcon />
        </div>
        <span className={styles.brandTitle}>ISLR DATA CAPTURE</span>
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => {
          // Parent item with children (Videos)
          if (item.children) {
            const isParentActive = pathname.startsWith(item.basePath);
            return (
              <div key={item.label} className={styles.navGroup}>
                <button
                  type="button"
                  onClick={() => setOpenVideos((prev) => !prev)}
                  className={`${styles.navItem} ${isParentActive ? styles.navItemActive : ""}`}
                  aria-expanded={openVideos}
                >
                  <item.icon />
                  <span className={styles.navLabel}>{item.label}</span>
                  <ChevronIcon
                    className={`${styles.navChevron} ${openVideos ? styles.navChevronOpen : ""}`}
                  />
                </button>

                {openVideos && (
                  <div className={styles.subNav}>
                    {item.children.map((child) => {
                      const active = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`${styles.subNavItem} ${active ? styles.subNavItemActive : ""}`}
                        >
                          <child.icon />
                          <span className={styles.navLabel}>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // Regular top-level item
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
            >
              <item.icon />
              <span className={styles.navLabel}>{item.label}</span>
            </Link>
          );
        })}

        {canViewAdminSection && (
          <>
            <div className={styles.navDivider} aria-hidden="true" />
            {superAdminNavItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                >
                  <Icon />
                  <span className={styles.navLabel}>{label}</span>
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}