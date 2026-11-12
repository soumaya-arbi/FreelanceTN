"use client";

import { Logo } from "@/components/ui/Logo";
import type { Page } from "@/lib/types";

function Footer({ go }: { go:(p:Page)=>void }) {
  const groups: { title: string; links: { label: string; page: Page }[] }[] = [
    { title: "Marketplace", links: [{ label: "Find talent", page: "freelancers" }, { label: "Find projects", page: "projects" }] },
    { title: "For talent", links: [{ label: "Freelancer dashboard", page: "dashboard" }, { label: "Portfolio", page: "portfolio" }] },
    { title: "Company", links: [{ label: "How it works", page: "home" }, { label: "Help center", page: "support" }, { label: "Browse freelancers", page: "freelancers" }] },
  ];
  return <footer><div className="container footer-grid"><div><Logo onClick={()=>go("home")}/><p>Find talent. Build great things.</p><span>© 2025 FreelanceTN, Inc.</span></div>{groups.map((g)=><div key={g.title}><b>{g.title}</b>{g.links.map(x=><button key={x.label} onClick={()=>go(x.page)}>{x.label}</button>)}</div>)}</div></footer>;
}

export { Footer };
