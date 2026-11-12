"use client";
import React from "react";
import { Icon } from "@/components/ui/Icon";
import { AppShell } from "@/components/layout/AppShell";
import type { Page } from "@/lib/types";

function Messages({ go, notify }: { go: (p: Page) => void; notify: (s: string) => void }) {
  return <AppShell page="messages" go={go} notify={notify}><main className="message-app"><aside className="conversation-list"><div className="message-title"><h1>Messages</h1><button onClick={()=>notify("New conversations require the backend")}><Icon name="more"/></button></div><div className="conversation-search"><Icon name="search"/><input placeholder="Search conversations"/></div><p className="task-empty">No conversations yet.</p></aside><section className="chat"><div className="chat-body"><p className="task-empty">Select a conversation to start messaging.</p></div></section></main></AppShell>;
}

export { Messages };
