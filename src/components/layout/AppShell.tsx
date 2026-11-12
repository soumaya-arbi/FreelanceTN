"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import type { Page } from "@/lib/types";
import { sideItems } from "@/lib/navigation";
import { useUser } from "@/context/UserContext";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { NotificationsBell } from "@/components/modules/NotificationsBell";

function AppShell({
  page,
  go,
  children,
  notify,
  hideSidebarLogo = false,
}: {
  page: Page;
  go: (p: Page) => void;
  children: React.ReactNode;
  notify: (s: string) => void;
  hideSidebarLogo?: boolean;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { role, user, authUser, logout } = useUser();
  const isClient = role === "client";
  // L'identité affichée provient exclusivement du compte authentifié.
  const displayName = user.name || user.email || "Account";
  const avatar = (
    <AvatarBadge
      url={authUser?.avatar || undefined}
      firstName={authUser?.firstName ?? ""}
      lastName={authUser?.lastName ?? ""}
      preset={authUser?.avatarPreset}
      color={authUser?.avatarColor}
      size={38}
      source={authUser?.avatarSource}
      avatarConfig={authUser?.avatarConfig}
    />
  );
  const handleLogout = async () => {
    await logout();
    go("home");
  };
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    notify(collapsed ? "Navigation expanded" : "Navigation collapsed");
  };
  const openOwnProfile = () => {
    if (role === "client") {
      router.push("/client/profile");
      return;
    }
    if (authUser?.id) router.push(`/freelancers/${authUser.id}`);
  };
  return (
    <div className={mobileOpen ? "app-shell mobile-open" : "app-shell"}>
      {mobileOpen && (
        <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
      )}
      <aside className={collapsed ? "app-sidebar collapsed" : "app-sidebar"}>
        {!hideSidebarLogo && (
          <div className="sidebar-logo">
            <Logo onClick={() => go("home")} />
          </div>
        )}
        <button className="role-switch" onClick={() => go(isClient ? "client" : "dashboard")}>
          {avatar}
          <span>
            <small>{isClient ? "Client mode" : "Freelancer mode"}</small>
            <b>{displayName}</b>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <nav>
          {sideItems.map((x) => (
            <button
              key={x.label}
              className={page === x.page ? "active" : ""}
              onClick={() => {
                go(x.page);
                setMobileOpen(false);
              }}
            >
              <Icon name={x.icon} />
              <span>{x.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={handleLogout}>
            <Icon name="arrow" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <div className="app-content">
        <header className="app-header">
          <div>
            <button className="mobile-sidebar" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Icon name="menu" />
            </button>
            <button
              className="sidebar-toggle"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
            >
              <Icon name="menu" />
            </button>
            <span>Workspace</span>
          </div>
          <div>
            <NotificationsBell />
            <button className="icon-btn" onClick={() => go("settings")} aria-label="Settings">
              <Icon name="settings" />
            </button>
            <button className="app-user" onClick={openOwnProfile} aria-label="Open my profile">
              {avatar}
              <span>{displayName}</span>
              <Icon name="chevron" size={13} />
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export { AppShell };
