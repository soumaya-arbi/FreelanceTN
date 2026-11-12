"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { FormField, EditorHeading } from "@/components/ui/Form";
import { ClientShell } from "@/components/layout/ClientShell";
import { clientProcessPath } from "@/lib/navigation";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { ApiError, commentsApi, projectsApi, type SubmitFeedbackInput } from "@/lib/api";
import { ProjectDiscussion } from "@/components/shared/ProjectDiscussion";
import { ProjectPipeline } from "@/components/shared/ProjectPipeline";
import { FeedbackForm } from "@/components/shared/FeedbackForm";
import { AttachmentList, attachmentKind, formatFileSize } from "@/components/shared/AttachmentList";
import type { Page, ClientProcessMode, Project, ProjectAttachment, ProjectStatus } from "@/lib/types";
import { projectStatusOptions } from "@/lib/types";

function ClientProcess({ initialMode, go, notify, project, projectLoading, projectError }: { initialMode: ClientProcessMode; go: (p: Page) => void; notify: (x: string) => void; project?: Project; projectLoading?: boolean; projectError?: string }) {
  const router = useRouter();
  const { submitFeedback, refreshFeedback, feedback, updateProject, assignProject, assignees, assigneesLoading, assigneesError } = useMarketplace();
  const { user } = useUser();
  const [stage,setStage]=useState<ClientProcessMode>(initialMode);
  const [shortlisted,setShortlisted]=useState(false);
  const [revision,setRevision]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [milestones,setMilestones]=useState<Array<{name:string;amount:string;date:string}>>([]);
  // Édition en ligne du projet affiché : les valeurs sont initialisées depuis
  // le projet chargé par l'API.
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState({title:"",description:"",budget:"",type:"Fixed price",budgetMin:"",budgetMax:"",durationValue:"",durationUnit:"Weeks",category:"",deadline:"",status:"Open" as ProjectStatus});
  const [saving,setSaving]=useState(false);
  const [approving,setApproving]=useState(false);
  // Revue de la livraison soumise par le freelance (statut « Client review »).
  const [revisionOpen,setRevisionOpen]=useState(false);
  const [revisionNote,setRevisionNote]=useState("");
  const [approvalError,setApprovalError]=useState("");
  const [newFiles,setNewFiles]=useState<Array<{id:string;file:File;name:string;size:number;status:"idle"|"uploading"|"success"|"error";error?:string;attachment?:ProjectAttachment}>>([]);
  const [editUploadError,setEditUploadError]=useState("");
  // Freelance retenu pour l'approbation. Tant qu'aucun choix n'est fait,
  // l'approbation courante du projet est reprise.
  const [assigneeId,setAssigneeId]=useState<string|null>(null);
  const selectedAssignee=assigneeId??project?.assignedTo??"";
  // L'édition démarre depuis le projet affiché : le formulaire est rempli au
  // moment où l'utilisateur demande la modification.
  const startEdit=()=>{
    if(!project) return;
    setDraft({title:project.title,description:project.description,budget:project.budget,type:project.type,budgetMin:project.budgetMin != null ? String(project.budgetMin) : "",budgetMax:project.budgetMax != null ? String(project.budgetMax) : "",durationValue:project.durationValue != null ? String(project.durationValue) : "",durationUnit:project.durationUnit || "Weeks",category:project.category,deadline:project.deadline,status:project.status});
    setAssigneeId(project.assignedTo??null);
    setNewFiles([]);
    setEditUploadError("");
    setEditing(true);
  };
  const stopEdit=()=>{
    setEditing(false);
    setAssigneeId(null);
    setNewFiles([]);
    setEditUploadError("");
  };

  const handleAddNewFiles=(fileList:FileList|File[])=>{
    const incoming=Array.from(fileList).map((f)=>({
      id:`${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2,8)}`,
      file:f,
      name:f.name,
      size:f.size,
      status:"idle" as const,
    }));
    setNewFiles((prev)=>[...prev,...incoming]);
    setEditUploadError("");
  };

  const handleRemoveNewFile=(id:string)=>{
    setNewFiles((prev)=>prev.filter((f)=>f.id!==id));
  };

  const retrySingleNewFile=async(id:string)=>{
    if(!project) return;
    setSaving(true);
    setEditUploadError("");
    try{
      const fileIndex=newFiles.findIndex((f)=>f.id===id);
      if(fileIndex===-1) return;
      const target=newFiles[fileIndex];

      const nextFiles=newFiles.map((f,i)=>i===fileIndex?{...f,status:"uploading" as const,error:undefined}:f);
      setNewFiles(nextFiles);

      const res=await projectsApi.uploadAttachment(project.id,target.file);
      const att:ProjectAttachment={
        fileName:res.fileName,
        url:res.url,
        size:res.size,
        uploadedAt:new Date().toISOString(),
      };

      const finalFiles=nextFiles.map((f,i)=>i===fileIndex?{...f,status:"success" as const,attachment:att,error:undefined}:f);
      setNewFiles(finalFiles);

      const existing=project.attachments??[];
      const combined=[...existing,att];
      const deduped:ProjectAttachment[]=[];
      const dedupSet=new Set<string>();
      for(const a of combined){
        const key=a.url.toLowerCase();
        if(!dedupSet.has(key)){
          dedupSet.add(key);
          deduped.push(a);
        }
      }

      await updateProject(project.id,{attachments:deduped});
      notify("Attachment uploaded");
      if(!finalFiles.some((f)=>f.status==="error")) setEditUploadError("");
    }catch(e){
      const msg=e instanceof Error?e.message:"Upload failed";
      setNewFiles((prev)=>prev.map((f)=>f.id===id?{...f,status:"error",error:msg}:f));
      setEditUploadError("Upload failed for this file.");
    }finally{
      setSaving(false);
    }
  };

  const saveProject=async()=>{
    if(!project) return;
    setSaving(true);
    setEditUploadError("");
    try{
      let currentItems=[...newFiles];
      const existingAttachments=project.attachments??[];
      const knownUrls=new Set(existingAttachments.map((a)=>a.url.toLowerCase()));
      const newSuccessAttachments:ProjectAttachment[]=[];
      let hasUploadErrors=false;

      for(let i=0;i<currentItems.length;i++){
        const item=currentItems[i];
        if(item.status==="success"){
          if(item.attachment&&!knownUrls.has(item.attachment.url.toLowerCase())){
            knownUrls.add(item.attachment.url.toLowerCase());
            newSuccessAttachments.push(item.attachment);
          }
          continue;
        }

        currentItems=currentItems.map((it,idx)=>idx===i?{...it,status:"uploading",error:undefined}:it);
        setNewFiles(currentItems);

        try{
          const res=await projectsApi.uploadAttachment(project.id,item.file);
          const att:ProjectAttachment={
            fileName:res.fileName,
            url:res.url,
            size:res.size,
            uploadedAt:new Date().toISOString(),
          };
          if(!knownUrls.has(att.url.toLowerCase())){
            knownUrls.add(att.url.toLowerCase());
            newSuccessAttachments.push(att);
          }
          currentItems=currentItems.map((it,idx)=>idx===i?{...it,status:"success",attachment:att,error:undefined}:it);
          setNewFiles(currentItems);
        }catch(e){
          hasUploadErrors=true;
          const msg=e instanceof Error?e.message:"Upload failed";
          currentItems=currentItems.map((it,idx)=>idx===i?{...it,status:"error",error:msg}:it);
          setNewFiles(currentItems);
        }
      }

      // Conserver les anciennes pièces jointes sans suppression automatique + déduplication
      const combined=[...existingAttachments,...newSuccessAttachments];
      const deduped:ProjectAttachment[]=[];
      const dedupSet=new Set<string>();
      for(const a of combined){
        const key=a.url.toLowerCase();
        if(!dedupSet.has(key)){
          dedupSet.add(key);
          deduped.push(a);
        }
      }

      await updateProject(project.id,{
        ...draft,
        budgetMin: draft.budgetMin ? Number(draft.budgetMin) : null,
        budgetMax: draft.budgetMax ? Number(draft.budgetMax) : null,
        durationValue: draft.durationValue ? Number(draft.durationValue) : null,
        durationUnit: draft.durationValue ? draft.durationUnit : null,
        attachments: deduped,
      });

      if(hasUploadErrors){
        notify("Project updated, but some attachments failed to upload.");
        setEditUploadError("Certains fichiers n'ont pas pu être uploadés. Vous pouvez les réessayer.");
      }else{
        notify("Project updated");
        setNewFiles([]);
        setEditing(false);
      }
    }catch(err){
      notify(err instanceof ApiError?err.message:"Impossible to update this project.");
    }finally{
      setSaving(false);
    }
  };
  const changeStatus=async(status:ProjectStatus,message:string)=>{
    if(!project) return;
    setSaving(true);
    try{
      await updateProject(project.id,{status});
      notify(message);
    }catch(err){
      notify(err instanceof ApiError?err.message:"Impossible to change the project status.");
    }finally{
      setSaving(false);
    }
  };
  // Approbation de la livraison soumise : le projet passe à « Completed » via
  // la transition existante. Le freelance est notifié par le backend.
  const approveDelivery=async()=>{
    if(!project) return;
    setSaving(true);
    setApprovalError("");
    try{
      await updateProject(project.id,{status:"Completed"});
      notify("Delivery approved — the project is now completed.");
    }catch(err){
      setApprovalError(err instanceof ApiError?err.message:"The delivery could not be approved.");
    }finally{
      setSaving(false);
    }
  };
  // Demande de correction : retour au statut « In progress » (transition
  // autorisée) puis note publiée dans la discussion existante du projet.
  const requestRevision=async()=>{
    if(!project) return;
    const note=revisionNote.trim();
    if(note.length<5){
      setApprovalError("Explain what needs to change before sending the request.");
      return;
    }
    setSaving(true);
    setApprovalError("");
    try{
      await updateProject(project.id,{status:"In progress"});
      try{
        await commentsApi.create(project.id,`Revision requested: ${note}`);
      }catch{
        /* la transition de statut reste valable même si le message échoue */
      }
      notify("Revision request sent — the project is back in progress.");
      setRevisionOpen(false);
      setRevisionNote("");
    }catch(err){
      setApprovalError(err instanceof ApiError?err.message:"The revision request could not be sent.");
    }finally{
      setSaving(false);
    }
  };
  const approveFreelancer=async()=>{
    if(!project||!selectedAssignee) return;
    setApproving(true);
    try{
      // Un projet encore « Open » démarre réellement à l'approbation : on
      // réutilise la transition existante vers « In progress » afin que le
      // freelance retrouve le contrat actif dans son espace.
      const nextStatus = project.status === "Open" ? "In progress" as const : undefined;
      await assignProject(project.id,selectedAssignee,nextStatus);
      notify("Freelancer approved — the project now appears in their dashboard and projects tab.");
    }catch(err){
      notify(err instanceof ApiError?err.message:"Impossible to approve this freelancer.");
    }finally{
      setApproving(false);
    }
  };
  const revokeApproval=async()=>{
    if(!project) return;
    setApproving(true);
    try{
      await assignProject(project.id,"");
      setAssigneeId(null);
      notify("Approval removed.");
    }catch(err){
      notify(err instanceof ApiError?err.message:"Impossible to remove the approval.");
    }finally{
      setApproving(false);
    }
  };
  const parseAmount=(value:string)=>Number(value.replace(/[^0-9.]/g,""))||0;
  const contractTotal=milestones.reduce((sum,milestone)=>sum+parseAmount(milestone.amount),0);
  const formatAmount=(value:number)=>value.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  useEffect(()=>{
    if(stage===initialMode) return;
    router.replace(clientProcessPath(stage));
  },[stage,initialMode,router]);
  const projectTitle=project?.title??"Project";
  // Statuts que l'API autorise depuis le statut actuel du projet.
  const statusOptions=project?projectStatusOptions(project.status):([] as ProjectStatus[]);
  // Le freelancer est déduit par l'API depuis le projet approuvé : le client
  // n'envoie jamais d'identifiant de destinataire. On recharge les avis du
  // client pour détecter un avis déjà publié avant d'afficher le formulaire.
  useEffect(()=>{
    if(stage==="review") void refreshFeedback();
  },[stage,refreshFeedback]);
  const canReview=project?.status==="Completed";
  // Une demande existe pour chaque participant dès la clôture. Un avis déjà
  // soumis (masqué ou publié) interdit une nouvelle soumission ; une demande
  // expirée ne peut plus être remplie.
  const reviewRequest=project?feedback.find(item=>item.projectId===project.id):undefined;
  const alreadyReviewed=reviewRequest?.status==="submitted_hidden"||reviewRequest?.status==="published";
  const reviewExpired=reviewRequest?.status==="expired";
  const reviewDone=reviewed||alreadyReviewed;
  const freelancerName=project?.assignedToName?.trim()||"Freelancer";
  const submitReview=async(input:SubmitFeedbackInput)=>{
    if(!project) throw new Error("Project not found.");
    if(!canReview) throw new Error("Only completed projects can be reviewed.");
    if(alreadyReviewed) throw new Error("You have already reviewed this project.");
    try{
      await submitFeedback(project.id,input);
      setReviewed(true);
      notify("Review saved. It stays private until it is published.");
    }catch(err){
      const message=err instanceof ApiError?err.message:"Unable to submit this review.";
      notify(message);
      throw err;
    }
  };
  return <ClientShell page={stage==="workspace"||stage==="review"?"client-contracts":stage==="proposal"?"client-proposals":"client-projects"} go={go} notify={notify}><main className="workspace client-process">
    {stage==="project"&&<><div className="workspace-title"><div><p>PROJECT #{(project?.id??"—").toUpperCase()}</p><h1>{projectTitle}</h1><span>{project?.status??"Open"} · {project?.proposals??0} proposals</span></div><div className="title-actions"><Button variant="secondary" onClick={()=>router.push(`/client/talent?project=${project?.id ?? ""}`)}>Invite freelancers</Button><Button variant="secondary" onClick={()=>editing?stopEdit():startEdit()}>{editing?"Cancel edit":"Edit project"}</Button><Button onClick={()=>router.push(`/client/proposals?project=${project?.id ?? ""}`)}>Review proposals</Button></div></div>{!projectLoading&&!projectError&&project&&<ProjectPipeline project={project} />}{projectLoading&&<p className="task-empty">Loading this project…</p>}{!projectLoading&&projectError&&<p className="task-empty">{projectError}</p>}{!projectLoading&&!projectError&&project?.status==="Client review"&&<section className="dash-card project-approval"><div className="project-approval-head"><span className="project-approval-icon"><Icon name="check" size={18}/></span><div><span className="overline">AWAITING YOUR APPROVAL</span><h2>{project.assignedToName||"Your freelancer"} submitted this project</h2><p>Submitted on {project.updatedAt.slice(0,10)}. Review the project brief, attachments and discussion, then approve the delivery or request changes.</p></div></div>{approvalError&&<p className="form-error" role="alert">{approvalError}</p>}<div className="project-approval-actions"><Button onClick={approveDelivery} disabled={saving} icon="check">{saving?"Saving…":"Approve & complete"}</Button><Button variant="secondary" onClick={()=>setRevisionOpen(!revisionOpen)} disabled={saving}>{revisionOpen?"Cancel revision":"Request changes"}</Button></div>{revisionOpen&&<div className="revision-box project-approval-revision"><FormField label="What needs to change?"><textarea value={revisionNote} onChange={e=>setRevisionNote(e.target.value)} rows={3} placeholder="Describe the corrections the freelancer should make…"/></FormField><Button onClick={requestRevision} disabled={saving||revisionNote.trim().length<5}>{saving?"Sending…":"Send revision request"}</Button></div>}</section>}{!projectLoading&&!projectError&&editing&&<section className="dash-card editor-form" style={{marginBottom:16}}><EditorHeading title="Edit project" text="Update the brief shared with professionals."/><FormField label="Project title"><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></FormField><div className="form-split"><FormField label="Category"><input value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}/></FormField><FormField label="Contract type"><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option>Fixed price</option><option>Hourly</option><option>Milestone-based</option></select></FormField></div><FormField label="Description"><textarea value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></FormField><div className="form-split"><FormField label="Contract type"><select value={draft.type} onChange={e=>setDraft({...draft,type:e.target.value})}><option>Fixed price</option><option>Hourly</option></select></FormField></div><div className="form-split"><FormField label={draft.type === "Hourly" ? "Minimum hourly rate (TND/hour)" : "Minimum budget (TND)"}><input type="number" min="1" value={draft.budgetMin} onChange={e=>setDraft({...draft,budgetMin:e.target.value})}/></FormField><FormField label={draft.type === "Hourly" ? "Maximum hourly rate (TND/hour)" : "Maximum budget (TND)"}><input type="number" min="1" value={draft.budgetMax} onChange={e=>setDraft({...draft,budgetMax:e.target.value})}/></FormField></div><div className="form-split"><FormField label="Expected duration (optional)"><input type="number" min="1" value={draft.durationValue} onChange={e=>setDraft({...draft,durationValue:e.target.value})}/></FormField><FormField label="Duration unit"><select value={draft.durationUnit} onChange={e=>setDraft({...draft,durationUnit:e.target.value})}><option value="Days">Days</option><option value="Weeks">Weeks</option><option value="Months">Months</option></select></FormField></div><div className="form-split"><FormField label="Deadline"><input type="date" value={draft.deadline} onChange={e=>setDraft({...draft,deadline:e.target.value})}/></FormField></div><FormField label="Status"><select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value as ProjectStatus})}>{statusOptions.map(s=><option key={s}>{s}</option>)}</select></FormField><div style={{marginTop:16,marginBottom:16,padding:"12px 14px",border:"1px solid #e5e7eb",borderRadius:8,backgroundColor:"#fff"}}><EditorHeading title="Project attachments" text="Review existing files or add new reference documents."/><div style={{marginBottom:14}}><h4 style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:6}}>Current attachments (preserved)</h4>{project?.attachments&&project.attachments.length>0?<div style={{display:"flex",flexDirection:"column",gap:6}}>{project.attachments.map((att)=><div key={att.url} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:6,backgroundColor:"#f9fafb"}}><div style={{display:"flex",alignItems:"center",gap:8,fontSize:13}}><Icon name="file" size={14}/><a href={att.url} target="_blank" rel="noreferrer" style={{color:"#2563eb",textDecoration:"underline",fontWeight:500}}>{att.fileName}</a><span style={{color:"#6b7280"}}>({Math.round(att.size/1024)} KB)</span></div><span style={{fontSize:11,color:"#059669",backgroundColor:"#ecfdf5",padding:"2px 6px",borderRadius:4}}>Preserved</span></div>)}</div>:<p className="task-empty" style={{margin:"0 0 8px 0"}}>No attachments currently associated with this project.</p>}</div><FormField label="Add new attachments"><input type="file" multiple onChange={(e)=>{if(e.target.files)handleAddNewFiles(e.target.files);e.target.value="";}} style={{display:"none"}} id="edit-file-input"/><div className="media-uploader" style={{cursor:"pointer",border:"2px dashed #ccc",padding:14,textAlign:"center"}} onDragOver={(e)=>{e.preventDefault();e.stopPropagation();}} onDrop={(e)=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.files&&e.dataTransfer.files.length>0){handleAddNewFiles(e.dataTransfer.files);}}} onClick={()=>document.getElementById("edit-file-input")?.click()}><Icon name="file"/><b>Add reference or brief files</b><small>PDF, DOCX, ZIP, PNG, or JPG (max 10 MB each) — click or drag & drop</small></div>{newFiles.length>0&&<div className="upload-file-list">{newFiles.map((f)=>{const kind=attachmentKind(f.name);return <div key={f.id} className="attachment-item upload-file-item"><span className={`attachment-icon ${kind.tone}`} aria-hidden="true"><Icon name={kind.icon} size={16}/></span><span className="attachment-meta"><b title={f.name}>{f.name}</b><small>{kind.label} · {formatFileSize(f.size)}{f.status==="uploading"&&<em className="upload-state is-uploading"> · Uploading…</em>}{f.status==="success"&&<em className="upload-state is-success"> · Uploaded</em>}{f.status==="error"&&<em className="upload-state is-error"> · {f.error||"Failed"}</em>}</small></span><span className="upload-file-actions">{f.status==="error"&&<button type="button" className="attachment-remove is-retry" onClick={()=>retrySingleNewFile(f.id)}>Retry</button>}{f.status!=="uploading"&&<button type="button" className="attachment-remove" onClick={()=>handleRemoveNewFile(f.id)}>Remove</button>}</span></div>;})}</div>}{editUploadError&&<p className="task-empty" style={{color:"#dc2626"}}>{editUploadError}</p>}</FormField></div><div className="wizard-actions"><Button variant="ghost" onClick={stopEdit}>Cancel</Button><Button onClick={saveProject} icon="check" disabled={saving}>{saving?"Saving…":"Save changes"}</Button></div></section>}<div className="client-detail-grid"><section className="dash-card"><EditorHeading title="Project brief" text={`${project?.category??"Category not set"} · ${project?.type??"Fixed price"}`}/><p className="long-copy">{project?.description??"Add a project brief describing what you need done."}</p><h3 className="setting-title">Required outcomes</h3><p className="task-empty">No outcomes listed for this project.</p><h3 className="setting-title">Required skills</h3>{(project?.skills&&project.skills.length>0)?<div className="chips large">{project.skills.map(s=><span key={s}>{s}</span>)}</div>:<p className="task-empty">No skills listed for this project.</p>}<h3 className="setting-title">Attachments</h3><AttachmentList items={project?.attachments ?? []} emptyLabel="No attachments for this project."/></section><aside><article className="dash-card"><h3>Project controls</h3>{project?.status==="In progress"&&project?.assignedTo&&<button className="danger-link" onClick={()=>changeStatus("Open","Acceptance cancelled — the project is open again and your freelancer has been notified.")} disabled={saving}>Cancel acceptance</button>}{statusOptions.includes("Draft")&&project?.status!=="Draft"&&<Button variant="secondary" onClick={()=>changeStatus("Draft","Project paused — it is no longer listed in the catalogue.")} disabled={saving}>Pause project</Button>}{statusOptions.includes("Open")&&project?.status!=="Open"&&<Button variant="secondary" onClick={()=>changeStatus("Open",project?.status==="Completed"?"Project reopened — it is now listed in the catalogue.":"Project published — it is now listed in the catalogue.")} disabled={saving}>{project?.status==="Completed"?"Reopen project":"Publish project"}</Button>}{statusOptions.includes("Completed")&&project?.status!=="Completed"&&<button className="danger-link" onClick={()=>changeStatus("Completed","Project closed.")} disabled={saving}>Close project</button>}{project?.status==="Completed"&&<p className="task-empty">This project is closed.</p>}</article>{project?.assignmentHistory&&project.assignmentHistory.length>0&&<article className="dash-card"><h3>Assignment history</h3>{project.assignmentHistory.map((entry,i)=><p className="task-empty" key={`${entry.freelancerId}-${i}`}>{entry.freelancerName||entry.freelancerId} — {entry.reason==="project-reopened"?"project reopened":entry.reason==="acceptance-cancelled"?"acceptance cancelled":"assignment removed"}</p>)}</article>}<article className="dash-card"><h3>Approve a freelancer</h3>{assigneesLoading&&<p className="task-empty">Loading freelancers…</p>}{!assigneesLoading&&assigneesError&&<p className="task-empty">{assigneesError}</p>}{!assigneesLoading&&!assigneesError&&<><FormField label="Freelancer"><select value={selectedAssignee} onChange={e=>setAssigneeId(e.target.value)}><option value="">Select a freelancer…</option>{assignees.map(a=><option key={a.id} value={a.id}>{a.name}{a.title?` — ${a.title}`:""}</option>)}</select></FormField><Button onClick={approveFreelancer} icon="check" disabled={approving||!selectedAssignee}>{approving?"Saving…":project?.assignedTo?"Update approval":"Approve freelancer"}</Button>{project?.assignedTo&&<><p className="task-empty">Approved: {project.assignedToName}</p><button className="danger-link" onClick={revokeApproval} disabled={approving}>Remove approval</button></>}</>}</article></aside></div><div style={{marginTop:16}}>{project && <ProjectDiscussion project={project} notify={notify} />}</div></>}
    {stage==="proposal"&&<><div className="workspace-title"><div><p>PROPOSAL REVIEW</p><h1>Freelancer</h1><span>For {projectTitle}</span></div><div className="title-actions"><Button variant="secondary" onClick={()=>setShortlisted(!shortlisted)}>{shortlisted?"Shortlisted":"Add to shortlist"}</Button><Button onClick={()=>setStage("contract")}>Hire freelancer</Button></div></div><div className="proposal-detail-layout"><section className="dash-card"><div className="proposal-person"><span className="company-avatar">?</span><div><h2>Freelancer</h2><p>No proposal has been received for this project yet.</p></div><strong>—<small>Fixed price</small></strong></div><div className="detail-section"><h3>Cover letter</h3><p className="long-copy">No cover letter has been submitted.</p></div><div className="detail-section"><h3>Proposed approach</h3><p className="task-empty">No approach has been submitted.</p></div><div className="detail-section"><h3>Relevant work</h3><p className="task-empty">No portfolio items are linked to this proposal.</p></div></section><aside><article className="dash-card proposal-summary-card"><h3>Proposal summary</h3>{[["Price","—"],["Delivery","—"],["Revisions","—"],["Availability","—"]].map(x=><div key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>)}<Button onClick={()=>setStage("contract")}>Accept & create contract</Button><Button variant="secondary" onClick={()=>go("messages")}>Message freelancer</Button><button className="danger-link" onClick={()=>notify("Rejecting proposals requires the backend")}>Reject proposal</button></article></aside></div></>}
    {stage==="contract"&&<><div className="workspace-title"><div><p>CREATE CONTRACT</p><h1>Finalize terms with the freelancer</h1><span>Review the scope, milestones, and payment details before sending.</span></div></div><div className="contract-builder"><section className="dash-card editor-form"><EditorHeading title="Contract terms" text="These terms become active after the freelancer accepts."/><FormField label="Contract title"><input placeholder="Contract title"/></FormField><FormField label="Scope of work"><textarea placeholder="Describe the scope of work."/></FormField><div className="form-split"><FormField label="Start date"><input type="date"/></FormField><FormField label="Final deadline"><input type="date"/></FormField></div><h3 className="setting-title">Milestones</h3>{milestones.map((milestone,i)=><div className="contract-milestone" key={i}><span>{i+1}</span><input value={milestone.name} onChange={e=>setMilestones(milestones.map((m,j)=>j===i?{...m,name:e.target.value}:m))}/><div className="money-input"><span>TND</span><input value={milestone.amount} onChange={e=>setMilestones(milestones.map((m,j)=>j===i?{...m,amount:e.target.value}:m))}/></div><input value={milestone.date} onChange={e=>setMilestones(milestones.map((m,j)=>j===i?{...m,date:e.target.value}:m))}/></div>)}<Button variant="secondary" onClick={()=>notify("Adding milestones requires the backend")}>Add milestone</Button></section><aside className="dash-card contract-summary"><h3>Contract summary</h3><div><span>Project total</span><b>{milestones.length?`${formatAmount(contractTotal)} TND`:"—"}</b></div><div><span>Marketplace fee</span><b>—</b></div><div><span>Estimated tax</span><b>—</b></div><div className="total"><span>Due to fund contract</span><b>—</b></div><FormField label="Payment method"><select><option>No payment method on file</option></select></FormField><label className="terms-check"><input type="checkbox" defaultChecked/> I agree to the project terms and payment authorization.</label><Button onClick={()=>setStage("workspace")}>Fund & send contract</Button><p><Icon name="shield"/> No payment is processed.</p></aside></div></>}
    {stage==="workspace"&&<><div className="workspace-title"><div><p>CONTRACT</p><h1>{projectTitle}</h1><span>In progress</span></div><Button variant="secondary" onClick={()=>go("messages")}>Message freelancer</Button></div><div className="workspace-status"><span><Icon name="clock"/> Contract funded</span><i/><span><Icon name="clock"/> Work in progress</span><i/><span><Icon name="clock"/> Client review</span><i/><span><Icon name="star"/> Complete</span></div><div className="client-detail-grid"><section className="dash-card"><div className="card-heading"><h3>Milestones & deliveries</h3></div>{milestones.length===0&&<p className="task-empty">No milestones yet.</p>}<div className="delivery-actions"><Button variant="secondary" onClick={()=>setRevision(true)}>Request revision</Button><Button onClick={()=>notify("Approving a milestone and releasing the payment requires the backend")}>Approve & release milestone</Button></div>{revision&&<div className="revision-box"><FormField label="Revision notes"><textarea placeholder="Explain clearly what needs to change…"/></FormField><Button onClick={()=>{setRevision(false);notify("Sending a revision request requires the backend")}}>Send revision request</Button></div>}</section><aside><article className="dash-card"><h3>Project team</h3><div className="project-member"><span className="company-avatar">?</span><span><b>Freelancer</b><small>Not assigned yet</small></span></div><div className="project-member"><span className="company-avatar">{user.name?user.name.charAt(0).toUpperCase():"Y"}</span><span><b>{user.name||"You"}</b><small>Client owner</small></span></div></article><article className="dash-card"><h3>Financial summary</h3>{[["Contract total",milestones.length?`${formatAmount(contractTotal)} TND`:"—"],["Released","—"],["Remaining","—"]].map(x=><div className="contract-fact" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b></div>)}<button className="report-link" onClick={()=>go("payments")}>View transactions <Icon name="chevron"/></button></article></aside></div></>}
    {stage==="review"&&projectLoading&&<p className="task-empty">Loading this project…</p>}
    {stage==="review"&&!projectLoading&&(projectError||!project)&&<div className="review-submit dash-card"><span className="overline">REVIEW UNAVAILABLE</span><h1>Project not available</h1><p>{projectError||"This project could not be loaded."}</p><Button variant="secondary" onClick={()=>go("client")}>Back to dashboard</Button></div>}
    {stage==="review"&&!projectLoading&&project&&!canReview&&<div className="review-submit dash-card"><span className="overline">REVIEW UNAVAILABLE</span><h1>This project is not complete yet</h1><p>Reviews can only be published after the project status is set to Completed.</p><Button variant="secondary" onClick={()=>go("client")}>Back to dashboard</Button></div>}
    {stage==="review"&&!projectLoading&&project&&canReview&&reviewExpired&&!reviewDone&&<div className="review-submit dash-card"><span className="overline">REVIEW CLOSED</span><h1>The review window has closed</h1><p>Reviews can only be submitted within 14 days of the project being completed. No review is created automatically.</p><Button variant="secondary" onClick={()=>go("client")}>Back to dashboard</Button></div>}
    {stage==="review"&&!projectLoading&&project&&canReview&&!reviewDone&&!reviewExpired&&<div className="review-submit dash-card"><span className="overline">PROJECT COMPLETE</span><h1>How was working with {freelancerName}?</h1><p>Rate the five criteria below. Your review stays private until {freelancerName} submits theirs, or 14 days after the project was completed — whichever comes first.</p><span className="company-avatar">{freelancerName.charAt(0).toUpperCase()}</span><h3>{freelancerName}</h3><FeedbackForm role="client" submitLabel="Submit verified review" onSubmit={submitReview}/></div>}
    {stage==="review"&&!projectLoading&&project&&canReview&&reviewDone&&<div className="editor-success"><span><Icon name="check" size={32}/></span><h1>Review saved.</h1><p>Your review for {projectTitle} is recorded. It becomes visible on {freelancerName}'s profile once both reviews are published, and it can no longer be edited.</p><div><Button onClick={()=>go("client")}>Back to dashboard</Button><Button variant="secondary" onClick={()=>go("client-feedback")}>View feedback</Button></div></div>}
  </main></ClientShell>;
}

export { ClientProcess };
