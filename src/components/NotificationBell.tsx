"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import { useTranslations } from "next-intl";
import { useAuth } from "./AuthContext";
import { useFormat } from "@/i18n/useFormat";
import { notificationText, type NotificationTranslate } from "@/lib/notificationText";
import { useRealtimeReconnect, useResilientSubscription } from "@/components/realtime/useProjectEvents";

const ALL_NOTIFS = gql`query AllNotifs { notifications { id type title body data read createdAt } unreadNotificationCount }`;
const MARK_READ_MUT = gql`mutation MarkRead { markNotificationsRead }`;
// Story 5.5: a new notification arrives through the subscription (within
// seconds); the poll stays as a slow fallback (a dropped connection).
const NOTIF_RECEIVED = gql`subscription NotificationReceived { notificationReceived { id } }`;
const FALLBACK_POLL_MS = 60_000;

export default function NotificationBell({ large = false }: { large?: boolean } = {}) {
  const { isAuthenticated } = useAuth();
  const t = useTranslations("notifications");
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, startPolling, refetch } = useQuery(ALL_NOTIFS, {
    skip: !isAuthenticated,
    fetchPolicy: "network-only",
  });
  // Reopened with backoff when the server ends the stream.
  useResilientSubscription(NOTIF_RECEIVED, {}, () => {
    refetch().catch(() => undefined);
  }, isAuthenticated);
  useRealtimeReconnect(() => {
    if (isAuthenticated) refetch().catch(() => undefined);
  });
  const [markRead] = useMutation(MARK_READ_MUT);

  const items = (data?.notifications as any[]) || [];
  const count = data?.unreadNotificationCount || 0;

  useEffect(() => { startPolling(FALLBACK_POLL_MS); }, [startPolling]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleMark = async () => {
    try { await markRead(); } catch {}
    setOpen(false);
  };

  const typeStyle = (type: string) => {
    switch (type) {
      case "upload_complete": return { icon: "▲", bg: "rgba(76,175,80,0.15)", color: "#4CAF50" };
      case "chat_mention": return { icon: "@", bg: "rgba(33,150,243,0.15)", color: "#2196F3" };
      case "file_shared": return { icon: "↗", bg: "rgba(255,152,0,0.15)", color: "#FF9800" };
      case "project_created": return { icon: "+", bg: "var(--app-spine-accent-14)", color: "var(--app-accent)" };
      default: return { icon: "●", bg: "rgba(255,255,255,0.1)", color: "#fff" };
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Story 2.2: icon-button 40px (48px versi HP, Story 2.3) + accent badge
          miring 8° (AC) — label menyebut jumlah belum dibaca; dropdown tetap
          perilaku lama (Epic 3). */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={t("bellLabel", { count })}
        className="spine-focus-ring"
        style={{
          position: "relative", width: large ? "48px" : "40px", height: large ? "48px" : "40px",
          borderRadius: "50%", display: "grid", placeItems: "center",
          background: "var(--app-spine-surface)", border: "1px solid var(--app-spine-line)",
          color: "var(--app-spine-text-soft)", cursor: "pointer", padding: 0,
        }}
      >
        <svg width={large ? 20 : 18} height={large ? 20 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {count > 0 && (
          <span aria-hidden="true" style={{
            position: "absolute", top: -4, right: -8,
            background: "var(--app-spine-accent)", color: "var(--app-spine-on-accent)",
            font: "900 9.5px/1.2 var(--font-inter)", letterSpacing: "0.02em",
            padding: "2px 5px", borderRadius: "999px",
            transform: "rotate(8deg)",
          }}>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="notifDropdown" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 1000,
          width: "380px", maxHeight: "460px",
          background: "var(--color-surface-container-high)",
          borderRadius: "18px", boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}>
            <span style={{ fontWeight: 700, fontSize: "15px", color: "var(--color-on-surface)" }}>{t("title")}</span>
            {count > 0 && (
              <button onClick={handleMark} style={{ background: "none", border: "none", color: "var(--app-accent)", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}>
                {t("markAllRead")}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", overflowX: "hidden", maxHeight: "380px", flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-on-surface-variant)", fontSize: "13px", opacity: 0.6 }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>{"\u{1F514}"}</div>
                {t("empty")}
              </div>
            ) : items.map((n: any) => {
              const s = typeStyle(n.type);
              const text = notificationText(n, t as unknown as NotificationTranslate);
              return (
                <div key={n.id} style={{
                  padding: "12px 18px",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  display: "flex", gap: "12px", alignItems: "flex-start",
                  opacity: n.read ? 0.55 : 1,
                  transition: "opacity 0.2s",
                }}>
                  {/* Type icon */}
                  <div style={{
                    width: "36px", height: "36px", borderRadius: "10px",
                    background: s.bg, color: s.color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "16px", fontWeight: 700, flexShrink: 0,
                  }}>
                    {s.icon}
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11px", color: s.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{text.label}</span>
                      <span style={{ fontSize: "10px", color: "var(--color-on-surface-variant)", opacity: 0.5, flexShrink: 0 }}>{f.relative(n.createdAt)}</span>
                    </div>
                    <div style={{
                      fontWeight: n.read ? 400 : 600, fontSize: "13px",
                      color: "var(--color-on-surface)", marginTop: "2px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {text.title}
                    </div>
                    <div style={{
                      fontSize: "12px", color: "var(--color-on-surface-variant)",
                      marginTop: "2px", opacity: 0.7,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {text.body}
                    </div>
                  </div>
                  {/* Unread indicator */}
                  {!n.read && (
                    <div style={{
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: "#ef4444", flexShrink: 0, marginTop: "4px",
                      boxShadow: "0 0 6px rgba(239,68,68,0.5)",
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
