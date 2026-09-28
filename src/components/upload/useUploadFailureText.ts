"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useHumanizeError } from "@/components/feedback/ToastProvider";
import type { UploadFailure } from "./uploadTypes";

/**
 * `(failure, variant) => sentence` for a failed upload. `reject` is the
 * full sentence shown when a batch cannot start (and in toasts); `row` is
 * the short cause after "Failed" on a row. A server code without its own
 * upload reason is rendered by `useHumanizeError()` for `reject`; a row
 * keeps its short generic phrase (the full sentence goes to the toast).
 */
export function useUploadFailureText() {
  const t = useTranslations("upload");
  const humanize = useHumanizeError();
  return useCallback(
    (failure: UploadFailure, variant: "reject" | "row" = "reject") => {
      if (variant === "reject" && failure.reason === "generic" && failure.code) {
        return humanize({ code: failure.code });
      }
      return variant === "row" ? t(`rowReason.${failure.reason}`) : t(`reject.${failure.reason}`);
    },
    [t, humanize],
  );
}
