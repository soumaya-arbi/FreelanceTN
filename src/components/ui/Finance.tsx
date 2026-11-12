"use client";


function Finance({notify}:{notify:(x:string)=>void}) {
  return <><div className="metric-grid finance-metrics">{[["Available balance","—"],["Pending balance","—"],["This month","—"],["Lifetime earnings","—"]].map((x,i)=><article className="metric-card" key={x[0]}><span>{x[0]}</span><strong>{x[1]}</strong><small>{i===0?"No funds available to withdraw":"No payment data connected"}</small></article>)}</div><div className="dash-card transactions"><div className="card-heading"><h3>Recent transactions</h3><button onClick={()=>notify("Exporting a transaction report requires the backend")}>Export CSV</button></div><p className="task-empty">No transactions yet.</p></div></>;
}

export { Finance };
