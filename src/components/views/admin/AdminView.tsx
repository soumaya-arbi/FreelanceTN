"use client";
import React, { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import type { IconName, Page } from "@/lib/types";
import { useUser } from "@/context/UserContext";

function Admin({ go, notify, initialSection = "Overview", onSection }: { go:(p:Page)=>void; notify:(s:string)=>void; initialSection?:string; onSection?:(section:string)=>void }) {
  const [section,setSection]=useState(initialSection);
  const [prevSection,setPrevSection]=useState(initialSection);
  const { role } = useUser();
  if (prevSection !== initialSection) {
    setPrevSection(initialSection);
    setSection(initialSection);
  }
  const adminSections=["Overview","Users","Verifications","Services","Projects","Orders","Transactions","Disputes","Reports","Analytics","Platform settings","Audit logs"];
  return <div className="admin-shell"><aside><Logo onClick={()=>go("home")}/><span>ADMIN CONSOLE</span>{adminSections.map((x,i)=><button className={section===x?"active":""} key={x} onClick={()=>{setSection(x);if(onSection)onSection(x)}}><Icon name={["dashboard","users","shield","portfolio","file","briefcase","wallet","bell","message","dashboard","settings","file"][i] as IconName}/>{x}</button>)}</aside><main><header><div><h1>{section==="Overview"?"Platform overview":section}</h1><p>No administrative data source is connected to the backend yet</p></div><Button onClick={()=>go(role==="client"?"client":"dashboard")}>Exit admin</Button></header>{section==="Overview"?<><div className="metric-grid">{[["Total users","—"],["Active orders","—"],["Gross volume","—"],["Open disputes","—"]].map(x=><article className="metric-card" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><small>No data connected</small></article>)}</div><div className="admin-grid"><article className="dash-card"><div className="card-heading"><h3>Platform growth</h3><select><option>Last 12 months</option></select></div><div className="empty-state"><span><Icon name="dashboard" size={20}/></span><b>No activity data available</b><p>The backend does not expose platform-wide statistics yet, so nothing is charted here.</p></div></article><article className="dash-card review-queue"><div className="card-heading"><h3>Action required</h3></div><div className="empty-state"><span><Icon name="shield" size={20}/></span><b>No moderation queue</b><p>Verification, report and dispute queues appear once the corresponding backend endpoints exist.</p></div></article></div><article className="dash-card admin-table"><div className="card-heading"><h3>Recent activity</h3></div><div className="empty-state"><span><Icon name="clock" size={20}/></span><b>No audit trail available</b><p>Administrative events are not recorded by the backend yet.</p></div></article></>:<AdminSection section={section} notify={notify}/>}</main></div>;
}

function AdminSection({section,notify}:{section:string;notify:(x:string)=>void}) {
  return <section className="dash-card admin-section"><div className="table-toolbar"><div className="conversation-search"><Icon name="search"/><input placeholder={`Search ${section.toLowerCase()}`}/></div><div><Button variant="secondary" onClick={()=>notify(`${section} filters require the backend`)}>Filters</Button><Button onClick={()=>notify(`Creating records in ${section} requires the backend`)}>Add new</Button></div></div><div className="admin-section-head"><span>Name or record</span><span>Details</span><span>Updated</span><span>Status</span><span/></div><div className="empty-state"><span><Icon name="file" size={20}/></span><b>No {section.toLowerCase()} available</b><p>The backend does not expose any {section.toLowerCase()} records. Nothing is listed here.</p></div></section>;
}

export { Admin, AdminSection };
