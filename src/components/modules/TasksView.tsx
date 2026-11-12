"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { AppShell } from "@/components/layout/AppShell";
import { ClientShell } from "@/components/layout/ClientShell";
import { useApp } from "@/context/AppContext";
import { useMarketplace } from "@/context/MarketplaceContext";
import { useUser } from "@/context/UserContext";
import { tasksApi } from "@/lib/api";
import type { Role, Task, TaskComment, TaskPriority, TaskStatus } from "@/lib/types";

const statusMeta: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: "To do", className: "todo" },
  "in-progress": { label: "In progress", className: "progress" },
  "in-review": { label: "In review", className: "review" },
  done: { label: "Done", className: "done" },
};

const priorityLabel: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High" };

const emptyDraft = {
  title: "",
  description: "",
  projectId: "",
  assigneeChoice: "me" as "me" | "client",
  priority: "medium" as TaskPriority,
  storyPoints: 0,
  startDate: "",
  dueDate: "",
};

export function TasksView({ role }: { role: Role }) {
  const { go, notify } = useApp();
  const { authUser } = useUser();
  const { tasks, projects, assignedProjects, addTask, updateTask, deleteTask } = useMarketplace();
  const projectOptions = role === "freelancer" ? assignedProjects : projects;
  const meName = `${authUser?.firstName ?? ""} ${authUser?.lastName ?? ""}`.trim() || authUser?.email || "Me";

  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [changesRequested, setChangesRequested] = useState("");
  const [changesModalOpen, setChangesModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<any>(null);

  const projectName = useCallback(
    (id: string) => projectOptions.find((project) => project.id === id)?.title ?? "Unassigned project",
    [projectOptions],
  );

  const selectedTask = useMemo(() => tasks.find((t) => t.id === selectedId) ?? null, [tasks, selectedId]);
  const selectedProject = useMemo(
    () => projectOptions.find((p) => p.id === selectedTask?.projectId) ?? projects.find((p) => p.id === selectedTask?.projectId),
    [projectOptions, projects, selectedTask],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter) return false;
      if (!term) return true;
      return (
        task.title.toLowerCase().includes(term) ||
        task.description.toLowerCase().includes(term) ||
        task.assignee.toLowerCase().includes(term) ||
        projectName(task.projectId).toLowerCase().includes(term)
      );
    });
  }, [tasks, search, projectFilter, priorityFilter, projectName]);

  const counts = {
    total: tasks.length,
    open: tasks.filter((task) => task.status !== "done").length,
    review: tasks.filter((task) => task.status === "in-review").length,
    done: tasks.filter((task) => task.status === "done").length,
  };

  const isOverdue = (task: Task) => task.status !== "done" && !!task.dueDate && new Date(task.dueDate) < new Date(new Date().toDateString());

  const formatDate = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} à ${hh}:${min}`;
};

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.projectId) {
      notify("Add a task title and choose a project");
      return;
    }
    const project = projectOptions.find((p) => p.id === draft.projectId);
    let assigneeUserId = "";
    let assigneeName = "";
    let assigneeRole = "";
    if (draft.assigneeChoice === "me") {
      assigneeUserId = authUser?.id ?? "";
      assigneeName = meName;
      assigneeRole = role === "client" ? "client" : "freelancer";
    } else {
      if (role === "client") {
        assigneeUserId = project?.assignedTo ?? "";
        assigneeName = project?.assignedToName ?? "Freelancer";
        assigneeRole = "freelancer";
      } else {
        assigneeUserId = project?.ownerId ?? "";
        assigneeName = project?.client ?? "Client";
        assigneeRole = "client";
      }
    }
    try {
      await addTask({
        title: draft.title.trim(),
        description: draft.description.trim(),
        projectId: draft.projectId,
        assignee: assigneeName,
        assigneeUserId,
        assigneeRole,
        status: "todo",
        priority: draft.priority,
        storyPoints: draft.storyPoints,
        startDate: draft.startDate || new Date().toISOString().slice(0, 10),
        dueDate: draft.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      });
      setDraft(emptyDraft);
      setCreating(false);
      notify("Task created");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Impossible de créer la tâche");
    }
  };

  const performMove = async (task: Task, status: TaskStatus, comment?: string) => {
    try {
      await updateTask(task.id, { status, comment });
      notify(status === "done" ? "Task approved" : `Task moved to ${statusMeta[status].label.toLowerCase()}`);
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Action impossible");
      return false;
    }
  };

  const moveTask = async (task: Task, status: TaskStatus, comment?: string) => {
    await performMove(task, status, comment);
  };

  const loadComments = useCallback(async (taskId: string) => {
    try {
      const rows = await tasksApi.comments(taskId);
      setComments(rows);
    } catch {
      setComments([]);
    }
  }, []);

  useEffect(() => {
    if (selectedTask) {
      loadComments(selectedTask.id);
      setEditing(false);
      setEditDraft({
        title: selectedTask.title,
        description: selectedTask.description,
        projectId: selectedTask.projectId,
        assigneeChoice: selectedTask.assigneeRole === "client" ? "client" : "me",
        priority: selectedTask.priority,
        storyPoints: selectedTask.storyPoints ?? 0,
        startDate: selectedTask.startDate?.slice(0, 10) ?? "",
        dueDate: selectedTask.dueDate?.slice(0, 10) ?? "",
      });
    } else {
      setComments([]);
      setEditDraft(null);
    }
  }, [selectedTask, loadComments]);

  const sendComment = async () => {
    if (!selectedTask || !commentText.trim()) return;
    try {
      const c = await tasksApi.addComment(selectedTask.id, commentText.trim());
      setComments((prev) => [...prev, c]);
      setCommentText("");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Impossible d'envoyer le commentaire");
    }
  };

  const requestChanges = async () => {
    if (!selectedTask) return;
    if (!changesRequested.trim()) {
      notify("Expliquez les corrections attendues");
      return;
    }
    const ok = await performMove(selectedTask, "in-progress", changesRequested.trim());
    if (ok) {
      setChangesRequested("");
      setChangesModalOpen(false);
      await loadComments(selectedTask.id);
    }
  };

  const content = (
    <main className="workspace module-page">
      <div className="workspace-title">
        <div>
          <p>{role === "client" ? "CLIENT WORKSPACE" : "FREELANCER WORKSPACE"}</p>
          <h1>Tasks</h1>
          <span>Plan the work, assign ownership, and keep every project moving.</span>
        </div>
        <Button icon="check" onClick={() => setCreating((value) => !value)}>
          {creating ? "Close form" : "Add task"}
        </Button>
      </div>

      <div className="module-summary">
        <article><span><Icon name="file" /></span><b>{counts.total}</b><small>Total tasks</small></article>
        <article><span><Icon name="clock" /></span><b>{counts.open}</b><small>Open items</small></article>
        <article><span><Icon name="bell" /></span><b>{counts.review}</b><small>In review</small></article>
        <article><span><Icon name="check" /></span><b>{counts.done}</b><small>Completed</small></article>
      </div>

      {creating && (
        <form className="dash-card task-form" onSubmit={submit}>
          <div className="editor-heading"><h2>New task</h2><p>Break the project into a clear, assignable next step.</p></div>
          <div className="task-form-grid">
            <label className="editor-field">
              Task title
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Finalize dashboard wireframes" />
            </label>
            <label className="editor-field">
              Project
              <select value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
                <option value="">Select a project</option>
                {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>
            <label className="editor-field">
              Assignee
              <select
                value={draft.assigneeChoice}
                onChange={(event) => setDraft({ ...draft, assigneeChoice: event.target.value as "me" | "client" })}
                disabled={!draft.projectId}
              >
                <option value="me">{role === "client" ? `Me (${meName})` : `Me (${meName})`}</option>
                <option value="client" disabled={!draft.projectId}>
                  {draft.projectId
                    ? (role === "client"
                        ? `Freelancer (${projectOptions.find((p) => p.id === draft.projectId)?.assignedToName ?? "Freelancer"})`
                        : `Client (${projectOptions.find((p) => p.id === draft.projectId)?.client ?? "Client"})`)
                    : "Select a project first"}
                </option>
              </select>
            </label>
            <label className="editor-field">
              Priority
              <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="editor-field">
              Story points
              <select value={draft.storyPoints} onChange={(event) => setDraft({ ...draft, storyPoints: Number(event.target.value) })}>
                <option value={0}>None</option>
                {[1,2,3,5,8,13].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="editor-field">
              Start date
              <input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
            </label>
            <label className="editor-field">
              Due date
              <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
            </label>
            <label className="editor-field task-form-wide">
              Description
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What does done look like?" />
            </label>
          </div>
          <div className="task-form-actions">
            <Button type="submit" icon="check">Create task</Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="task-toolbar">
        <div className="conversation-search">
          <Icon name="search" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks, people, projects" />
        </div>
        <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
          <option value="all">All projects</option>
          {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
          <option value="all">All priorities</option>
          <option value="high">High priority</option>
          <option value="medium">Medium priority</option>
          <option value="low">Low priority</option>
        </select>
      </div>

      <div className="task-board">
        {(["todo", "in-progress", "in-review", "done"] as TaskStatus[]).map((status) => {
          const column = filtered.filter((task) => task.status === status);
          return (
            <section className="task-column" key={status}>
              <header>
                <span className={statusMeta[status].className}>{statusMeta[status].label}</span>
                <b>{column.length}</b>
              </header>
              {column.length === 0 && <p className="task-empty">No tasks here yet.</p>}
              {column.map((task) => (
                <article
                  className={`task-card priority-${task.priority}${isOverdue(task) ? " overdue" : ""}${task.status === "in-review" ? " in-review-card" : ""}`}
                  key={task.id}
                  onClick={() => setSelectedId(task.id)}
                >
                  <div className="task-card-top">
                    <span className={`priority-pill ${task.priority}`}>{priorityLabel[task.priority]}</span>
                    {isOverdue(task) && <span className="overdue-pill">Overdue</span>}
                    <button
                      className="task-remove"
                      onClick={(e) => { e.stopPropagation(); deleteTask(task.id); notify("Task removed"); }}
                      aria-label={`Delete ${task.title}`}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                  <h3>{task.title}</h3>
                  <p>{task.description || "No description yet."}</p>
                  <small>{projectName(task.projectId)}</small>
                  <div className="task-meta">
                    <span><Icon name="users" size={13} /> {task.assignee}</span>
                    <span><Icon name="clock" size={13} /> {formatDate(task.dueDate)}</span>
                    {task.storyPoints ? <span>SP {task.storyPoints}</span> : null}
                  </div>
                  {task.status === "in-review" && task.statusHistory?.length ? (
                    <small className="submitted-label">Submitted {formatDate(task.statusHistory[task.statusHistory.length - 1].changedAt)}</small>
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>

      {selectedTask && (
        <div className="task-detail-overlay" onClick={() => setSelectedId(null)}>
          <div className="task-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="task-detail-head">
              <div>
                <h2>{selectedTask.title}</h2>
                <small>{projectName(selectedTask.projectId)} · {statusMeta[selectedTask.status].label}</small>
              </div>
              <button className="task-remove" onClick={() => setSelectedId(null)} aria-label="Close"><Icon name="close" size={16} /></button>
            </div>

            <div className="task-detail-meta">
              <span><b>Assignee:</b> {selectedTask.assignee}</span>
              <span><b>Priority:</b> {priorityLabel[selectedTask.priority]}</span>
              <span><b>Due:</b> {formatDate(selectedTask.dueDate)}{isOverdue(selectedTask) ? " (overdue)" : ""}</span>
            </div>

            {selectedTask.description && <p className="task-detail-desc">{selectedTask.description}</p>}

            <div className="task-detail-actions">
              <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Cancel edit" : "Edit"}</Button>
              {editing && editDraft && (
                <div className="task-edit-form">
                  <label className="editor-field">Title
                    <input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} />
                  </label>
                  <label className="editor-field">Description
                    <textarea value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} />
                  </label>
                  <label className="editor-field">Priority
                    <select value={editDraft.priority} onChange={(e) => setEditDraft({ ...editDraft, priority: e.target.value })}>
                      <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label className="editor-field">Story points
                    <select value={editDraft.storyPoints} onChange={(e) => setEditDraft({ ...editDraft, storyPoints: Number(e.target.value) })}>
                      <option value={0}>None</option>{[1,2,3,5,8,13].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label className="editor-field">Start date
                    <input type="date" value={editDraft.startDate} onChange={(e) => setEditDraft({ ...editDraft, startDate: e.target.value })} />
                  </label>
                  <label className="editor-field">Due date
                    <input type="date" value={editDraft.dueDate} onChange={(e) => setEditDraft({ ...editDraft, dueDate: e.target.value })} />
                  </label>
                  <Button onClick={async () => {
                    if (!selectedTask) return;
                    try {
                      await updateTask(selectedTask.id, {
                        title: editDraft.title,
                        description: editDraft.description,
                        priority: editDraft.priority,
                        storyPoints: editDraft.storyPoints,
                        startDate: editDraft.startDate ? new Date(editDraft.startDate).toISOString() : undefined,
                        dueDate: editDraft.dueDate ? new Date(editDraft.dueDate).toISOString() : undefined,
                      });
                      setEditing(false);
                      notify("Task updated");
                    } catch (err) {
                      notify(err instanceof Error ? err.message : "Update failed");
                    }
                  }}>Save</Button>
                </div>
              )}
              {role === "freelancer" && selectedTask.status === "todo" && (
                <Button onClick={() => moveTask(selectedTask, "in-progress")}>Start</Button>
              )}
              {role === "freelancer" && selectedTask.status === "in-progress" && (
                <Button onClick={() => moveTask(selectedTask, "in-review")}>Submit for review</Button>
              )}
              {role === "client" && selectedTask.status === "in-review" && (
                <>
                  <div className="task-review-actions">
                    <Button onClick={() => moveTask(selectedTask, "done")}>Approve</Button>
                    <Button variant="secondary" onClick={() => { setChangesRequested(""); setChangesModalOpen(true); }}>Request changes</Button>
                  </div>
                </>
              )}
            </div>

            <div className="task-comments">
              <h3>Comments</h3>
              <div className="task-comment-list">
                {comments.length === 0 && <p className="task-empty">No comments yet.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="task-comment">
                    <div className="task-comment-head">
                      <b>{c.authorName}</b>
                      <span className="task-comment-role">{c.authorRole}</span>
                      <small>{new Date(c.createdAt).toLocaleString()}</small>
                    </div>
                    <p>{c.content}</p>
                  </div>
                ))}
              </div>
              <div className="task-comment-input">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                />
                <Button onClick={sendComment}>Send</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {changesModalOpen && selectedTask && (
        <div className="task-detail-overlay" onClick={() => setChangesModalOpen(false)}>
          <div className="task-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="task-detail-head">
              <div>
                <h2>Request changes</h2>
                <small>{selectedTask.title}</small>
              </div>
              <button className="task-remove" onClick={() => setChangesModalOpen(false)} aria-label="Close"><Icon name="close" size={16} /></button>
            </div>
            <div className="task-changes">
              <textarea
                placeholder="Expliquez les corrections attendues (obligatoire)"
                value={changesRequested}
                onChange={(e) => setChangesRequested(e.target.value)}
                autoFocus
              />
              {!changesRequested.trim() && <small className="task-empty">Un commentaire est requis pour demander des corrections.</small>}
            </div>
            <div className="task-review-actions">
              <Button variant="secondary" onClick={() => setChangesModalOpen(false)}>Cancel</Button>
              <Button onClick={requestChanges} disabled={!changesRequested.trim()}>Send request</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  if (role === "client") {
    return <ClientShell page="client-tasks" go={go} notify={notify}>{content}</ClientShell>;
  }
  return <AppShell page="tasks" go={go} notify={notify}>{content}</AppShell>;
}