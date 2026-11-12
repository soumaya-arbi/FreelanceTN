"use client";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";

const firstNumber = (value: string) => {
  const match = value.replace(/\s/g, "").match(/(\d+(?:[.,]\d+)?)/g);
  if (!match) return 0;
  return Math.max(...match.map((n) => Number(n.replace(",", ".")) || 0));
};

function ModuleTable({ tabs, active, setActive, rows, notify, onOpen }: { tabs:string[]; active:string; setActive:(x:string)=>void; rows:string[][]; notify:(x:string)=>void; onOpen?:(row:string[])=>void }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Newest first");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? rows.filter((row) => row.join(" ").toLowerCase().includes(term)) : [...rows];
    if (sort === "Highest value") return filtered.sort((a, b) => firstNumber(b[2] ?? "") - firstNumber(a[2] ?? ""));
    return filtered;
  }, [rows, search, sort]);
  return <div className="dash-card module-table"><div className="module-tabs">{tabs.map(x=><button className={active===x?"active":""} onClick={()=>setActive(x)} key={x}>{x}</button>)}</div><div className="table-toolbar"><div className="conversation-search"><Icon name="search"/><input placeholder="Search records" value={search} onChange={(e)=>setSearch(e.target.value)}/></div><select aria-label="Sort records" value={sort} onChange={(e)=>setSort(e.target.value)}><option>Newest first</option><option>Highest value</option></select></div>{visible.length===0&&<p className="task-empty">No records match your search.</p>}{visible.map((x,i)=><button className="module-table-row" onClick={()=>onOpen?onOpen(x):notify(`${x[0]} details opened`)} key={x[0]}><span className={`project-symbol p${i%3}`}><Icon name="file"/></span><span><b>{x[0]}</b><small>{x[5] ? `${x[1]} · ${x[5]}` : x[1]}</small></span><strong>{x[2]}</strong><em>{x[3]}</em><Icon name="chevron"/></button>)}</div>;
}

export { ModuleTable };
