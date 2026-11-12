"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { notificationsApi } from "@/lib/api";
import { publicNotificationText } from "@/lib/notifications";
import type { IconName, Notification } from "@/lib/types";

type NotifTone = "task" | "project" | "message" | "payment" | "alert" | "default";

function formatNotifDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs >= 0 && diffMs < hour) {
    const mins = Math.max(1, Math.round(diffMs / minute));
    return `Il y a ${mins} min`;
  }
  if (diffMs >= 0 && diffMs < day) {
    const hrs = Math.round(diffMs / hour);
    return `Il y a ${hrs} h`;
  }
  if (diffMs >= 0 && diffMs < 7 * day) {
    const days = Math.round(diffMs / day);
    return `Il y a ${days} j`;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function getNotifVisual(n: Notification): { icon: IconName; tone: NotifTone } {
  const text = `${n.title || ""} ${n.message || ""}`.toLowerCase();
  if (n.taskId || n.taskTitle || /task|tâche|tache|livrable|deadline|échéance|echeance/.test(text)) {
    return { icon: "check", tone: "task" };
  }
  if (/message|comment|discussion|chat|réponse|reponse/.test(text)) {
    return { icon: "message", tone: "message" };
  }
  if (/payment|paiement|invoice|facture|quote|devis|wallet/.test(text)) {
    return { icon: "wallet", tone: "payment" };
  }
  if (/alert|warning|urgent|refus|rejected|issue|problem/.test(text)) {
    return { icon: "shield", tone: "alert" };
  }
  if (n.projectTitle || /project|projet|proposal|offre|contrat|mission/.test(text)) {
    return { icon: "briefcase", tone: "project" };
  }
  return { icon: "bell", tone: "default" };
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function NotificationsBell({ onOpenTask }: { onOpenTask?: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [list, c] = await Promise.all([notificationsApi.list(), notificationsApi.unreadCount()]);
      setItems(Array.isArray(list) ? list : []);
      setCount(typeof c === "number" ? c : 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Impossible de charger les notifications.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const interval = setInterval(() => void load(false), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const closeModal = useCallback((restoreFocus = true) => {
    if (!open || isClosing) return;
    if (!restoreFocus) restoreFocusRef.current = null;
    setIsClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setIsClosing(false);
      if (restoreFocus) restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    }, 170);
  }, [open, isClosing]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? buttonRef.current;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal(true);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeModal]);

  const markRead = async (n: Notification) => {
    if (!n.isRead) {
      await notificationsApi.markRead(n.id).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setCount((c) => Math.max(0, c - 1));
    }
  };

  const handleClick = async (n: Notification) => {
    await markRead(n);
    if (n.taskId && onOpenTask) onOpenTask(n.taskId);
    closeModal(false);
  };

  const markAll = async () => {
    await notificationsApi.markAllRead().catch(() => {});
    setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
    setCount(0);
  };

  const openModal = () => {
    if (open) return;
    setOpen(true);
    setIsClosing(false);
    void load(items.length === 0);
  };

  const modal = open && typeof document !== "undefined" ? createPortal(
    <div className="notif-bell-wrap notif-modal-root" aria-hidden={false}>
      <div className={isClosing ? "notif-modal-overlay is-closing" : "notif-modal-overlay"} onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(true); }}>
        <div
          ref={dialogRef}
          className={isClosing ? "notif-modal is-closing" : "notif-modal"}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-label="Notifications"
        >
          <div className="notif-modal-head">
            <div className="notif-modal-title">
              <span className="notif-head-mark" aria-hidden="true"><Icon name="bell" size={15} /></span>
              <div className="notif-head-copy">
                <strong id={titleId}>Notifications</strong>
                <span className="notif-head-sub">{count > 0 ? `${count} non lue${count > 1 ? "s" : ""}` : "À jour"}</span>
              </div>
            </div>
            <div className="notif-head-actions">
              <button type="button" className="notif-head-btn" onClick={() => void load(true)} aria-label="Actualiser les notifications">
                Actualiser
              </button>
              <button
                type="button"
                className={count > 0 ? "notif-head-btn is-primary" : "notif-head-btn is-primary is-disabled"}
                onClick={() => void markAll()}
                disabled={count === 0}
              >
                Tout marquer comme lu
              </button>
              <button ref={closeBtnRef} type="button" className="notif-close-btn" onClick={() => closeModal(true)} aria-label="Fermer les notifications">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          <div className="notif-modal-body">
            {loading && (
              <div className="notif-state is-loading" role="status" aria-live="polite">
                <span className="notif-state-icon" aria-hidden="true"><span className="notif-spinner" /></span>
                <div>
                  <b>Chargement des notifications</b>
                  <p>Récupération de vos dernières mises à jour…</p>
                </div>
              </div>
            )}

            {!loading && error && (
              <div className="notif-state is-error" role="alert">
                <span className="notif-state-icon" aria-hidden="true"><Icon name="shield" size={16} /></span>
                <div>
                  <b>Impossible de charger les notifications</b>
                  <p>{error}</p>
                </div>
                <button type="button" className="notif-state-action" onClick={() => void load(true)}>Réessayer</button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="notif-state is-empty">
                <span className="notif-state-icon" aria-hidden="true"><Icon name="bell" size={17} /></span>
                <div>
                  <b>Aucune notification</b>
                  <p>Les activités importantes de vos projets, tâches et échanges apparaîtront ici.</p>
                </div>
              </div>
            )}

            {!loading && !error && items.length > 0 && (
              <div className="notif-list">
                {items.map((n) => {
                  const visual = getNotifVisual(n);
                  const title = publicNotificationText(n.title);
                  const message = publicNotificationText(n.message);
                  const context = [n.projectTitle, n.taskTitle].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={n.id}
                      type="button"
                      className={n.isRead ? `notif-item tone-${visual.tone}` : `notif-item unread tone-${visual.tone}`}
                      onClick={() => void handleClick(n)}
                    >
                      <span className="notif-item-accent" aria-hidden="true" />
                      <span className={`notif-item-icon tone-${visual.tone}`} aria-hidden="true">
                        <Icon name={visual.icon} size={15} />
                      </span>
                      <span className="notif-item-content">
                        <span className="notif-item-top">
                          <span className="notif-item-title">{title || "Notification"}</span>
                          <span className="notif-item-end">
                            {!n.isRead && <span className="notif-unread-dot" aria-label="Non lue" />}
                            <time className="notif-item-date" dateTime={n.createdAt}>{formatNotifDate(n.createdAt)}</time>
                          </span>
                        </span>
                        <span className="notif-item-message">{message || "Nouvelle mise à jour disponible."}</span>
                        {context && <span className="notif-meta">{context}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "icon-btn notif-bell is-open" : "icon-btn notif-bell"}
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openModal}
      >
        <Icon name="bell" />
        {count > 0 && <span className="notif-badge" aria-label={`${count} notification${count > 1 ? "s" : ""} non lue${count > 1 ? "s" : ""}`}>{count > 9 ? "9+" : count}</span>}
      </button>
      {modal}
    </div>
  );
}
