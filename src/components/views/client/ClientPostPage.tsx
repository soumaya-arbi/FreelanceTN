"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { FormField, EditorHeading } from "@/components/ui/Form";
import { ClientShell } from "@/components/layout/ClientShell";
import { AttachmentList, attachmentKind, formatFileSize } from "@/components/shared/AttachmentList";
import { ProjectDraftAssistant } from "@/components/shared/AiAssistantPanel";
import { categories } from "@/lib/data";
import type { Page, Project, ProjectAttachment, ProjectStatus } from "@/lib/types";
import { projectsApi } from "@/lib/api";

// Brief transmis au backend lors de la publication du projet.
export type ClientProjectDraft = {
  title: string;
  description: string;
  budget: string;
  type: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  durationValue?: number | null;
  durationUnit?: string | null;
  skills: string[];
  category: string;
  deadline: string;
  status: ProjectStatus;
};

export type ProjectUploadItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  status: "idle" | "uploading" | "success" | "error";
  error?: string;
  attachment?: ProjectAttachment;
};

function ClientPostPage({ go, notify, onPublish }: { go:(p:Page)=>void; notify:(x:string)=>void; onPublish:(project:ClientProjectDraft)=>Promise<Project|null> }) {
  const router = useRouter();
  const [step,setStep]=useState(1);
  const [title,setTitle]=useState("");
  const [description,setDescription]=useState("");
  const [category,setCategory]=useState(categories[0][0]);
  const [contractType,setContractType]=useState("Fixed price");
  const [budgetMin,setBudgetMin]=useState("");
  const [budgetMax,setBudgetMax]=useState("");
  const [durationValue,setDurationValue]=useState("");
  const [durationUnit,setDurationUnit]=useState("Weeks");
  const [deadline,setDeadline]=useState("");
  const [created,setCreated]=useState<{project:Project;status:ProjectStatus}|null>(null);
  const [publishing,setPublishing]=useState(false);
  const [formError,setFormError]=useState("");
  const [skills,setSkills]=useState<string[]>([]);
  const [level,setLevel]=useState("Experienced");
  const [files,setFiles]=useState<ProjectUploadItem[]>([]);
  const [uploadError,setUploadError]=useState("");

  const addFiles = (fileList: FileList | File[]) => {
    const incoming: ProjectUploadItem[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      name: f.name,
      size: f.size,
      status: "idle",
    }));
    setFiles((prev) => [...prev, ...incoming]);
    setUploadError("");
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const uploadFilesSequentially = async (
    targetProject: Project,
    itemsToProcess: ProjectUploadItem[],
  ): Promise<{ allSucceeded: boolean }> => {
    let hasErrors = false;
    let currentItems = [...itemsToProcess];

    const existingAttachments = targetProject.attachments ?? [];
    const knownUrls = new Set(existingAttachments.map((a) => a.url.toLowerCase()));
    const newSuccessAttachments: ProjectAttachment[] = [];

    for (let i = 0; i < currentItems.length; i++) {
      const item = currentItems[i];
      // Ne jamais re-uploader un fichier déjà uploadé avec succès
      if (item.status === "success") {
        if (item.attachment && !knownUrls.has(item.attachment.url.toLowerCase())) {
          knownUrls.add(item.attachment.url.toLowerCase());
          newSuccessAttachments.push(item.attachment);
        }
        continue;
      }

      currentItems = currentItems.map((it, idx) =>
        idx === i ? { ...it, status: "uploading", error: undefined } : it,
      );
      setFiles(currentItems);

      try {
        const res = await projectsApi.uploadAttachment(targetProject.id, item.file);
        const att: ProjectAttachment = {
          fileName: res.fileName,
          url: res.url,
          size: res.size,
          uploadedAt: new Date().toISOString(),
        };
        if (!knownUrls.has(att.url.toLowerCase())) {
          knownUrls.add(att.url.toLowerCase());
          newSuccessAttachments.push(att);
        }
        currentItems = currentItems.map((it, idx) =>
          idx === i ? { ...it, status: "success", attachment: att, error: undefined } : it,
        );
        setFiles(currentItems);
      } catch (e) {
        hasErrors = true;
        const msg = e instanceof Error ? e.message : "Upload failed";
        currentItems = currentItems.map((it, idx) =>
          idx === i ? { ...it, status: "error", error: msg } : it,
        );
        setFiles(currentItems);
      }
    }

    // Déduplication absolue des métadonnées
    const combined = [...existingAttachments, ...newSuccessAttachments];
    const deduped: ProjectAttachment[] = [];
    const dedupSet = new Set<string>();
    for (const a of combined) {
      const key = a.url.toLowerCase();
      if (!dedupSet.has(key)) {
        dedupSet.add(key);
        deduped.push(a);
      }
    }

    try {
      const updated = await projectsApi.update(targetProject.id, { attachments: deduped });
      setCreated({ project: updated, status: "Open" });
    } catch {
      setCreated({ project: { ...targetProject, attachments: deduped }, status: "Open" });
    }

    return { allSucceeded: !hasErrors };
  };

  // Un projet est publié dès sa création : il est alors visible par tous les
  // freelances dans le catalogue des opportunités.
  const publish = async () => {
    if (!title.trim() || !description.trim()) {
      setFormError("Add a project title and a description before publishing.");
      return;
    }
    setPublishing(true);
    setFormError("");
    setUploadError("");
    try {
      let currentProject = created?.project;
      // Permettre de reprendre l'upload sans recréer le projet
      if (!currentProject) {
        const proj = await onPublish({
          title: title.trim(),
          description: description.trim(),
          budget: budgetMin && budgetMax ? `${budgetMin}–${budgetMax} TND` : "",
          type: contractType,
          budgetMin: budgetMin ? Number(budgetMin) : null,
          budgetMax: budgetMax ? Number(budgetMax) : null,
          durationValue: durationValue ? Number(durationValue) : null,
          durationUnit: durationValue ? durationUnit : null,
          skills,
          category,
          deadline,
          status: "Open",
        });
        if (!proj) {
          throw new Error("Impossible d'enregistrer le projet.");
        }
        currentProject = proj;
        setCreated({ project: proj, status: "Open" });
      }

      if (files.length > 0) {
        const { allSucceeded } = await uploadFilesSequentially(currentProject, files);
        if (!allSucceeded) {
          setUploadError("Certains fichiers n'ont pas pu être envoyés. Vous pouvez réessayer uniquement les fichiers échoués.");
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Impossible d'enregistrer le projet.");
    } finally {
      setPublishing(false);
    }
  };

  const retryUpload = async () => {
    if (!created?.project || files.length === 0) return;
    setPublishing(true);
    setUploadError("");
    try {
      // Réessaie uniquement les fichiers non réussis
      const { allSucceeded } = await uploadFilesSequentially(created.project, files);
      if (!allSucceeded) {
        setUploadError("Certains fichiers n'ont pas pu être envoyés. Vous pouvez réessayer uniquement les fichiers échoués.");
      } else {
        setUploadError("");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPublishing(false);
    }
  };

  const retrySingleFile = async (fileId: string) => {
    if (!created?.project) return;
    setPublishing(true);
    setUploadError("");
    try {
      const fileIndex = files.findIndex((f) => f.id === fileId);
      if (fileIndex === -1) return;
      const targetFile = files[fileIndex];

      const nextFiles = files.map((f, i) =>
        i === fileIndex ? { ...f, status: "uploading" as const, error: undefined } : f,
      );
      setFiles(nextFiles);

      const res = await projectsApi.uploadAttachment(created.project.id, targetFile.file);
      const att: ProjectAttachment = {
        fileName: res.fileName,
        url: res.url,
        size: res.size,
        uploadedAt: new Date().toISOString(),
      };

      const finalFiles = nextFiles.map((f, i) =>
        i === fileIndex ? { ...f, status: "success" as const, attachment: att, error: undefined } : f,
      );
      setFiles(finalFiles);

      const existingAttachments = created.project.attachments ?? [];
      const combined = [...existingAttachments, att];
      const deduped: ProjectAttachment[] = [];
      const dedupSet = new Set<string>();
      for (const a of combined) {
        const key = a.url.toLowerCase();
        if (!dedupSet.has(key)) {
          dedupSet.add(key);
          deduped.push(a);
        }
      }

      const updated = await projectsApi.update(created.project.id, { attachments: deduped });
      setCreated({ project: updated, status: "Open" });

      const hasRemainingErrors = finalFiles.some((f) => f.status === "error");
      if (!hasRemainingErrors) {
        setUploadError("");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: "error", error: msg } : f)),
      );
      setUploadError("Échec de l'upload du fichier.");
    } finally {
      setPublishing(false);
    }
  };

  const continueOrPublish = async () => {
    if (step < 4) {
      setStep(step + 1);
      return;
    }
    await publish();
  };

  const resetForm = () => {
    setCreated(null);
    setStep(1);
    setTitle("");
    setDescription("");
    setFormError("");
    setUploadError("");
    setFiles([]);
  };

  const succeededCount = files.filter((f) => f.status === "success").length;
  const failedCount = files.filter((f) => f.status === "error").length;

  if (created) {
    const uploadedAttachments = created.project.attachments ?? [];
    const failedFiles = files.filter((f) => f.status === "error");
    return (
      <ClientShell page="client-post" go={go} notify={notify}>
        <main className="workspace">
          <section className="post-published" aria-labelledby="published-title">
            <header className="post-published-hero">
              <span className="post-published-icon"><Icon name="check" size={28}/></span>
              <p className="post-published-eyebrow">Published to the marketplace</p>
              <h1 id="published-title">Your project is live</h1>
              <p className="post-published-lead">
                Your brief is now visible to every freelancer on FreelanceTN. Proposals will appear on your project page as soon as professionals respond.
              </p>
            </header>

            <article className="published-project-card">
              <div className="success-project-head">
                <small>PROJECT</small>
                <span className="success-status"><i aria-hidden="true"/>{created.project.status || "Open"}</span>
              </div>
              <h2>{created.project.title}</h2>
              {created.project.description && <p>{created.project.description}</p>}
              <div className="success-project-meta">
                {created.project.category && <span><Icon name="briefcase" size={13}/>{created.project.category}</span>}
                {created.project.budget && <span><Icon name="wallet" size={13}/>{created.project.budget}</span>}
                {created.project.type && <span><Icon name="file" size={13}/>{created.project.type}</span>}
              </div>
            </article>

            <section className="published-attachments" aria-labelledby="published-attachments-title">
              <div className="success-block-head">
                <h2 id="published-attachments-title">Attachments</h2>
                {files.length > 0 && <small>{succeededCount}/{files.length} uploaded</small>}
              </div>
              {uploadedAttachments.length > 0 ? (
                <AttachmentList items={uploadedAttachments} compact />
              ) : (
                <p className="task-empty">No attachment was added to this project.</p>
              )}
              {failedFiles.length > 0 && (
                <div className="success-upload-errors">
                  <p>{uploadError || "Some files could not be uploaded. Retry only the failed files below."}</p>
                  <ul>
                    {failedFiles.map((f) => (
                      <li key={f.id}>
                        <span title={f.name}>{f.name}</span>
                        <button type="button" onClick={() => retrySingleFile(f.id)} disabled={publishing}>Retry</button>
                      </li>
                    ))}
                  </ul>
                  <Button onClick={retryUpload} disabled={publishing}>
                    {publishing ? "Retrying failed uploads…" : `Retry all failed uploads (${failedCount})`}
                  </Button>
                </div>
              )}
            </section>

            <nav className="published-actions" aria-label="Project actions">
              <Button onClick={() => router.push(`/projects/${created.project.id}`)}>View project</Button>
              <Button variant="secondary" onClick={resetForm}>Post another project</Button>
            </nav>
          </section>
        </main>
      </ClientShell>
    );
  }

  return (
    <ClientShell page="client-post" go={go} notify={notify}>
      <main className="workspace client-post-page">
        <div className="workspace-title">
          <div>
            <p>NEW OPPORTUNITY</p>
            <h1>Post a project</h1>
            <span>Tell the right professionals what you need and what success looks like.</span>
          </div>
        </div>
        <div className="post-layout">
          <aside className="post-steps">
            {[["1","Project brief"],["2","Skills & scope"],["3","Budget & timeline"],["4","Review & publish"]].map((x,i) => (
              <button className={step===i+1?"active":step>i+1?"complete":""} onClick={()=>setStep(i+1)} key={x[0]}>
                <span>{step>i+1?<Icon name="check" size={13}/>:x[0]}</span>
                <b>{x[1]}</b>
              </button>
            ))}
          </aside>
          <section className="dash-card editor-form">
            {step===1 && (
              <>
                <EditorHeading title="What are you building?" text="A clear brief helps professionals decide whether they’re the right fit."/>
                <ProjectDraftAssistant category={category} onAccept={(suggestion) => {
                  setTitle(suggestion.title);
                  const extra = [
                    suggestion.objectives.length ? `Objectifs :\n${suggestion.objectives.map((item) => `• ${item}`).join("\n")}` : "",
                    suggestion.technologies.length ? `Technologies : ${suggestion.technologies.join(", ")}` : "",
                    suggestion.deliverables.length ? `Livrables :\n${suggestion.deliverables.map((item) => `• ${item}`).join("\n")}` : "",
                  ].filter(Boolean).join("\n\n");
                  setDescription([suggestion.description, extra].filter(Boolean).join("\n\n"));
                  setSkills(suggestion.skills);
                  if (suggestion.category && categories.some(([name]) => name === suggestion.category)) setCategory(suggestion.category);
                  if (suggestion.contractType) setContractType(suggestion.contractType);
                  if (suggestion.budgetMin !== null) setBudgetMin(String(suggestion.budgetMin));
                  if (suggestion.budgetMax !== null) setBudgetMax(String(suggestion.budgetMax));
                  if (suggestion.durationValue !== null) setDurationValue(String(suggestion.durationValue));
                  if (suggestion.durationUnit) setDurationUnit(suggestion.durationUnit);
                  notify("Brouillon ajouté au formulaire. Relisez et modifiez-le avant publication.");
                }} />
                <FormField label="Project title">
                  <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Redesign our mobile banking experience"/>
                </FormField>
                <FormField label="Category">
                  <select value={category} onChange={e=>setCategory(e.target.value)}>
                    {categories.map((c)=><option key={c[0]}>{c[0]}</option>)}
                  </select>
                </FormField>
                <FormField label="Project description">
                  <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe the problem, desired outcome, users, and any important context…"/>
                </FormField>
                <FormField label="Attachments">
                  <input type="file" multiple onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} style={{display:"none"}} id="file-input" />
                  <div className="media-uploader" style={{cursor:"pointer",border:"2px dashed #ccc",padding:16,textAlign:"center"}} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { addFiles(e.dataTransfer.files); } }} onClick={() => document.getElementById("file-input")?.click()}>
                    <Icon name="file"/><b>Attach a brief or reference files</b><small>PDF, DOCX, ZIP, PNG, or JPG (max 10 MB each) — click or drag & drop</small>
                  </div>
                  {files.length > 0 && (
                    <div className="upload-file-list">
                      {files.map((f) => {
                        const kind = attachmentKind(f.name);
                        return (
                          <div key={f.id} className="attachment-item upload-file-item">
                            <span className={`attachment-icon ${kind.tone}`} aria-hidden="true"><Icon name={kind.icon} size={16}/></span>
                            <span className="attachment-meta">
                              <b title={f.name}>{f.name}</b>
                              <small>
                                {kind.label} · {formatFileSize(f.size)}
                                {f.status === "uploading" && <em className="upload-state is-uploading"> · Uploading…</em>}
                                {f.status === "success" && <em className="upload-state is-success"> · Uploaded</em>}
                                {f.status === "error" && <em className="upload-state is-error"> · {f.error || "Failed"}</em>}
                              </small>
                            </span>
                            {f.status !== "uploading" && (
                              <button type="button" className="attachment-remove" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                                Remove
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {uploadError && <p className="task-empty" style={{color:"#dc2626"}}>{uploadError}</p>}
                </FormField>
              </>
            )}
            {step===2 && (
              <>
                <EditorHeading title="Skills and project scope" text="Help FreelanceTN match your opportunity with relevant professionals."/>
                <FormField label="Required skills">
                  <div className="skill-editor compact">
                    {skills.map(x=><div key={x}><b>{x}</b><button onClick={()=>setSkills(skills.filter(s=>s!==x))}><Icon name="close"/></button></div>)}
                  </div>
                  <div className="add-skill">
                    <input placeholder="Add another skill" onKeyDown={e=>{if(e.key==="Enter"&&e.currentTarget.value){e.preventDefault();setSkills([...skills,e.currentTarget.value]);e.currentTarget.value=""}}}/>
                  </div>
                </FormField>
                <FormField label="Experience level">
                  <div className="choice-row">
                    {[["Emerging","Growing portfolio"],["Experienced","Strong track record"],["Expert","Specialist expertise"]].map(x=><button className={level===x[0]?"active":""} onClick={()=>setLevel(x[0])} key={x[0]}><b>{x[0]}</b><small>{x[1]}</small></button>)}
                  </div>
                </FormField>
              </>
            )}
            {step===3 && (
              <>
                <EditorHeading title="Budget and timeline" text="Set realistic expectations. You can finalize terms with your chosen professional."/>
                <div className="form-split">
                  <FormField label="Contract type">
                    <select value={contractType} onChange={e=>setContractType(e.target.value)}>
                      <option>Fixed price</option>
                      <option>Hourly</option>
                    </select>
                  </FormField>
                </div>
                <div className="form-split">
                  <FormField label={contractType === "Hourly" ? "Minimum hourly rate (TND/hour)" : "Minimum budget (TND)"}>
                    <input type="number" min="1" value={budgetMin} onChange={e=>setBudgetMin(e.target.value)} placeholder="e.g. 1000"/>
                  </FormField>
                  <FormField label={contractType === "Hourly" ? "Maximum hourly rate (TND/hour)" : "Maximum budget (TND)"}>
                    <input type="number" min="1" value={budgetMax} onChange={e=>setBudgetMax(e.target.value)} placeholder="e.g. 5000"/>
                  </FormField>
                </div>
                <div className="form-split">
                  <FormField label="Expected duration (optional)">
                    <input type="number" min="1" value={durationValue} onChange={e=>setDurationValue(e.target.value)} placeholder="e.g. 3"/>
                  </FormField>
                  <FormField label="Duration unit">
                    <select value={durationUnit} onChange={e=>setDurationUnit(e.target.value)}>
                      <option value="Days">Days</option>
                      <option value="Weeks">Weeks</option>
                      <option value="Months">Months</option>
                    </select>
                  </FormField>
                </div>
                <FormField label="Proposal deadline">
                  <input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}/>
                </FormField>
              </>
            )}
            {step===4 && (
              <>
                <EditorHeading title="Review your project" text="Check the details before publishing to the marketplace."/>
                <div className="post-review">
                  <span className="status">READY TO PUBLISH</span>
                  <h2>{title||"Untitled client project"}</h2>
                  <p>{category} · {contractType} · {budgetMin && budgetMax ? `${budgetMin}–${budgetMax} TND` : "Budget not set"} · {durationValue ? `${durationValue} ${durationUnit}` : "Duration not set"}</p>
                  <div className="chips">{skills.map(x=><span key={x}>{x}</span>)}</div>
                  {files.length > 0 && (
                    <div style={{marginTop:8,marginBottom:8}}>
                      <small style={{color:"#6b7280"}}>{files.length} attachment{files.length > 1 ? "s" : ""} selected ({files.map(f => f.name).join(", ")})</small>
                    </div>
                  )}
                  <div>
                    <Icon name="globe"/>
                    <span><b>Public marketplace</b><small>Published right away: every freelancer can discover the project and apply.</small></span>
                  </div>
                </div>
                <div className="demo-disclosure">
                  <Icon name="shield"/>
                  <span><b>No charge to publish</b><small>You only add a payment method when creating a contract.</small></span>
                </div>
              </>
            )}
            {formError && <p className="task-empty">{formError}</p>}
            <div className="wizard-actions">
              <Button variant="ghost" onClick={()=>step===1?go("client"):setStep(step-1)}>{step===1?"Cancel":"Back"}</Button>
              <Button onClick={continueOrPublish} icon={step===4?"check":"arrow"} disabled={publishing}>
                {publishing ? (files.length > 0 ? "Publishing & uploading…" : "Publishing…") : step===4 ? "Publish project" : "Continue"}
              </Button>
            </div>
          </section>
        </div>
      </main>
    </ClientShell>
  );
}

export { ClientPostPage };
