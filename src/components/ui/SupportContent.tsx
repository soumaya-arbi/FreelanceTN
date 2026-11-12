"use client";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { IconName } from "@/lib/types";

function SupportContent({ notify }: { notify:(x:string)=>void }) {
  return <><div className="support-search"><Icon name="search"/><div><h2>How can we help?</h2><input placeholder="Search guides, payments, account security…"/></div></div><div className="support-grid">{[["Getting started","Profile, onboarding, and account basics","users"],["Finding work","Projects, proposals, and invitations","search"],["Projects & payments","Contracts, milestones, and payouts","wallet"],["Trust & safety","Verification, privacy, and disputes","shield"]].map(x=><button key={x[0]} onClick={()=>notify(`${x[0]} guides require the backend`)}><span><Icon name={x[2] as IconName}/></span><b>{x[0]}</b><small>{x[1]}</small><Icon name="arrow"/></button>)}</div><div className="support-bottom"><section className="dash-card"><div className="card-heading"><h3>Your support tickets</h3><button onClick={()=>notify("Creating a support ticket requires the backend")}>Create ticket</button></div><div className="empty-state"><span><Icon name="file" size={20}/></span><b>No support tickets</b><p>Tickets you create from here will appear in this list. None exist for now.</p></div></section><aside className="dash-card"><Icon name="message"/><h3>Still need help?</h3><p>Our support team typically replies within one business day.</p><Button onClick={()=>notify("Contacting support requires the backend")}>Contact support</Button></aside></div></>;
}

export { SupportContent };
