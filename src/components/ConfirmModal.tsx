"use client";

import React from "react";

interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export default function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel, cancelLabel, danger = true }: ConfirmModalProps) {
  const bg = danger ? "#ef4444" : "#4CAF50";
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}
      onClick={onCancel}
    >
      <div style={{ background: "#1d1c18", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", padding: "24px", maxWidth: "400px", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ color: "#e6e2db", marginTop: 0, marginBottom: "8px", fontSize: "18px" }}>{title}</h3>
        <p style={{ color: "rgba(230,226,219,0.5)", marginBottom: "24px", fontSize: "14px" }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
          <button onClick={onCancel} style={{ padding: "8px 20px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#e6e2db", cursor: "pointer", fontSize: "14px" }}>
            {cancelLabel || "Cancel"}
          </button>
          <button onClick={onConfirm} style={{ padding: "8px 20px", borderRadius: "6px", border: "none", background: bg, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 500 }}>
            {confirmLabel || (danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
