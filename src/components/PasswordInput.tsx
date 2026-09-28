"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import fieldStyles from "./form/TextField.module.css";

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Ref ke <input> — dipakai form untuk memfokuskan field saat validasi gagal. */
  inputRef?: React.Ref<HTMLInputElement>;
};

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.16 3.19" />
      <path d="M6.61 6.61A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

/**
 * Input password dengan tombol ikon mata untuk menampilkan/menyembunyikan isi.
 * Semua props diteruskan ke <input>; `type` diatur oleh komponen.
 *
 * Story 1.13: kontrak tombol mata — 44px (48px di HP), flush kanan DI DALAM
 * field, label "Tampilkan/Sembunyikan password" (tanpa aria-pressed — status
 * dibaca dari perubahan nilai, bukan dari state tombol), `::-ms-reveal`
 * bawaan Edge tetap disembunyikan (globals.css). Posisi memakai kelas
 * .controlWrap/.suffix/.eyeBtn milik kontrak text-field (komposisi gaya,
 * bukan duplikasi); tampilan isi input tetap milik layar pemanggil.
 */
export default function PasswordInput({ className, style, inputRef, ...inputProps }: PasswordInputProps) {
  const t = useTranslations("password");
  const [visible, setVisible] = useState(false);
  const eyeLabel = visible ? t("hide") : t("show");
  return (
    <div className={fieldStyles.controlWrap} style={{ width: "100%" }}>
      <input
        {...inputProps}
        ref={inputRef}
        type={visible ? "text" : "password"}
        className={["password-input", fieldStyles.hasSuffix, className].filter(Boolean).join(" ")}
        style={style}
      />
      <div className={fieldStyles.suffix}>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={eyeLabel}
          title={eyeLabel}
          /* Story 1.7: target sentuh ≥48px + cincin fokus spine. */
          className={`spine-hit-area spine-focus-ring ${fieldStyles.eyeBtn}`}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}
