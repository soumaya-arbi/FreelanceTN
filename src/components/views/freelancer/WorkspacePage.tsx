"use client";
import React from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Finance } from "@/components/ui/Finance";
import { AppShell } from "@/components/layout/AppShell";
import { useMarketplace } from "@/context/MarketplaceContext";
import { AccountSettings } from "@/components/views/account/AccountSettings";
import type { Page, EditorMode } from "@/lib/types";

function WorkspacePage({ page, go, notify, openEditor }: { page: Page; go: (p: Page) => void; notify: (s: string) => void; openEditor: (mode: EditorMode) => void }) {
  const content: Record<string,[string,string]>={portfolio:["Portfolio","Showcase the work, thinking, and results that make you stand out."],orders:["Projects & Contracts","Track active projects, milestones, deliveries, and client approvals."],earnings:["Earnings","Understand your income, balances, transaction history, and payouts."],settings:["Settings","Manage your profile, security, notifications, privacy, and preferences."]};
  const [title,sub]=content[page]||["Workspace","Manage your FreelanceTN account."];
  const { portfolio } = useMarketplace();
  const publishedProjects = portfolio.filter((item) => item.published).length;
  const draftProjects = portfolio.filter((item) => !item.published).length;
  return <AppShell page={page} go={go} notify={notify}><main className="workspace"><div className="workspace-title"><div><p>WORKSPACE</p><h1>{title}</h1><span>{sub}</span></div>{page!=="settings"&&<Button onClick={()=>page==="portfolio"?openEditor("portfolio"):page==="orders"?openEditor("order"):openEditor("withdrawal")}>{page==="portfolio"?"Add portfolio project":page==="orders"?"Open active project":"Withdraw earnings"}</Button>}</div>
    {page==="portfolio"?<div className="portfolio-manager"><div className="manager-stats"><article><b>{String(publishedProjects)}</b><span>Published projects</span></article><article><b>{String(draftProjects)}</b><span>Draft projects</span></article><article><b>—</b><span>Portfolio views</span></article></div>{portfolio.length===0&&<p className="task-empty">No portfolio projects yet. Add your first case study to showcase your work.</p>}</div>:page==="earnings"?<Finance notify={notify}/>:page==="settings"?<AccountSettings role="freelancer"/>:<div className="table-card"><div className="table-toolbar"><div className="conversation-search"><Icon name="search"/><input placeholder={`Search ${title.toLowerCase()}`}/></div><select><option>All statuses</option><option>Active</option><option>Completed</option></select></div><p className="task-empty">No records yet.</p></div>}</main></AppShell>;
}

export { WorkspacePage };
