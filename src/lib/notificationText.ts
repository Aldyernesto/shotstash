// Story 3.5: a notification is rendered from its `type` + `data`, in the
// reader's locale, never from the text stored when it was created. The
// stored English `title` / `body` are only a fallback for old rows whose
// `data` lacks the fields a message needs. Pure: the caller passes a
// translator over the `notifications` message namespace (src/lib cannot
// import the i18n layer).

export type NotificationTranslate = (key: string, values?: Record<string, string | number>) => string;

export type NotificationLike = {
  type: string;
  title?: string | null;
  body?: string | null;
  /** Object, or the JSON string the GraphQL API returns. */
  data?: unknown;
};

export type NotificationText = { label: string; title: string; body: string };

/** The notification's `data` as string fields; anything unreadable is `{}`. */
export function parseNotificationData(data: unknown): Record<string, string> {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
}

const KNOWN_TYPES = ["upload_complete", "chat_mention", "file_shared", "project_created"] as const;
type KnownType = (typeof KNOWN_TYPES)[number];

function isKnown(type: string): type is KnownType {
  return (KNOWN_TYPES as readonly string[]).includes(type);
}

/** Fields each type needs; without all of them the stored text is used. */
const REQUIRED: Record<KnownType, string[]> = {
  chat_mention: ["projectTitle", "excerpt"],
  project_created: ["projectTitle"],
  upload_complete: ["fileName"],
  file_shared: ["fileName"],
};

function fromData(type: KnownType, d: Record<string, string>, t: NotificationTranslate) {
  switch (type) {
    case "chat_mention":
      return {
        title: t("chat_mention.title", { projectTitle: d.projectTitle }),
        body: t("chat_mention.body", { senderName: d.senderName || t("someone"), excerpt: d.excerpt }),
      };
    case "project_created":
      return {
        title: t("project_created.title"),
        body: t("project_created.body", { projectTitle: d.projectTitle }),
      };
    case "upload_complete":
      return {
        title: t("upload_complete.title"),
        body: d.projectTitle
          ? t("upload_complete.bodyProject", { fileName: d.fileName, projectTitle: d.projectTitle })
          : t("upload_complete.body", { fileName: d.fileName }),
      };
    case "file_shared":
      return {
        title: t("file_shared.title"),
        body: t("file_shared.body", {
          fileName: d.fileName,
          targetKind: ["file", "section", "project"].includes(d.targetKind) ? d.targetKind : "file",
        }),
      };
  }
}

/**
 * Label, title and body of a notification in the translator's locale. Old
 * notifications without the needed `data` fields keep their stored text.
 */
export function notificationText(n: NotificationLike, t: NotificationTranslate): NotificationText {
  const label = isKnown(n.type) ? t(`${n.type}.label`) : t("otherLabel");
  const stored = { title: n.title ?? "", body: n.body ?? "" };
  if (!isKnown(n.type)) return { label, ...stored };
  const d = parseNotificationData(n.data);
  if (!REQUIRED[n.type].every((k) => d[k])) return { label, ...stored };
  return { label, ...fromData(n.type, d, t) };
}
