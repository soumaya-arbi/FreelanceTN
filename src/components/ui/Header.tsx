"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { Page } from "@/lib/types";
import { useUser } from "@/context/UserContext";
import { homePathForRole } from "@/lib/navigation";

function Header({ go, dark, setDark, openAuth }: { go: (p: Page) => void; dark: boolean; setDark: (v: boolean) => void; openAuth: () => void }) {
  const [mobile, setMobile] = useState(false);
  const router = useRouter();
  const { status, role } = useUser();
  const authenticated = status === "authenticated";
  const close = () => setMobile(false);
  return <header className="topbar">
    <div className="container header-inner">
      <Logo onClick={() => go("home")}/>
      <nav className={mobile ? "public-nav open" : "public-nav"}>
        <button onClick={() => {go("freelancers"); close()}}>Find talent</button>
        <button onClick={() => {go("projects"); close()}}>Find projects</button>
        <button onClick={() => {router.push("/#how-it-works"); close()}}>How it works</button>
        <div className="public-nav-auth">
          {authenticated ? (
            <Button onClick={() => { router.push(homePathForRole(role)); close(); }}>Go to dashboard</Button>
          ) : (
            <>
              <button className="text-btn" onClick={() => { openAuth(); close(); }}>Log in</button>
              <Button onClick={() => { go("register"); close(); }}>Join FreelanceTN</Button>
            </>
          )}
        </div>
      </nav>
      <div className="header-actions">
        <button className="icon-btn theme-btn" onClick={() => setDark(!dark)} aria-label="Toggle theme"><Icon name={dark ? "sun" : "moon"}/></button>
        {authenticated ? (
          <Button className="header-dashboard" onClick={() => router.push(homePathForRole(role))}>Dashboard</Button>
        ) : (
          <>
            <button className="text-btn desktop-only" onClick={openAuth}>Log in</button>
            <Button className="header-join" onClick={() => go("register")}>Join FreelanceTN</Button>
          </>
        )}
        <button className="icon-btn mobile-menu" onClick={() => setMobile(!mobile)} aria-label={mobile ? "Close menu" : "Open menu"} aria-expanded={mobile}>
          <Icon name={mobile ? "close" : "menu"}/>
        </button>
      </div>
    </div>
  </header>;
}

export { Header };
