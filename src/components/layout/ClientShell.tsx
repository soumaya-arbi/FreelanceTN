"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import type { Page } from "@/lib/types";
import { clientNav } from "@/lib/navigation";
import { useUser } from "@/context/UserContext";
import { AvatarBadge } from "@/components/views/account/AvatarBadge";
import { NotificationsBell } from "@/components/modules/NotificationsBell";

function ClientShell({
  page = "client",
  go,
  notify,
  children,
  hideSidebarLogo = false,
}: {
  page?: Page;
  go: (p: Page) => void;
  notify: (s: string) => void;
  children: React.ReactNode;
  hideSidebarLogo?: boolean;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, authUser, logout } = useUser();
  // Le nom affiché est celui du compte authentifié, jamais une société fictive.
  const displayName = user.name || user.email || "Client workspace";
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
      className="company-avatar"
    />
  );
  const avatarSmall = (
    <AvatarBadge
      url={authUser?.avatar || undefined}
      firstName={authUser?.firstName ?? ""}
      lastName={authUser?.lastName ?? ""}
      preset={authUser?.avatarPreset}
      color={authUser?.avatarColor}
      size={30}
      source={authUser?.avatarSource}
      avatarConfig={authUser?.avatarConfig}
      className="company-avatar small"
    />
  );
  // Le rôle du compte est fixé à l'inscription : il n'y a plus de bascule
  // d'espace. Le bouton du bandeau ramène au tableau de bord client.
  const handleLogout = async () => {
    await logout();
    go("home");
  };
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    notify(collapsed ? "Navigation expanded" : "Navigation collapsed");
  };
  return (
    <div className={mobileOpen ? "app-shell client-shell mobile-open" : "app-shell client-shell"}>
      {mobileOpen && (
        <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />
      )}
      <aside className={collapsed ? "app-sidebar client-sidebar collapsed" : "app-sidebar client-sidebar"}>
        {!hideSidebarLogo && (
          <div className="sidebar-logo">
            <Logo onClick={() => go("home")} />
          </div>
        )}
        <button className="client-role" onClick={() => go("client")}>
          {avatar}
          <span>
            <small>Client workspace</small>
            <b>{displayName}</b>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <nav>
          {clientNav.map((x) => (
            <button
              className={page === x.page ? "active" : ""}
              key={x.label}
              onClick={() => {
                if (x.page) go(x.page);
                else notify(`${x.label} opened in the client workspace`);
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
            <span>Client workspace</span>
          </div>
          <div>
            <NotificationsBell />
            <button className="icon-btn" onClick={() => go("settings")} aria-label="Settings">
              <Icon name="settings" />
            </button>
            <button className="app-user" onClick={() => router.push("/client/profile")} aria-label="Open my profile">
              {avatarSmall}
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

export { ClientShell };
