"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ClientShell } from "@/components/layout/ClientShell";
import type { Page, ClientProcessMode } from "@/lib/types";
import { freelancers } from "@/lib/data";

function ClientMessages({ go, notify, openProcess }: { go:(p:Page)=>void; notify:(x:string)=>void; openProcess:(mode:ClientProcessMode)=>void }) {
  const router = useRouter();
  const threads: string[][] = [];
  const [active,setActive]=useState(0);
  const [text,setText]=useState("");
  const [sent,setSent]=useState<string[]>([]);
  const contacts=freelancers.slice(0,3);
  const send=()=>{if(text.trim()){setSent([...sent,text]);setText("");notify("Message sent — this conversation is stored for this session only")}};
  const openConversation=(i:number)=>{setActive(i);setSent([])};
  const current = contacts[active];
  return <ClientShell page="messages" go={go} notify={notify}><main className="message-app"><aside className="conversation-list"><div className="message-title"><h1>Messages</h1><button onClick={()=>notify("New conversations require the backend")}><Icon name="message"/></button></div><div className="conversation-search"><Icon name="search"/><input placeholder="Search conversations"/></div>{contacts.map((f,i)=><button onClick={()=>openConversation(i)} className={active===i?"conversation active":"conversation"} key={f.name}><span><img src={f.avatar} alt=""/><i/></span><div><b>{f.name}</b><p>{threads[i]?.[0]?.slice(0,28) ?? ""}…</p></div></button>)}{contacts.length===0&&<p className="task-empty">No conversations yet.</p>}</aside><section className="chat">{current?<><header><div><img src={current.avatar} alt=""/><span><b>{current.name}</b><small><i/> Online · Freelancer</small></span></div><div><button onClick={()=>router.push(`/client/talent/${current.id}`)}><Icon name="users"/></button><button onClick={()=>notify("Conversation options require the backend")}><Icon name="more"/></button></div></header><div className="project-context"><span><Icon name="briefcase"/></span><div><small>PROJECT</small><b>No project selected</b></div><em>—</em><button onClick={()=>openProcess("workspace")}>Open workspace <Icon name="chevron"/></button></div><div className="chat-body">{threads[active]?.[0]?<><span className="date-divider">Today</span><div className="bubble theirs">{threads[active]?.[0]}</div><div className="bubble mine">{threads[active]?.[1]}</div></>:<p className="task-empty">Select a conversation to start messaging.</p>}{sent.map((x,i)=><div className="bubble mine" key={i}>{x}<small>Just now</small></div>)}</div><div className="composer"><button onClick={()=>notify("Attaching files requires the backend")}><Icon name="file"/></button><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Write a message…"/><button className="send" onClick={send}><Icon name="arrow"/></button></div></>:<div className="empty-state" style={{ margin: "40px auto" }}><span><Icon name="message" size={20}/></span><b>No conversation available</b><p>Conversations appear here once a professional accepts an invitation or replies to one of your projects.</p></div>}</section></main></ClientShell>;
}

export { ClientMessages };
