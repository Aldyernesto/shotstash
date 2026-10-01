"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import styles from "./page.module.css";
import TagPill from "@/components/tag-pill/TagPill";
// Story 3.2: copy from messages, numbers/dates/sizes in the active locale.
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/useFormat";
// Story 2.17: chip tujuan menulis "NO 24 Tarwiyah di Mina", bukan nama mentah.
import { parseSectionName } from "@/lib/sectionNumber";
// Story 2.18: satu sumber kebenaran gerbang role di ruang kerja berkas.
import * as perm from "@/lib/permissions";
// Story 2.6/2.10/2.11: MediaCard & FolderCard warisan sudah tidak dipakai
// halaman ini. Berkasnya sengaja DIBIARKAN ADA — kontrak prop-nya masih
// dirujuk story mode daftar (2.14-2.16) dan layar Epic 3 yang belum
// disentuh gelombang ini.
import ProjectCard, { ProjectCardSkeleton } from "@/components/dashboard/ProjectCard";
import SectionCard from "@/components/dashboard/SectionCard";
import FileCard from "@/components/dashboard/FileCard";
import FileGrid from "@/components/dashboard/FileGrid";
import { EmptyState, SkeletonRow, ErrorBox } from "@/components/dashboard/states";
import BulkBar from "@/components/dashboard/BulkBar";
import ListView from "@/components/dashboard/ListView";
import { PillButton } from "@/components/form/buttons";
// Story 3.8: `share-modal` baru — satu-satunya pembuat link /s/[slug].
import ShareModal, { type ShareTargetKind } from "@/components/share/ShareModal";
// Story 3.17: `chat-panel` menggantikan wujud lama `ProjectChat`.
import ChatPanel from "@/components/chat/ChatPanel";
// Story 3.12: pemilih Section tujuan menggantikan "Pilih Folder Tujuan"
// bergaya lama. Story 3.14: `upload-panel` dirender di dashboard layout
// (di bawah provider antrean), halaman ini hanya MEMICU pembukaannya.
import SectionPicker from "@/components/upload/SectionPicker";
import { useUpload } from "@/components/UploadContext";
// Story 3.3: `context-menu` bergaya spine (popover desktop + sheet HP)
// menggantikan ContextMenu warisan berikon emoji.
import ActionMenu, { type ActionMenuEntry, type ActionMenuTarget } from "@/components/dashboard/ActionMenu";
import { MenuIcon } from "@/components/dashboard/menuIcons";
// Story 3.4: `video-controls` kustom (satu komponen, tiga tempat pakai).
import VideoPlayer from "@/components/media/VideoPlayer";
// Story 3.5: `file-viewer` satu lapisan menggantikan modal pratinjau lama.
import FileViewer from "@/components/media/FileViewer";
import { JobChip } from "@/components/media/JobChip";
import { ViewerProcess } from "@/components/media/ViewerProcess";
import { useKindLabel } from "@/components/media/ViewerInfo";
import { noteProjectSeq, useProjectEvents, useRealtimeReconnect } from "@/components/realtime/useProjectEvents";
import { JOB_FIELDS, type UiJob } from "@/components/realtime/fields";
import { newerJob } from "@/lib/jobChip";
// Story 3.1: konfirmasi bergaya (`dialog` desktop / `confirm-sheet` HP)
// menggantikan ConfirmModal warisan dan modal hapus project berinline style.
import { ConfirmDialog, Dialog } from "@/components/overlay/Dialog";
import RepThumb from "@/components/dashboard/RepThumb";
// Story 3.2: `toast` bersama — satu host di dashboard/layout.tsx.
import { useToast, useHumanizeError } from "@/components/feedback/ToastProvider";

// Story 2.5: satu daftar kolom urut — dipakai sort-pills DAN kepala kolom
// mode daftar, supaya tidak ada dua sumber nama/urutan kolom.
// Labels are translated at render (`dashboard.sort.<field>`).
const SORT_FIELDS = ["name", "date", "size", "type"] as const;

type DashboardT = ReturnType<typeof useTranslations<"dashboard">>;

/** "video" | "image" | "audio" | "document" dari mime — versi modul. */
function mimeKind(mimeType?: string | null): "video" | "image" | "audio" | "document" {
  const m = String(mimeType || "");
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

function kindLabel(t: DashboardT, mimeType?: string | null): string {
  return t(`kind.${mimeKind(mimeType)}`);
}

import { useQuery, useMutation, useApolloClient, gql } from "@apollo/client";
import { useAuth } from "@/components/AuthContext";
import { mediaUrl } from "@/lib/mediaUrls";
import { readDropAsTrees, countFiles, type DropNode } from "@/lib/dropTree";

const GET_PROJECTS = gql`
  query GetProjects {
    projects {
      id
      title
      description
      totalFiles
      totalSize
      createdAt
      contentSummary {
        photos
        videos
        documents
        total
      }
      repFiles(limit: 5) {
        id
        kind
        thumbnailUrl
        duration
        extension
      }
      folders { id }
    }
  }
`;

const GET_PROJECT_ROOT = gql`
  query GetProjectRoot($id: ID!) {
    project(id: $id) {
      id
      title
      totalFiles
      createdAt
      folders {
        id
        name
        totalFiles
        createdAt
        contentSummary {
          photos
          videos
          documents
          total
        }
        repFiles(limit: 3) {
          id
          kind
          thumbnailUrl
          extension
        }
        # Story 2.15 (aditif): baris kedua sub-Section di mode daftar.
        children {
          id
          name
        }
      }
    }
  }
`;

const GET_FOLDER = gql`
  query GetFolder($id: ID!) {
    folder(id: $id) {
      id
      name
      folderType
      totalFiles
      createdAt
      contentSummary {
        photos
        videos
        documents
        total
      }
      project {
        id
        title
      }
      parent {
        id
        name
      }
      children {
        id
        name
        totalFiles
        createdAt
        contentSummary {
          photos
          videos
          documents
          total
        }
        repFiles(limit: 3) {
          id
          kind
          thumbnailUrl
          extension
        }
        # Story 2.15 (aditif): baris kedua sub-Section di mode daftar.
        children {
          id
          name
        }
      }
      files {
        id
        originalName
        mimeType
        size
        createdAt
        thumbnailUrl
        # Story 4.4: the viewer shows the preview version of a HEIC original;
        # the full version list loads when the viewer opens a file.
        previewUrl
        # Story 5.4: the chip on cards and list rows (one batched query).
        currentJob {
          ${JOB_FIELDS}
        }
        # Story 2.15 (aditif): kolom "Diunggah oleh" — HANYA ada di tingkat
        # isi Section karena skema hanya menyimpan MediaFile.uploadedBy.
        uploadedBy {
          id
          name
        }
      }
    }
  }
`;

const FILE_VERSIONS = gql`
  query FileVersions($fileId: ID!) {
    processedVersions(fileId: $fileId) {
      id
      kind
      kindLabel
      mimeType
      size
      createdAt
      downloadUrl
    }
  }
`;

const CREATE_PROJECT = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id title coverImage
    }
  }
`;

const RENAME_PROJECT = gql`
  mutation RenameProject($id: ID!, $input: CreateProjectInput!) {
    updateProject(id: $id, input: $input) { id title }
  }
`;

const DELETE_PROJECT = gql`
  mutation DeleteProject($id: ID!) {
    deleteProject(id: $id)
  }
`;

const CREATE_FOLDER = gql`
  mutation CreateFolder($projectId: ID!, $name: String!, $parentId: ID) {
    createFolder(projectId: $projectId, name: $name, parentId: $parentId) {
      id
      name
    }
  }
`;

const RENAME_FOLDER = gql`
  mutation RenameFolder($folderId: ID!, $name: String!) {
    renameFolder(folderId: $folderId, name: $name) {
      id
      name
    }
  }
`;

const SEARCH_ALL = gql`
  query SearchAll($query: String!, $projectId: ID) {
    searchFiles(query: $query, projectId: $projectId) {
      id
      originalName
      mimeType
      size
      folder { id name }
      project { id title }
    }
    searchFolders(query: $query, projectId: $projectId) {
      id
      name
      totalFiles
      project { id title }
    }
  }
`;

const MOVE_FILE = gql`
  mutation MoveFile($fileId: ID!, $targetFolderId: ID!) {
    moveFile(fileId: $fileId, targetFolderId: $targetFolderId) {
      id
      originalName
    }
  }
`;

const MOVE_FOLDER = gql`
  mutation MoveFolder($folderId: ID!, $targetFolderId: ID, $targetProjectId: ID) {
    moveFolder(folderId: $folderId, targetFolderId: $targetFolderId, targetProjectId: $targetProjectId) {
      id
      name
    }
  }
`;

const MOVE_TO_TRASH = gql`
  mutation MoveToTrash($fileId: ID!) {
    moveToTrash(fileId: $fileId)
  }
`;

const MOVE_FOLDER_TO_TRASH = gql`
  mutation MoveFolderToTrash($folderId: ID!) {
    moveFolderToTrash(folderId: $folderId)
  }
`;

const COPY_FILE = gql`
  mutation CopyFile($fileId: ID!, $targetFolderId: ID!) {
    copyFile(fileId: $fileId, targetFolderId: $targetFolderId) {
      id
      originalName
    }
  }
`;

// Folder Picker Modal for Move/Copy operations
function FolderPickerModal({ mode, items, currentLocationId, apolloClient, onSelect, onClose }: {
  mode: 'move' | 'copy';
  items: { type: 'file' | 'folder'; id: string; name: string }[];
  currentLocationId: string | null;
  apolloClient: any;
  onSelect: (target: { folderId: string | null; projectId: string }) => void;
  onClose: () => void;
}) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tn = useTranslations('count');
  const itemId = items.length === 1 ? items[0].id : '';
  const itemType = items.length === 1 ? items[0].type : 'file';
  const itemName = items.length === 1 ? items[0].name : tn('items', { count: items.length });
  const [currentProjId, setCurrentProjId] = useState<string | null>(null);
  const [currentFoldId, setCurrentFoldId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string | null; name: string; type: 'root' | 'project' | 'folder' }[]>([
    { id: null, name: t('levels.projects'), type: 'root' }
  ]);
  const [folderItems, setFolderItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch projects at root — always fetch independently
  React.useEffect(() => {
    if (!currentProjId) {
      setLoading(true);
      apolloClient.query({
        query: GET_PROJECTS,
        fetchPolicy: 'network-only',
      }).then((res: any) => {
        setFolderItems(res.data?.projects || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [currentProjId, apolloClient]);

  // Fetch folders when navigating into a project or folder
  React.useEffect(() => {
    if (currentProjId && !currentFoldId) {
      setLoading(true);
      apolloClient.query({
        query: GET_PROJECT_ROOT,
        variables: { id: currentProjId },
        fetchPolicy: 'network-only',
      }).then((res: any) => {
        setFolderItems(res.data?.project?.folders || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else if (currentFoldId) {
      setLoading(true);
      apolloClient.query({
        query: GET_FOLDER,
        variables: { id: currentFoldId },
        fetchPolicy: 'no-cache',
      }).then((res: any) => {
        setFolderItems(res.data?.folder?.children || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [currentProjId, currentFoldId, apolloClient]);

  const navigateToProject = (proj: any) => {
    setCurrentProjId(proj.id);
    setCurrentFoldId(null);
    setSelectedTargetId(null);
    setBreadcrumb(prev => [...prev, { id: proj.id, name: proj.title, type: 'project' }]);
  };

  const navigateToFolder = (folder: any) => {
    setCurrentFoldId(folder.id);
    setSelectedTargetId(null);
    setBreadcrumb(prev => [...prev, { id: folder.id, name: folder.name, type: 'folder' }]);
  };

  const navigateToBreadcrumb = (idx: number) => {
    const crumb = breadcrumb[idx];
    const newCrumbs = breadcrumb.slice(0, idx + 1);
    setBreadcrumb(newCrumbs);
    setSelectedTargetId(null);
    if (crumb.type === 'root') {
      setCurrentProjId(null);
      setCurrentFoldId(null);
    } else if (crumb.type === 'project') {
      setCurrentProjId(crumb.id);
      setCurrentFoldId(null);
    } else {
      setCurrentFoldId(crumb.id);
    }
  };

  // Effective target: explicit row selection wins; otherwise use the deepest navigated folder.
  // When inside a project but no folder selected/entered, target is the project root.
  const effectiveTargetId = selectedTargetId ?? currentFoldId;
  const targetIsProjectRoot = effectiveTargetId === null && currentProjId !== null;
  const containsFile = items.some(it => it.type === 'file');
  const canSelectHere =
    (effectiveTargetId !== null && effectiveTargetId !== itemId && effectiveTargetId !== currentLocationId)
    || (targetIsProjectRoot && !containsFile && currentProjId !== currentLocationId);

  const actionLabel = mode === 'move' ? t('picker.moveHere') : t('picker.copyHere');
  const titleArgs = { icon: itemType === 'folder' ? '📁' : '📄', name: itemName };
  const titleLabel = mode === 'move' ? t('picker.titleMove', titleArgs) : t('picker.titleCopy', titleArgs);

  const filteredItems = folderItems.filter(item => {
    // Prevent navigating into the folder that is currently being moved
    if (itemType === 'folder' && item.id === itemId) return false;
    return true;
  });

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '480px', minHeight: '340px' }}>
        <h3 style={{ marginBottom: '4px' }}>{titleLabel}</h3>
        <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.82rem', marginBottom: '12px' }}>
          {t('picker.hint')}
        </p>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.82rem' }}>
          {breadcrumb.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--color-on-surface-variant)', opacity: 0.5 }}>›</span>}
              <span
                onClick={() => navigateToBreadcrumb(i)}
                style={{
                  cursor: 'pointer',
                  color: i === breadcrumb.length - 1 ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                  fontWeight: i === breadcrumb.length - 1 ? 600 : 400,
                }}
              >
                {crumb.name}
              </span>
            </React.Fragment>
          ))}
        </div>

        {/* Folder list */}
        <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '16px', border: '1px solid var(--dash-chip-border)', borderRadius: '8px' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-on-surface-variant)' }}>{tc('loading')}</div>
          ) : filteredItems.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-on-surface-variant)', fontSize: '0.85rem' }}>
              {currentProjId ? t('picker.emptySections') : t('picker.emptyProjects')}
            </div>
          ) : (
            filteredItems.map((item: any) => {
              const isProjectLevel = !currentProjId;
              const isSelected = !isProjectLevel && selectedTargetId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isProjectLevel) {
                      // Projects can't be a move target — clicking dives in
                      navigateToProject(item);
                    } else {
                      // Folder row click = toggle select (use chevron to navigate)
                      setSelectedTargetId(prev => (prev === item.id ? null : item.id));
                    }
                  }}
                  style={{
                    padding: '11px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    borderBottom: '1px solid var(--dash-chip)',
                    transition: 'background 0.15s',
                    background: isSelected ? 'var(--app-spine-accent-14)' : 'transparent',
                    borderLeft: isSelected ? '3px solid var(--color-primary-container)' : '3px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--dash-hairline)'; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: '1.1rem' }}>{isProjectLevel ? '🎬' : '📁'}</span>
                  <span style={{ flex: 1, color: isSelected ? 'var(--app-accent)' : 'inherit', fontWeight: isSelected ? 600 : 400 }}>
                    {item.title || item.name}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-on-surface-variant)' }}>
                    {item.totalFiles != null
                      ? tn('files', { count: Number(item.totalFiles) || 0 })
                      : item.folders
                        ? tn('sections', { count: item.folders.length })
                        : ''}
                  </span>
                  {!isProjectLevel ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigateToFolder(item); }}
                      title={t('picker.openSection')}
                      style={{
                        background: 'var(--dash-hairline)',
                        border: 'none',
                        color: 'var(--color-on-surface)',
                        cursor: 'pointer',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '1rem',
                        lineHeight: 1,
                      }}
                    >
                      ›
                    </button>
                  ) : (
                    <span style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.9rem' }}>›</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-on-surface-variant)' }}>
            {canSelectHere
              ? (() => {
                  const selectedItem = selectedTargetId
                    ? filteredItems.find((it: any) => it.id === selectedTargetId)
                    : null;
                  const name = selectedItem?.name || breadcrumb[breadcrumb.length - 1].name;
                  return `📍 ${name}`;
                })()
              : currentProjId
                ? t('picker.tapHint')
                : t('picker.openProject')}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={styles.modalBtnSecondary} onClick={onClose}>{tc('cancel')}</button>
            <button
              className={styles.modalBtnPrimary}
              disabled={!canSelectHere}
              onClick={() => {
                if (!canSelectHere || !currentProjId) return;
                onSelect({ folderId: effectiveTargetId, projectId: currentProjId });
              }}
              style={{ opacity: canSelectHere ? 1 : 0.4 }}
            >
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  // Story 2.18: gerbang role datang dari SATU modul bersama
  // (`src/lib/permissions.ts`); tidak ada perbandingan role di berkas layar.
  // Story 2.4: gates come from `me.permissions` only.
  const canCreateProject = perm.canCreateProject(user);
  const canUpload = perm.canUpload(user);
  const canMove = perm.canMove(user);
  const canManageTrash = perm.canManageTrash(user);
  const canShare = perm.canShare(user);
  // Story 5.4: the viewer's Process menu, cancel and retry.
  const canTrigger = perm.canTriggerPipeline(user);
  // Story 5.5: project discussion can be switched off per instance.
  const canDiscuss = perm.canUseDiscussion(user);
  const canPurge = perm.canPurgeTrash(user);

  // Story 3.2: satu host `toast` (dipasang di dashboard/layout.tsx).
  const { pushToast: pushSpineToast } = useToast();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tn = useTranslations('count');
  const f = useFormat();
  const humanize = useHumanizeError();

  // Story 3.1: the preview meta line in dialogs/sheets, one sentence
  // shape for Project, Section and file.
  const projectMetaLine = (project: any): string => {
    if (!project) return t('levels.project');
    return t('meta.project', {
      files: tn('files', { count: Number(project.totalFiles) || 0 }),
      sections: tn('sections', { count: (project.folders || []).length }),
    });
  };
  const sectionMetaLine = (folder: any): string => {
    if (!folder) return t('levels.section');
    return t('meta.section', { files: tn('files', { count: Number(folder.totalFiles) || 0 }) });
  };
  const fileMetaLine = (file: any): string => {
    if (!file) return t('levels.file');
    return t('meta.file', { kind: kindLabel(t, file.mimeType), size: f.fileSize(Number(file.size) || 0) });
  };

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"name" | "date" | "size" | "type">("date");
  const [sortAsc, setSortAsc] = useState(false);
  // Story 3.8: baris identitas `share-modal` butuh rep-thumb + meta, jadi
  // pemicunya mengirim bentuk yang sudah lengkap (bukan hanya id + judul).
  const [shareData, setShareData] = useState<
    | {
        kind: ShareTargetKind;
        id: string;
        name: string;
        fileCount?: number | null;
        sectionCount?: number | null;
        parentName?: string | null;
        sizeText?: string | null;
        kindLabel?: string | null;
        repFiles?: any[] | null;
        file?: { kind?: string | null; thumbnailUrl?: string | null; extension?: string | null } | null;
      }
    | null
  >(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);

  const [previewFile, setPreviewFile] = useState<any>(null);
  // Story 3.5: panah, Esc berurutan, dan jebakan fokus adalah milik
  // `FileViewer` + `modalStack` — tidak ada lagi listener keyboard viewer
  // di halaman ini.
  const [actionMenu, setActionMenu] = useState<{
    id: string;
    anchor: { x: number; y: number };
    target: ActionMenuTarget;
    entries: ActionMenuEntry[];
  } | null>(null);
  const [confirmTrash, setConfirmTrash] = useState<{ fileId?: string; folderId?: string; name: string } | null>(null);
  const [copyFile, setCopyFile] = useState<any>(null);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectCover, setNewProjectCover] = useState("");
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [renameProjectData, setRenameProjectData] = useState<{ id: string; title: string } | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const [deleteProjectData, setDeleteProjectData] = useState<{ id: string; title: string } | null>(null);
  const [renameFolderData, setRenameFolderData] = useState<{ id: string; name: string } | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [moveCopyModal, setMoveCopyModal] = useState<{ mode: 'move' | 'copy'; items: { type: 'file' | 'folder'; id: string; name: string }[] } | null>(null);
  const [pickerProjectId, setPickerProjectId] = useState<string | null>(null);
  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null);
  const [pickerBreadcrumb, setPickerBreadcrumb] = useState<{ id: string | null; name: string }[]>([]);

  // Freehand selection
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectRect, setSelectRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // DnD State
  const [dragItem, setDragItem] = useState<{ type: "file" | "folder"; id: string } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  // Story 2.17: jenis seretan menentukan KALIMAT chip tujuan — memindahkan
  // item vs menjatuhkan file dari komputer. Selama gelombang ini, file dari
  // komputer yang dijatuhkan ke Kartu/baris Section membuka pemilih Section
  // tujuan yang ada, jadi chipnya wajib menyebut pemilih itu, bukan "upload
  // ke {Section}" (copy itu baru benar setelah FR16 mendarat di Epic 4).
  const [dragOverKind, setDragOverKind] = useState<"files" | "item" | null>(null);

  // OS file drop state
  const [isDroppingFiles, setIsDroppingFiles] = useState(false);
  // Story 3.14: TIDAK ada state antrean upload di halaman ini lagi —
  // daftar tugas, progres, tujuan, dan keadaan panel hidup di
  // `UploadContext` (provider di dashboard layout), jadi upload tetap
  // berjalan saat berpindah Section/Project/halaman.
  const upload = useUpload();
  // Picker for "where to drop these files?" when uploading at project root
  const [projectRootPickerFiles, setProjectRootPickerFiles] = useState<File[] | null>(null);
  const dropCounterRef = React.useRef(0);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Story 2.5: mode pilih (toggle "Pilih"/"Batal" untuk perangkat tanpa
  // hover) + satu live region polite (jumlah hasil pencarian, masuk/keluar
  // mode pilih) — pengumuman tanpa memindahkan fokus.
  const [selectMode, setSelectMode] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  // Navigation State — init from URL search params
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('p');
    }
    return null;
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('f');
    }
    return null;
  });
  const [folderHistory, setFolderHistory] = useState<{id: string, name: string}[]>([]);


  // Selection State
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastClickedFolderIdx, setLastClickedFolderIdx] = useState<number | null>(null);
  const [lastClickedFileIdx, setLastClickedFileIdx] = useState<number | null>(null);

  // Queries
  const { data: projectsData, loading: projectsLoading, error: projectsError, refetch: refetchProjects } = useQuery(GET_PROJECTS, {
    skip: currentProjectId !== null,
    fetchPolicy: "network-only",
    nextFetchPolicy: "cache-first",
  });

  const { data: rootData, loading: rootLoading, error: rootError, refetch: refetchRoot } = useQuery(GET_PROJECT_ROOT, {
    variables: { id: currentProjectId },
    skip: currentProjectId === null || currentFolderId !== null,
    fetchPolicy: "network-only",
  });

  const { data: folderData, loading: folderLoading, error: folderError, refetch: refetchFolder } = useQuery(GET_FOLDER, {
    variables: { id: currentFolderId },
    skip: currentFolderId === null,
    // Story 4.5: a Section can hold 10,000+ files; normalising every one into
    // the Apollo cache costs over a second. The result stays with this query
    // and every change refetches it (as each mutation here already does).
    fetchPolicy: "no-cache",
  });

  // Sync navigation state → URL search params
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (currentProjectId) params.set('p', currentProjectId);
    if (currentFolderId) params.set('f', currentFolderId);
    const search = params.toString();
    const newUrl = search ? `/dashboard?${search}` : '/dashboard';
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [currentProjectId, currentFolderId]);

  // Story 2.3: slot "Upload"/"Cari" bottom-bar HP (MobileFrame) memicu alur
  // yang SUDAH ada di halaman ini — pemilih Section tujuan (projectRootPicker)
  // dan fokus search-pill — tanpa lapisan baru.
  const searchInputRef = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const openUpload = () => {
      if (!currentProjectId || !canUpload) return;
      // Di DALAM Section tujuannya sudah diketahui — langsung buka panel.
      // Pemilih Section hanya untuk tingkat Project, tempat tujuannya
      // memang belum ditentukan (AC 3.12); membukanya di dalam Section
      // dulu menghasilkan daftar KOSONG karena kueri akar di-skip.
      if (currentFolderId) {
        upload.open({
          projectId: currentProjectId,
          folderId: currentFolderId,
          folderName: folderData?.folder?.name ?? null,
          folderType: folderData?.folder?.folderType ?? null,
        });
        return;
      }
      setProjectRootPickerFiles([]);
    };
    const focusSearch = () => searchInputRef.current?.focus();
    window.addEventListener("mam:open-upload", openUpload);
    window.addEventListener("mam:focus-search", focusSearch);
    return () => {
      window.removeEventListener("mam:open-upload", openUpload);
      window.removeEventListener("mam:focus-search", focusSearch);
    };
  }, [currentProjectId, currentFolderId, canUpload, folderData, upload]);

  // Slot Upload dari /dashboard: Project dipilih di sheet → navigasi ke sini
  // (?p=…) → langsung buka pemilih Section tujuan yang sama.
  React.useEffect(() => {
    if (!currentProjectId) return;
    let flagged = false;
    try { flagged = sessionStorage.getItem("shotstash_upload_after_nav") === "1"; } catch {}
    if (!flagged) return;
    try { sessionStorage.removeItem("shotstash_upload_after_nav"); } catch {}
    if (canUpload) setProjectRootPickerFiles([]);
  }, [currentProjectId, currentFolderId, canUpload, folderData, upload]);

  // Rebuild folderHistory from URL on initial load
  React.useEffect(() => {
    if (!currentProjectId) return;
    if (folderHistory.length > 0) return; // already initialized
    // Build initial breadcrumb from data once loaded
    if (currentFolderId && folderData?.folder) {
      const trail: { id: string; name: string }[] = [];
      // Walk parent chain
      const cursor = folderData.folder;
      trail.unshift({ id: cursor.id, name: cursor.name });
      // folderData only has current folder info; set minimal breadcrumb
      // Buka langsung lewat URL (?p=&f=): judul Project diambil dari
      // folder.project supaya back-pill menulis "← {nama Project}",
      // bukan kata generik (AC Story 2.5).
      const projectTitle = rootData?.project?.title || folderData.folder.project?.title || t('levels.project');
      setFolderHistory([{ id: 'root', name: projectTitle }, ...trail]);
    } else if (!currentFolderId && rootData?.project) {
      setFolderHistory([{ id: 'root', name: rootData.project.title }]);
    }
  }, [currentProjectId, currentFolderId, folderData, rootData, t]);

  const [createProject] = useMutation(CREATE_PROJECT, {
    onCompleted: () => {
      setIsCreateProjectModalOpen(false);
      setNewProjectTitle(""); setNewProjectDesc(""); setNewProjectCover("");
      refetchProjects();
    }
  });

  const [renameProject] = useMutation(RENAME_PROJECT, {
    onCompleted: () => refetchProjects(),
  });

  const [deleteProject] = useMutation(DELETE_PROJECT, {
    // Story 3.3: hasil aksi merusak dari `context-menu` memakai `toast`.
    onCompleted: () => {
      refetchProjects();
      pushSpineToast({ tone: 'success', message: t('toasts.projectDeleted') });
    },
    onError: (err) => {
      pushSpineToast({
        tone: 'error',
        message: t('toasts.projectDeleteFailed'),
        cause: humanize(err),
      });
    },
  });

  const [createFolder] = useMutation(CREATE_FOLDER, {
    onCompleted: () => {
      setIsCreateFolderModalOpen(false);
      setNewFolderName("");
      if (currentFolderId) refetchFolder();
      else if (currentProjectId) refetchRoot();
    }
  });

  const [renameFolderMutate] = useMutation(RENAME_FOLDER, {
    onCompleted: () => {
      setRenameFolderData(null);
      if (currentFolderId) refetchFolder();
      else if (currentProjectId) refetchRoot();
    }
  });

  const [moveFile] = useMutation(MOVE_FILE);
  const [moveFolder] = useMutation(MOVE_FOLDER);
  const [copyFileMutate] = useMutation(COPY_FILE);
  const apolloClient = useApolloClient();

  /**
   * Story 3.3: `notify` = aksi datang dari `context-menu` (satu item), jadi
   * hasilnya memakai `toast`. Jalur massal `bulk-bar` TIDAK memakai toast di
   * gelombang ini — lihat daftar B di `ToastProvider.tsx`.
   */
  const doTrash = async (fileId: string, notify = false) => {
    try {
      const res = await apolloClient.mutate({
        mutation: MOVE_TO_TRASH,
        variables: { fileId },
      });
      if (res.data?.moveToTrash) {
        // Remove file from cache
        const cache = apolloClient.cache;
        const id = cache.identify({ __typename: "MediaFile", id: fileId });
        if (id) cache.evict({ id });
        cache.gc();
        // Force refetch active queries
        if (currentFolderId) refetchFolder();
        else if (currentProjectId) refetchRoot();
        else refetchProjects();
        if (notify) pushSpineToast({ tone: 'success', message: t('toasts.fileTrashed') });
      } else {
        pushSpineToast({ tone: 'error', message: t('toasts.fileTrashFailed') });
      }
    } catch (err: any) {
      pushSpineToast({ tone: 'error', message: t('toasts.fileTrashFailed'), cause: humanize(err) });
    }
  };

  const doFolderTrash = async (folderId: string, notify = false) => {
    try {
      const res = await apolloClient.mutate({
        mutation: MOVE_FOLDER_TO_TRASH,
        variables: { folderId },
      });
      if (res.data?.moveFolderToTrash) {
        const cache = apolloClient.cache;
        const id = cache.identify({ __typename: "Folder", id: folderId });
        if (id) cache.evict({ id });
        cache.gc();
        if (currentFolderId) refetchFolder();
        else if (currentProjectId) refetchRoot();
        if (notify) pushSpineToast({ tone: 'success', message: t('toasts.sectionTrashed') });
      } else {
        pushSpineToast({ tone: 'error', message: t('toasts.sectionTrashFailed') });
      }
    } catch (err: any) {
      pushSpineToast({ tone: 'error', message: t('toasts.sectionTrashFailed'), cause: humanize(err) });
    }
  };

  const {
    data: searchData,
    error: searchError,
    loading: searchLoading,
    refetch: refetchSearch,
  } = useQuery(SEARCH_ALL, {
    variables: { query: searchQuery, projectId: currentProjectId },
    skip: !searchQuery || searchQuery.trim().length < 1,
    fetchPolicy: "network-only",
  });

  const searchResults = [
    ...(searchData?.searchFolders || []).map((f: any) => ({ ...f, _type: 'folder' })),
    ...(searchData?.searchFiles || []).map((f: any) => ({ ...f, _type: 'file' })),
  ];

  // Story 2.5: umumkan jumlah hasil / ketiadaan hasil / kegagalan secara
  // polite. Kegagalan tidak menumpuk: pesannya satu dan hilang begitu satu
  // pencarian berhasil (Apollo mengganti error dengan data).
  React.useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 1) { setLiveMessage(""); return; }
    if (searchError) { setLiveMessage(t('toolbar.searchFailed')); return; }
    if (searchLoading) return; // jangan umumkan keadaan antara
    const n = (searchData?.searchFolders?.length || 0) + (searchData?.searchFiles?.length || 0);
    setLiveMessage(n === 0 ? t('toolbar.noResults', { query: q }) : t('live.results', { count: n, query: q }));
  }, [searchQuery, searchData, searchError, searchLoading, t]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setIsSearching(val.trim().length >= 1);
  };

  const handleSearchResultClick = (item: any) => {
    setSearchQuery("");
    setIsSearching(false);
    if (item._type === 'folder') {
      if (item.project?.id !== currentProjectId) {
        setCurrentProjectId(item.project?.id);
        setFolderHistory([{ id: 'root', name: item.project?.title || t('levels.project') }]);
      }
      setCurrentFolderId(item.id);
      setFolderHistory(prev => [...prev, { id: item.id, name: item.name }]);
    } else {
      if (item.project?.id !== currentProjectId) {
        setCurrentProjectId(item.project?.id);
        setFolderHistory([{ id: 'root', name: item.project?.title || t('levels.project') }]);
      }
      if (item.folder?.id) {
        setCurrentFolderId(item.folder.id);
        setFolderHistory(prev => [...prev, { id: item.folder.id, name: item.folder.name || t('levels.section') }]);
      }
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !currentProjectId) return;
    await createFolder({
      variables: {
        projectId: currentProjectId,
        name: newFolderName,
        parentId: currentFolderId || newFolderParentId || null,
      }
    });
  };

  // Freehand select — start anywhere in grid, activate after 5px drag
  const fhRef = React.useRef({ active: false, sx: 0, sy: 0, started: false });

  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!fhRef.current.started) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ex = e.clientX - rect.left, ey = e.clientY - rect.top;
      const dx = ex - fhRef.current.sx, dy = ey - fhRef.current.sy;
      if (!fhRef.current.active && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        fhRef.current.active = true;
        setSelecting(true);
      }
      if (fhRef.current.active) {
        setSelectRect({ x1: fhRef.current.sx, y1: fhRef.current.sy, x2: ex, y2: ey });
      }
    };
    const onUp = () => {
      if (!fhRef.current.started) return;
      fhRef.current.started = false;
      if (!fhRef.current.active) { setSelecting(false); setSelectRect(null); return; }
      fhRef.current.active = false;
      setSelecting(false);
      // Get current rect from DOM position
      setSelectRect(prev => {
        if (!prev) return null;
        const sx = Math.min(prev.x1, prev.x2), sy = Math.min(prev.y1, prev.y2);
        const ex = Math.max(prev.x1, prev.x2), ey = Math.max(prev.y1, prev.y2);
        if (Math.abs(ex - sx) < 10 && Math.abs(ey - sy) < 10) return null;
        const cards = gridRef.current?.querySelectorAll('[data-card]');
        if (!cards) return null;
        const gr = gridRef.current!.getBoundingClientRect();
        const nf = new Set<string>(), nd = new Set<string>();
        cards.forEach(card => {
          const cr = card.getBoundingClientRect();
          const cx = cr.left - gr.left + cr.width / 2, cy = cr.top - gr.top + cr.height / 2;
          if (cx >= sx && cx <= ex && cy >= sy && cy <= ey) {
            const fid = card.getAttribute('data-file-id');
            const foid = card.getAttribute('data-folder-id');
            if (fid) nf.add(fid); if (foid) nd.add(foid);
          }
        });
        if (nf.size > 0 || nd.size > 0) { setSelectedFileIds(nf); setSelectedFolderIds(nd); }
        return null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const handleGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't intercept clicks on draggable cards — let native HTML5 drag handle them
    if ((e.target as HTMLElement).closest('[data-card]')) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault(); // block native HTML5 drag on cards
    fhRef.current = { started: true, active: false, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  // DnD handlers
  const handleDragStartFile = (e: React.DragEvent, id: string) => {
    setDragItem({ type: "file", id });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData('application/x-mam-file-id', id);
  };

  const handleDragStartFolder = (e: React.DragEvent, id: string) => {
    setDragItem({ type: "folder", id });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData('application/x-mam-folder-id', id);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDragOverFolderId(null);
    setDragOverKind(null);
  };

  // ===== Story 2.17: sorotan seret (`drag-over`) =====
  // Satu tempat yang memutuskan APAKAH sebuah Section menerima drop, dan
  // dengan kalimat apa. Role yang tidak boleh upload/memindahkan tidak
  // pernah memanggil preventDefault, jadi tidak ada sorotan DAN tidak ada
  // drop yang diterima — bukan sekadar disembunyikan.
  const dragIsFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes("Files");

  const handleSectionDragOver = (e: React.DragEvent, folderId: string) => {
    const files = dragIsFiles(e);
    if (files ? !canUpload : !canMove) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = files ? "copy" : "move";
    setDragOverFolderId(folderId);
    setDragOverKind(files ? "files" : "item");
  };

  const handleSectionDragLeave = (e: React.DragEvent, folderId: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverFolderId((prev) => (prev === folderId ? null : prev));
  };

  /** Kalimat chip tujuan; selalu tertulis, tidak pernah warna saja. */
  const dragOverChipLabel = (folderName: string): string | null => {
    if (dragOverKind === "files") {
      // Story 4.3 (key-upload 02a): OS files dropped on a Section card upload into it.
      const { number, title } = parseSectionName(folderName);
      return t('drag.uploadTo', { target: `${number ? `NO ${number} ` : ""}${title}` });
    }
    if (dragOverKind === "item") {
      const { number, title } = parseSectionName(folderName);
      return t('drag.moveTo', { target: `${number ? `NO ${number} ` : ""}${title}` });
    }
    return null;
  };


  // Build multi-select items for move/copy
  const buildMoveCopyItems = (clickedType: 'file' | 'folder', clickedId: string, clickedName: string): { type: 'file' | 'folder'; id: string; name: string }[] => {
    const hasSelection = selectedFileIds.size + selectedFolderIds.size > 0;
    const clickedIsSelected = clickedType === 'file' ? selectedFileIds.has(clickedId) : selectedFolderIds.has(clickedId);
    if (hasSelection && clickedIsSelected) {
      const items: { type: 'file' | 'folder'; id: string; name: string }[] = [];
      selectedFileIds.forEach(id => {
        const f = files.find((x: any) => x.id === id);
        if (f) items.push({ type: 'file', id, name: f.originalName });
      });
      selectedFolderIds.forEach(id => {
        const f = folders.find((x: any) => x.id === id);
        if (f) items.push({ type: 'folder', id, name: f.name });
      });
      return items;
    }
    return [{ type: clickedType, id: clickedId, name: clickedName }];
  };

  // Story 3.3 — `context-menu`: item dirakit SEKALI di sini lalu dipakai
  // tiga jalur pembuka yang setara (klik-kanan, Shift+F10/tombol Menu,
  // dan tombol "⋯"). Gerbang role datang dari `lib/permissions.ts`, dan
  // aksi yang tidak boleh untuk sebuah role TIDAK DIRENDER — bukan
  // dinonaktifkan.
  const fileMenu = (file: any): { target: ActionMenuTarget; entries: ActionMenuEntry[] } => {
    const entries: ActionMenuEntry[] = [
      {
        kind: "item",
        id: "preview",
        label: t('menu.preview'),
        icon: MenuIcon.preview,
        onSelect: () => openFile(file),
      },
    ];

      entries.push(
        {
          kind: "item",
          id: "fast",
          label: t('menu.fastDownload'),
          icon: MenuIcon.fast,
          onSelect: () => parallelDownload(file.id, file.originalName, file.mimeType),
        },
        {
          kind: "item",
          id: "download",
          label: t('menu.download'),
          icon: MenuIcon.download,
          onSelect: () => openDirectDownload(file.id),
        },
      );

    entries.push({
      kind: "item",
      id: "share",
      label: t('menu.share'),
      icon: MenuIcon.share,
      onSelect: () => handleShare(file.id, file.originalName),
    });

    // Story 2.4: Share is rendered only with share.manage.
    if (!canShare) {
      const at = entries.findIndex((e) => e.id === "share");
      if (at >= 0) entries.splice(at, 1);
    }
    if (canMove) {
      entries.push(
        { kind: "separator", id: "sep-move" },
        {
          kind: "item",
          id: "move",
          label: t('menu.moveTo'),
          icon: MenuIcon.move,
          onSelect: () =>
            setMoveCopyModal({ mode: "move", items: buildMoveCopyItems("file", file.id, file.originalName) }),
        },
        {
          kind: "item",
          id: "copy",
          label: t('menu.copyTo'),
          icon: MenuIcon.copy,
          onSelect: () =>
            setMoveCopyModal({ mode: "copy", items: buildMoveCopyItems("file", file.id, file.originalName) }),
        },
      );
    }
    if (canManageTrash) {
      entries.push(
        { kind: "separator", id: "sep-trash" },
        {
          kind: "item",
          id: "trash",
          label: t('menu.trash'),
          icon: MenuIcon.trash,
          hint: t('menu.days30'),
          danger: true,
          onSelect: () => setConfirmTrash({ fileId: file.id, name: file.originalName }),
        },
      );
    }

    return {
      target: {
        kindLabel: t('levels.file'),
        name: file.originalName,
        meta: fileMetaLine(file),
        thumb: (
          <RepThumb
            variant="file"
            size="sm"
            file={{ kind: mimeKind(file.mimeType), thumbnailUrl: file.thumbnailUrl }}
          />
        ),
      },
      entries,
    };
  };

  const folderMenu = (folder: any): { target: ActionMenuTarget; entries: ActionMenuEntry[] } => {
    const parsed = parseSectionName(folder.name);
    const entries: ActionMenuEntry[] = [
      {
        kind: "item",
        id: "open",
        label: t('menu.open'),
        icon: MenuIcon.open,
        onSelect: () => handleFolderClick(folder.id, folder.name),
      },
      {
        kind: "item",
        id: "share",
        label: t('menu.share'),
        icon: MenuIcon.share,
        onSelect: () =>
          setShareData({
            kind: "section",
            id: folder.id,
            name: folder.name,
            fileCount: Number(folder.totalFiles) || 0,
            parentName: currentProjectTitle ?? null,
            repFiles: folder.repFiles ?? null,
          }),
      },
    ];
    // Story 2.4: Share is rendered only with share.manage.
    if (!canShare) {
      const at = entries.findIndex((e) => e.id === "share");
      if (at >= 0) entries.splice(at, 1);
    }
    if (canMove) {
      entries.push(
        { kind: "separator", id: "sep-admin" },
        {
          kind: "item",
          id: "rename",
          label: t('menu.rename'),
          icon: MenuIcon.rename,
          onSelect: () => {
            setRenameFolderData({ id: folder.id, name: folder.name });
            setRenameFolderName(folder.name);
          },
        },
        {
          kind: "item",
          id: "move",
          label: t('menu.moveTo'),
          icon: MenuIcon.move,
          onSelect: () =>
            setMoveCopyModal({ mode: "move", items: buildMoveCopyItems("folder", folder.id, folder.name) }),
        },
      );
    }
    if (canManageTrash) {
      entries.push(
        { kind: "separator", id: "sep-trash" },
        {
          kind: "item",
          id: "trash",
          label: t('menu.trash'),
          icon: MenuIcon.trash,
          hint: t('menu.days30'),
          danger: true,
          onSelect: () => setConfirmTrash({ folderId: folder.id, name: folder.name }),
        },
      );
    }
    return {
      target: {
        kindLabel: t('levels.section'),
        name: parsed.number ? `NO ${parsed.number} ${parsed.title}` : parsed.title,
        meta: sectionMetaLine(folder),
        thumb: <RepThumb variant="section" size="sm" repFiles={folder.repFiles} />,
      },
      entries,
    };
  };

  const projectMenu = (project: any): { target: ActionMenuTarget; entries: ActionMenuEntry[] } => {
    const entries: ActionMenuEntry[] = [
      {
        kind: "item",
        id: "open",
        label: t('menu.open'),
        icon: MenuIcon.open,
        onSelect: () => handleProjectClick(project.id, project.title),
      },
      {
        kind: "item",
        id: "share",
        label: t('menu.shareProject'),
        icon: MenuIcon.share,
        onSelect: () =>
          setShareData({
            kind: "project",
            id: project.id,
            name: project.title,
            fileCount: Number(project.totalFiles) || 0,
            sectionCount: project.folders?.length ?? null,
            repFiles: project.repFiles ?? null,
          }),
      },
    ];
    // Story 2.4: Share is rendered only with share.manage.
    if (!canShare) {
      const at = entries.findIndex((e) => e.id === "share");
      if (at >= 0) entries.splice(at, 1);
    }
    if (canMove) {
      entries.push(
        { kind: "separator", id: "sep-admin" },
        {
          kind: "item",
          id: "rename",
          label: t('menu.rename'),
          icon: MenuIcon.rename,
          onSelect: () => {
            setRenameProjectData({ id: project.id, title: project.title });
            setRenameProjectName(project.title);
          },
        },
      );
    }
    if (canPurge) {
      entries.push(
        { kind: "separator", id: "sep-danger" },
        {
          kind: "item",
          id: "delete",
          label: t('menu.deleteProject'),
          icon: MenuIcon.trash,
          hint: t('menu.permanent'),
          danger: true,
          onSelect: () => setDeleteProjectData({ id: project.id, title: project.title }),
        },
      );
    }
    return {
      target: {
        kindLabel: t('levels.project'),
        name: project.title,
        meta: projectMetaLine(project),
        thumb: <RepThumb variant="project" size="sm" repFiles={project.repFiles} />,
      },
      entries,
    };
  };

  /**
   * Titik jangkar menu. Klik-kanan memakai kursor; Shift+F10 / tombol
   * Menu tidak punya kursor (clientX/Y = 0), jadi menu dijangkarkan ke
   * kartu yang sedang fokus.
   */
  const menuAnchorFrom = (e: React.MouseEvent): { x: number; y: number } => {
    const card = e.currentTarget as HTMLElement;
    // Klik-kanan tidak memindahkan fokus dengan sendirinya. Fokuskan kartu
    // DULU supaya Esc mengembalikan fokus ke kartu itu, bukan ke <body>.
    if (!card.contains(document.activeElement)) {
      card.querySelector<HTMLElement>("a[href], button")?.focus({ preventScroll: true });
    }
    if (e.clientX > 0 || e.clientY > 0) return { x: e.clientX, y: e.clientY };
    const rect = card.getBoundingClientRect();
    return { x: rect.left + 12, y: rect.top + 12 };
  };

  const openFileMenu = (id: string, file: any, anchor: { x: number; y: number }) =>
    setActionMenu({ id, anchor, ...fileMenu(file) });
  const openFolderMenu = (id: string, folder: any, anchor: { x: number; y: number }) =>
    setActionMenu({ id, anchor, ...folderMenu(folder) });
  const openProjectMenu = (id: string, project: any, anchor: { x: number; y: number }) =>
    setActionMenu({ id, anchor, ...projectMenu(project) });

  const handleFileContextMenu = (e: React.MouseEvent, file: any) => {
    e.preventDefault();
    openFileMenu(file.id, file, menuAnchorFrom(e));
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: any) => {
    e.preventDefault();
    openFolderMenu(folder.id, folder, menuAnchorFrom(e));
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetId: string) => {
    setDragOverFolderId(null);
    setDragOverKind(null);
    // Story 4.3 (key-upload 02a): files from the computer dropped on a
    // Section card upload straight into that Section; folders inside the
    // drop become new sub-Sections of it.
    if (!dragItem && e.dataTransfer.types.includes('Files')) {
      if (!currentProjectId || !canUpload) return;
      e.preventDefault();
      e.stopPropagation();
      dropCounterRef.current = 0;
      setIsDroppingFiles(false);
      const trees = await readDropAsTrees(e.dataTransfer);
      if (!trees.length) return;
      const target = (folders as { id: string; name: string }[]).find((f) => f.id === targetId);
      const tasks: Parameters<typeof queueDropTree>[3] = [];
      for (const tree of trees) await queueDropTree(tree, targetId, currentProjectId, tasks);
      if (tasks.length) {
        setLiveMessage(t('live.readyToUpload', { count: tasks.length }));
        upload.open(
          { projectId: currentProjectId, folderId: targetId, folderName: target?.name ?? null, folderType: null },
          { tasks: tasks.map((task) => (task.targetFolderId === targetId && !task.subSectionName ? { file: task.file } : task)) },
        );
      } else if (currentFolderId) refetchFolder();
      else refetchRoot();
      return;
    }
    // Role yang tidak boleh memindahkan tidak pernah menerima drop item.
    if (!dragItem || !canMove) {
      // Allow bubbling up to the global grid for OS file drops
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // prevent bubbling to the main drop zone
    const movedCount = selectedFileIds.size + selectedFolderIds.size || 1;
    const targetName = folders.find((f: any) => f.id === targetId)?.name || t('levels.section');
    
    try {
      // Multi-select: move all selected + drag item
      const ops: Promise<any>[] = [];
      if (selectedFileIds.size > 0 || selectedFolderIds.size > 0) {
        selectedFileIds.forEach(id => ops.push(apolloClient.mutate({ mutation: MOVE_FILE, variables: { fileId: id, targetFolderId: targetId } })));
        selectedFolderIds.forEach(id => { if (id !== targetId) ops.push(apolloClient.mutate({ mutation: MOVE_FOLDER, variables: { folderId: id, targetFolderId: targetId } })); });
      } else if (dragItem) {
        if (dragItem.type === "file") ops.push(moveFile({ variables: { fileId: dragItem.id, targetFolderId: targetId } }));
        else if (dragItem.type === "folder" && dragItem.id !== targetId) ops.push(moveFolder({ variables: { folderId: dragItem.id, targetFolderId: targetId } }));
      }
      if (ops.length > 0) await Promise.all(ops);
      clearSelection();
      // Story 2.17: hasil drop diumumkan lewat live region polite.
      setLiveMessage(
        t('live.moved', { count: movedCount, target: parseSectionName(targetName).title }),
      );
    } catch (err: any) {
      // Story 4.5: a toast with the code's message; the items stay where they are.
      pushSpineToast({ tone: 'error', message: t('toasts.moveFailed'), cause: humanize(err) });
    }
    setDragItem(null);
    if (currentFolderId) refetchFolder();
    else if (currentProjectId) refetchRoot();
  };

  // Walk dropped trees: create folders via mutation, queue files with target
  const queueDropTree = async (
    node: DropNode,
    parentFolderId: string | null,
    targetProjectId: string,
    tasks: any[],
    // Story 3.13: nama sub-Section baru ikut dibawa supaya barisnya bisa
    // memakai chip "Sub-Section baru: {nama}".
    subSectionName?: string,
  ): Promise<void> => {
    if (node.type === 'file') {
      if (parentFolderId) {
        tasks.push({ file: node.file, progress: 0, status: 'pending', targetFolderId: parentFolderId, subSectionName });
      }
      return;
    }
    let newId: string | null = parentFolderId;
    try {
      const res = await apolloClient.mutate({
        mutation: CREATE_FOLDER,
        variables: { projectId: targetProjectId, name: node.name, parentId: parentFolderId },
      });
      if (res.data?.createFolder?.id) newId = res.data.createFolder.id;
    } catch (err: any) {
      console.error(`Failed to create folder "${node.name}":`, err?.message);
    }
    for (const child of node.children) await queueDropTree(child, newId, targetProjectId, tasks, node.name);
  };

  const handleOSDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    if (!currentProjectId || !canUpload) return;
    e.preventDefault();
    e.stopPropagation();
    dropCounterRef.current = 0;
    setIsDroppingFiles(false);

    const trees = await readDropAsTrees(e.dataTransfer);
    if (trees.length === 0) return;

    // At project root, dropping loose files (no folders) → ask user to pick a destination folder
    const allFiles = trees.every(t => t.type === 'file');
    if (allFiles && !currentFolderId) {
      const files = trees.map(t => (t as any).file as File);
      setProjectRootPickerFiles(files);
      return;
    }

    const tasks: any[] = [];
    for (const tree of trees) {
      await queueDropTree(tree, currentFolderId, currentProjectId, tasks);
    }

    if (tasks.length > 0) {
      // Story 2.17: hasil drop diumumkan lewat live region polite.
      setLiveMessage(t('live.readyToUpload', { count: tasks.length }));
      upload.open(
        {
          projectId: currentProjectId,
          folderId: currentFolderId || tasks[0]?.targetFolderId || '',
          folderName: folderData?.folder?.name ?? null,
          folderType: folderData?.folder?.folderType ?? null,
        },
        { tasks },
      );
    } else {
      // Only folders created, no files — refresh to show them
      if (currentFolderId) refetchFolder();
      else refetchRoot();
    }
  };

  // Story 3.14: panel upload hidup di layout, jadi "Done" dan "Pilih
  // Section lain" sampai ke halaman ini lewat peristiwa, bukan prop.
  useEffect(() => {
    const onDone = () => {
      if (currentFolderId) refetchFolder();
      else if (currentProjectId) refetchRoot();
    };
    const onPick = () => setProjectRootPickerFiles([]);
    window.addEventListener("mam:upload-done", onDone);
    window.addEventListener("mam:upload-pick-section", onPick);
    return () => {
      window.removeEventListener("mam:upload-done", onDone);
      window.removeEventListener("mam:upload-pick-section", onPick);
    };
  }, [currentFolderId, currentProjectId, refetchFolder, refetchRoot]);

  const isLoading = currentFolderId ? folderLoading : (currentProjectId ? rootLoading : projectsLoading);

  // Story 2.8: gagal memuat = error-box "Gagal memuat. Coba lagi." di dalam
  // role="alert". Objek error Apollo TIDAK PERNAH ditampilkan — teks server
  // mentah ("Failed to fetch", "HTTP 502") tidak boleh sampai ke pengguna.
  const loadError = currentFolderId ? folderError : (currentProjectId ? rootError : projectsError);
  const retryLoad = React.useCallback(() => {
    if (currentFolderId) refetchFolder();
    else if (currentProjectId) refetchRoot();
    else refetchProjects();
  }, [currentFolderId, currentProjectId, refetchFolder, refetchRoot, refetchProjects]);

  const rawProjects = currentProjectId === null ? projectsData?.projects || [] : [];
  const rawFolders = currentFolderId ? folderData?.folder?.children || [] : rootData?.project?.folders || [];
  const rawFiles = currentFolderId ? folderData?.folder?.files || [] : [];

  // Natural sort: "10. Raudhah" sorts after "9. Orientasi", not after "1. Kedatangan"
  // Story 4.5: one collator for every comparison (localeCompare with options
  // builds a new one per call, far too slow for a 10,000-file Section).
  const collator = React.useMemo(
    () => new Intl.Collator(f.locale, { numeric: true, sensitivity: "base" }),
    [f.locale],
  );
  const naturalCompare = (a: string, b: string) => collator.compare(a || "", b || "");

  // Sort
  // Story 2.15: kepala kolom mode daftar memakai keadaan urut BERSAMA ini,
  // jadi kolom "Isi" (= jumlah file) harus benar-benar mengurutkan —
  // dipetakan ke field `size` yang sama dengan pill "Ukuran".
  const folders = React.useMemo(() => {
    const arr = [...rawFolders];
    arr.sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy === "name") cmp = naturalCompare(a.name, b.name);
      else if (sortBy === "date") cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      else if (sortBy === "size") cmp = (Number(a.totalFiles) || 0) - (Number(b.totalFiles) || 0);
      if (!sortAsc) cmp = -cmp;
      return cmp;
    });
    return arr;
  }, [rawFolders, sortBy, sortAsc, collator]);

  const projects = React.useMemo(() => {
    const arr = [...rawProjects];
    arr.sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy === "name") cmp = naturalCompare(a.title, b.title);
      else if (sortBy === "date") cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      else if (sortBy === "size") cmp = (Number(a.totalFiles) || 0) - (Number(b.totalFiles) || 0);
      if (!sortAsc) cmp = -cmp;
      return cmp;
    });
    return arr;
  }, [rawProjects, sortBy, sortAsc, collator]);

  const files = React.useMemo(() => {
    const arr = [...rawFiles];
    arr.sort((a: any, b: any) => {
      let cmp = 0;
      if (sortBy === "name") cmp = naturalCompare(a.originalName, b.originalName);
      else if (sortBy === "date") cmp = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      else if (sortBy === "size") cmp = (Number(a.size) || 0) - (Number(b.size) || 0);
      else if (sortBy === "type") cmp = collator.compare(a.mimeType || "", b.mimeType || "");
      if (!sortAsc) cmp = -cmp;
      return cmp;
    });
    return arr;
  }, [rawFiles, sortBy, sortAsc, collator]);


  /* ------------------------------------------------------------------ */
  /* Story 3.5 — `file-viewer`                                           */
  /* ------------------------------------------------------------------ */

  /** Urutan prev/next = urutan yang SEDANG TAMPIL, disaring ke foto & video.
      Dokumen tidak pernah masuk urutan ini. */
  const viewerFiles = React.useMemo(
    () => files.filter((f: any) => /^(image|video)\//.test(f.mimeType || "")),
    [files],
  );
  // Story 4.4: processed versions of the file open in the viewer.
  const { data: versionData, refetch: refetchVersions } = useQuery(FILE_VERSIONS, {
    skip: !previewFile?.id,
    variables: { fileId: previewFile?.id ?? "" },
    fetchPolicy: "cache-and-network",
  });

  /* Story 5.4-5.5: jobs live. Job changes of this Project arrive through the
     shared `projectEvents` stream (already permission-checked per event and
     ordered by seq); the newest view of each file's job wins over the
     folder query's `currentJob`. A finished proxy refreshes the viewer's
     version list. */
  const [liveJobs, setLiveJobs] = useState<Record<string, UiJob>>({});
  const applyJob = React.useCallback((job: UiJob) => {
    setLiveJobs((prev) => {
      const current = prev[job.fileId];
      const next = newerJob(current, job);
      return next === current || !next ? prev : { ...prev, [job.fileId]: next };
    });
  }, []);
  React.useEffect(() => setLiveJobs({}), [currentProjectId]);
  // A refetched folder is the truth for its files: seed the seq gate with
  // its jobs and drop live overrides it supersedes (a different job, or the
  // same job at the same or a newer seq), so a stale chip cannot stick.
  React.useEffect(() => {
    const list = (folderData?.folder?.files ?? []) as { id: string; currentJob?: UiJob | null }[];
    for (const f of list) if (f.currentJob) noteProjectSeq(currentProjectId, "job.updated", f.currentJob.id, f.currentJob.seq);
    // After this render (the folder result is already on screen).
    queueMicrotask(() => setLiveJobs((prev) => {
      let next: Record<string, UiJob> | null = null;
      for (const f of list) {
        const live = prev[f.id];
        if (!live) continue;
        const fetched = f.currentJob ?? null;
        if (!fetched || fetched.id !== live.id || fetched.seq >= live.seq) {
          next ??= { ...prev };
          delete next[f.id];
        }
      }
      return next ?? prev;
    }));
  }, [folderData, currentProjectId]);
  useProjectEvents(currentProjectId, (event) => {
    if (event.type === "resync") {
      if (currentFolderId) void refetchFolder();
      if (previewFile?.id) void refetchVersions();
      return;
    }
    if (event.type !== "job.updated" || !event.job) return;
    applyJob(event.job);
    if (event.job.state === "done" && previewFile?.id === event.job.fileId) void refetchVersions();
  });
  useRealtimeReconnect(() => {
    if (currentFolderId) void refetchFolder();
  });
  const jobOfFile = (f: { id?: string; currentJob?: UiJob | null } | null | undefined): UiJob | null =>
    newerJob(f?.currentJob ?? null, (f?.id && liveJobs[f.id]) || null);
  const versionKindLabel = useKindLabel();
  const viewerFilesWithVersions = React.useMemo(() => {
    const versions = versionData?.processedVersions;
    if (!previewFile || !versions) return viewerFiles;
    return viewerFiles.map((f: any) => (f.id === previewFile.id ? { ...f, processedVersions: versions } : f));
  }, [viewerFiles, previewFile, versionData]);
  const viewerIndex = previewFile
    ? viewerFiles.findIndex((f: any) => f.id === previewFile.id)
    : -1;

  // Story 2.2: media bytes ride the HttpOnly `shotstash_session` cookie; no token in any URL.
  // Story 4.4: a HEIC original is shown through its JPEG preview version.
  const inlineSrcOf = (f: any) => f.previewUrl || mediaUrl.inline(f.id);

  const currentProjectTitle =
    (currentFolderId ? folderData?.folder?.project?.title : rootData?.project?.title) ||
    folderHistory[0]?.name ||
    null;
  const currentFolderName = currentFolderId ? folderData?.folder?.name ?? null : null;

  /**
   * Membuka file dari grid / daftar. Foto & video → `file-viewer`;
   * dokumen dan audio memakai JALUR YANG ADA SEKARANG (unduh/buka), tidak
   * pernah masuk viewer (AC 3.5).
   */
  const openFile = (f: any) => {
    if (/^(image|video)\//.test(f?.mimeType || "")) setPreviewFile(f);
    else openDirectDownload(f.id);
  };


  
  // Handlers
  const handleProjectClick = (id: string, title: string) => {
    setCurrentProjectId(id);
    setFolderHistory([{ id: 'root', name: title }]);
    setCurrentFolderId(null);
    clearSelection();
  };

  const handleFolderClick = (id: string, name: string) => {
    setFolderHistory(prev => [...prev, { id, name }]);
    setCurrentFolderId(id);
    clearSelection();
  };

  const handleBack = () => {
    if (folderHistory.length === 1) {
      // Go back to projects
      setCurrentProjectId(null);
      setCurrentFolderId(null);
      setFolderHistory([]);
    } else {
      const newHistory = [...folderHistory];
      newHistory.pop(); // remove current
      setFolderHistory(newHistory);
      const prev = newHistory[newHistory.length - 1];
      setCurrentFolderId(prev.id === 'root' ? null : prev.id);
    }
    clearSelection();
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectTitle.trim()) return;
    await createProject({
      variables: {
        input: {
          title: newProjectTitle,
          description: newProjectDesc || undefined,
          coverImage: newProjectCover || undefined,
        }
      }
    });
  };

  // Story 3.8: meta baris identitas varian file — "{jenis} · {ukuran} ·
  // {Section induk}". Berkasnya dicari di daftar yang sedang tampil.
  const handleShare = (id: string, title: string) => {
    const file = files.find((x: any) => x.id === id);
    const kindWord = file ? kindLabel(t, file.mimeType) : t('kind.file');
    setShareData({
      kind: "file",
      id,
      name: title,
      kindLabel: kindWord,
      sizeText: file ? f.fileSize(Number(file.size) || 0) : null,
      parentName: currentFolderName ?? currentProjectTitle ?? null,
      file: file
        ? {
            kind: determineType(file.mimeType),
            thumbnailUrl: file.thumbnailUrl ?? null,
            extension: (file.originalName?.split(".").pop() || null) as string | null,
          }
        : null,
    });
  };

  const toggleFolderSelect = (id: string, idx: number, e?: React.MouseEvent) => {
    setBulkResult(null);
    lastTouchedRef.current = { type: "folder", id };
    if (e?.shiftKey && lastClickedFolderIdx !== null) {
      const start = Math.min(lastClickedFolderIdx, idx);
      const end = Math.max(lastClickedFolderIdx, idx);
      const next = new Set(selectedFolderIds);
      for (let i = start; i <= end; i++) {
        if (folders[i]) next.add(folders[i].id);
      }
      setSelectedFolderIds(next);
      return;
    }
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFolderIds(next);
    setLastClickedFolderIdx(idx);
  };

  const toggleFileSelect = (id: string, idx: number, e?: React.MouseEvent) => {
    setBulkResult(null);
    lastTouchedRef.current = { type: "file", id };
    if (e?.shiftKey && lastClickedFileIdx !== null) {
      const start = Math.min(lastClickedFileIdx, idx);
      const end = Math.max(lastClickedFileIdx, idx);
      const next = new Set(selectedFileIds);
      for (let i = start; i <= end; i++) {
        if (files[i]) next.add(files[i].id);
      }
      setSelectedFileIds(next);
      return;
    }
    const next = new Set(selectedFileIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedFileIds(next);
    setLastClickedFileIdx(idx);
  };

  const toggleSelectAll = () => {
    setBulkResult(null);
    const allSel = selectedFolderIds.size + selectedFileIds.size === folders.length + files.length && folders.length + files.length > 0;
    if (allSel) { clearSelection(); return; }
    setSelectedFolderIds(new Set(folders.map((f: any) => f.id)));
    setSelectedFileIds(new Set(files.map((f: any) => f.id)));
  };

  const clearSelection = () => {
    setSelectedFolderIds(new Set());
    setSelectedFileIds(new Set());
    setLastClickedFolderIdx(null);
    setLastClickedFileIdx(null);
    setBulkResult(null);
  };

  const hasSelection = selectedFolderIds.size > 0 || selectedFileIds.size > 0;
  const totalSelected = selectedFolderIds.size + selectedFileIds.size;

  // ===== Story 2.13: keadaan `bulk-bar` =====
  // Kalimat hasil campuran/gagal MENGGANTIKAN kalimat jumlah di tempat yang
  // sama, jadi pengguna bisa langsung menekan aksi yang sama lagi untuk sisa
  // yang masih terpilih. Dikosongkan setiap kali pilihan berubah.
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  // Story 4.5: per-item reasons of a partly failed bulk Trash, shown in a Dialog.
  const [bulkReasons, setBulkReasons] = useState<string[] | null>(null);
  // Item terakhir yang disentuh — Esc di dalam `bulk-bar` mengembalikan
  // fokus ke sana, bukan ke awal halaman.
  const lastTouchedRef = useRef<{ type: "file" | "folder"; id: string } | null>(null);

  const focusLastTouched = () => {
    const last = lastTouchedRef.current;
    if (!last) return;
    const selector =
      last.type === "file"
        ? `[data-file-id="${CSS.escape(last.id)}"] button, [data-file-id="${CSS.escape(last.id)}"] a`
        : `[data-folder-id="${CSS.escape(last.id)}"] a, [data-folder-id="${CSS.escape(last.id)}"] button`;
    document.querySelector<HTMLElement>(selector)?.focus();
  };

  // "{n} dipilih" diumumkan setiap kali JUMLAHNYA berubah, bukan per klik.
  const lastAnnouncedCountRef = useRef<number>(0);
  React.useEffect(() => {
    if (totalSelected === lastAnnouncedCountRef.current) return;
    lastAnnouncedCountRef.current = totalSelected;
    if (totalSelected > 0) setLiveMessage(t('live.selected', { count: totalSelected }));
  }, [totalSelected, t]);

  // Kata benda jumlah mengikuti tingkat yang sedang dibuka.
  const bulkNoun =
    selectedFolderIds.size > 0 && selectedFileIds.size === 0
      ? "Section"
      : selectedFileIds.size > 0 && selectedFolderIds.size === 0
        ? "file"
        : "item";

  const [dlProgress, setDlProgress] = useState<{ pct: number; active: boolean }>({ pct: 0, active: false });

  const openDirectDownload = (fileId: string) => {
    window.open(mediaUrl.download(fileId), "_blank");
  };

  const parallelDownload = async (fileId: string, filename: string, mimeType?: string) => {
    const PARTS = 4;
    setDlProgress({ pct: 0, active: true });
    try {
      // Head request to get file size
      const headRes = await fetch(mediaUrl.download(fileId), { method: 'HEAD', credentials: 'same-origin' });
      const totalSize = parseInt(headRes.headers.get('Content-Length') || '0');

      if (totalSize < 5 * 1024 * 1024 || !headRes.headers.get('Accept-Ranges')) {
        // Small file or no range support — fallback to direct download
        setDlProgress({ pct: 100, active: false });
        openDirectDownload(fileId)
        return;
      }

      const chunkSize = Math.ceil(totalSize / PARTS);
      const chunks: { index: number; data: Uint8Array }[] = [];

      // Fetch chunks in parallel
      const results = await Promise.all(
        Array.from({ length: PARTS }, async (_, i) => {
          const start = i * chunkSize;
          const end = i === PARTS - 1 ? totalSize - 1 : start + chunkSize - 1;
          const res = await fetch(mediaUrl.download(fileId), {
            headers: { Range: `bytes=${start}-${end}` },
            credentials: 'same-origin',
          });
          if (res.status !== 206) throw new Error(`range ${res.status}`);
          const buf = new Uint8Array(await res.arrayBuffer());
          setDlProgress((p) => ({ ...p, pct: Math.min(100, p.pct + Math.round(100 / PARTS)) }));
          return { index: i, data: buf };
        })
      );

      // Merge in order
      results.sort((a, b) => a.index - b.index);
      const merged = new Blob(results.map((c) => c.data));
      const url = URL.createObjectURL(merged);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDlProgress({ pct: 100, active: false });
    } catch (err) {
      // Fallback to direct download
      openDirectDownload(fileId)
      setDlProgress({ pct: 0, active: false });
    }
  };

  /**
   * Story 2.13 — aksi massal "Trash" dengan KEGAGALAN SEBAGIAN.
   * Item yang berhasil dilepas dari pilihan; item yang gagal TIDAK dilepas
   * dan tidak berpindah tempat, sehingga aksi yang sama bisa langsung
   * ditekan lagi untuk sisa itu saja. Story 4.5: the reason per item is
   * listed in a Dialog (no `alert()`).
   */
  const runBulkTrash = async () => {
    const fileIds = Array.from(selectedFileIds);
    const folderIds = Array.from(selectedFolderIds);
    const total = fileIds.length + folderIds.length;
    if (total === 0) return;

    const failedFiles = new Set<string>();
    const failedFolders = new Set<string>();
    const reasons: string[] = [];

    const run = async (id: string, isFolder: boolean) => {
      try {
        const res = await apolloClient.mutate({
          mutation: isFolder ? MOVE_FOLDER_TO_TRASH : MOVE_TO_TRASH,
          variables: isFolder ? { folderId: id } : { fileId: id },
        });
        const ok = isFolder ? res.data?.moveFolderToTrash : res.data?.moveToTrash;
        if (!ok) throw new Error("rejected by server");
        const cacheId = apolloClient.cache.identify({
          __typename: isFolder ? "Folder" : "MediaFile",
          id,
        });
        if (cacheId) apolloClient.cache.evict({ id: cacheId });
      } catch (err: any) {
        if (isFolder) failedFolders.add(id);
        else failedFiles.add(id);
        const name = isFolder
          ? folders.find((f: any) => f.id === id)?.name
          : files.find((f: any) => f.id === id)?.originalName;
        reasons.push(t('bulk.reason', { name: name || id, cause: humanize(err) }));
      }
    };

    await Promise.all([
      ...fileIds.map((id) => run(id, false)),
      ...folderIds.map((id) => run(id, true)),
    ]);
    apolloClient.cache.gc();

    const failedCount = failedFiles.size + failedFolders.size;
    setSelectedFileIds(failedFiles);
    setSelectedFolderIds(failedFolders);

    let message: string | null = null;
    if (failedCount === 0) {
      message = null;
      setBulkResult(null);
    } else if (failedCount === total) {
      message = t('bulk.failedAll', { count: failedCount });
      setBulkResult(message);
    } else {
      message = t('bulk.failedSome', { failed: failedCount, total });
      setBulkResult(message);
    }
    // Kalimat hasil diumumkan SEKALI lewat live region polite.
    if (message) setLiveMessage(message);
    if (reasons.length) setBulkReasons(reasons);

    if (currentFolderId) refetchFolder();
    else if (currentProjectId) refetchRoot();
    else refetchProjects();
  };

  const handleDownloadZip = () => {
    if (!hasSelection || !currentProjectId) return;
    
    const params = new URLSearchParams();
    params.append('projectId', currentProjectId);
    
    if (selectedFolderIds.size === 1 && selectedFileIds.size === 0) {
      params.append('folderId', Array.from(selectedFolderIds)[0]);
    } else {
      const fIds = Array.from(selectedFileIds).join(',');
      if (fIds) {
         params.append('fileIds', fIds);
      } else {
         pushSpineToast({ tone: 'success', message: t('toasts.zipOneSection') });
         params.append('folderId', Array.from(selectedFolderIds)[0]);
      }
    }

    window.open(`/media/z?${params.toString()}`, '_blank');
    clearSelection();
  };

  const determineType = (mimeType: string) => {
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  };


  // ===== Story 2.5: satu keadaan urut untuk ketiga tingkat =====
  // { sortBy, sortAsc } di atas adalah SATU-SATUNYA sumber urutan: grid,
  // mode daftar, dan sort-pills memanggil handler yang sama, jadi berpindah
  // mode tidak pernah mengubah urutan. Klik pill yang sedang aktif membalik
  // arah (perilaku sekarang); pill baru mulai dari turun.
  const handleSortChange = (field: typeof sortBy) => {
    const nextAsc = sortBy === field ? !sortAsc : false;
    setSortAsc(nextAsc);
    setSortBy(field);
    // Story 2.15: perubahan urutan diumumkan SEKALI lewat live region polite
    // tanpa memindahkan fokus dari kepala kolom / pill yang ditekan.
    setLiveMessage(
      t('live.sorted', { field: t(`sort.${field}`), dir: nextAsc ? "asc" : "desc" }),
    );
  };

  // Mode pilih (label yang membawa keadaan, tanpa aria-pressed). Keluar mode
  // = "Batal": pilihan dikosongkan seperti tombol Batal di bulk-bar.
  const toggleSelectMode = () => {
    const next = !selectMode;
    setSelectMode(next);
    if (!next) clearSelection();
    setLiveMessage(next ? t('live.selectOn') : t('live.selectOff'));
  };

  // ===== Isi page-head per tingkat (dirakit sekali di sini) =====
  const safeDate = (value: any): string => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : f.date(d);
  };
  const pageTitle =
    currentProjectId === null
      ? t('levels.projects')
      : currentFolderId
        ? folderData?.folder?.name || t('levels.section')
        : rootData?.project?.title || t('levels.project');
  const pageSection = currentProjectId !== null && currentFolderId ? parseSectionName(pageTitle) : null;
  const backLabel =
    folderHistory.length > 1 ? folderHistory[folderHistory.length - 2].name : t('levels.projects');
  const totalFilesAllProjects = projects.reduce(
    (sum: number, p: any) => sum + (p.totalFiles || 0),
    0,
  );
  const sectionCount = (rootData?.project?.folders || []).length;
  const projectFileCount = rootData?.project?.totalFiles || 0;
  const projectDate = safeDate(rootData?.project?.createdAt);
  const folderFileCount = folderData?.folder?.totalFiles || 0;
  const folderDate = safeDate(folderData?.folder?.createdAt);
  // Rincian isi Section dari contentSummary Story 2.4 (foto → video →
  // dokumen, ember 0 tidak ditulis); di < 900 px rincian ini disembunyikan
  // CSS sehingga sub-judul menyusut jadi "{n} file · {tanggal}".
  const folderContentParts = f.contentParts(folderData?.folder?.contentSummary);

  // Story 2.16: keadaan runtime mode daftar. Urutannya penting — memuat dan
  // gagal menang atas kosong, dan "tanpa hasil" hanya dipakai saat ada kata
  // yang sedang dicari (kalimatnya menyebut kata itu).
  const listItemCount =
    currentProjectId === null ? projects.length : folders.length + files.length;
  const listState: "ready" | "loading" | "error" | "empty" | "no-results" = isLoading
    ? "loading"
    : loadError
      ? "error"
      : listItemCount > 0
        ? "ready"
        : searchQuery.trim().length > 0
          ? "no-results"
          : "empty";

  return (
    <div
      className={styles.dashboardContainer}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files') && currentProjectId && canUpload) {
          e.preventDefault();
          dropCounterRef.current++;
          setIsDroppingFiles(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files') && currentProjectId && canUpload) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dropCounterRef.current--;
          if (dropCounterRef.current <= 0) {
            dropCounterRef.current = 0;
            setIsDroppingFiles(false);
          }
        }
      }}
      onDrop={handleOSDrop}
      style={{
        position: 'relative',
        // Ensure container fills the mainContent area so empty space below
        // folders still catches drop events
        minHeight: 'calc(100vh - 80px - 80px)',
      }}
    >
      {/* Story 2.17: `drag-over` area konten — MENGGANTIKAN overlay
          "📥 Drop to upload → {folder}". Lapisan scrim-85 ber-radius xl,
          dashed accent-2 outline inset, a 64px accent circle, and a large label
          yang MENYEBUT tujuannya. Tidak pernah warna saja. */}
      {isDroppingFiles && currentProjectId && canUpload && (
        <div className={styles.dropArea} aria-hidden="true">
          <span className={styles.dropCircle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
            </svg>
          </span>
          <span className={`spine-display-panel-mobile ${styles.dropLabel}`}>
            {currentFolderId
              ? (() => {
                  const target = parseSectionName(folderData?.folder?.name || "").title;
                  return target ? t('drag.uploadTo', { target }) : t('drag.uploadHere');
                })()
              : t('drag.pickSection')}
          </span>
        </div>
      )}

      {/* ===== Story 2.5: page-head — back-pill DI ATAS judul (mock
           key-file-grid), judul display + chip jumlah, lalu sub-judul
           per tingkat. Tombol aksi tetap seperti sekarang. ===== */}
      <div className={styles.pageHead}>
        <div className={styles.pageHeadMain}>
          {currentProjectId !== null && (
            <button
              type="button"
              className={`${styles.backPill} spine-hit-area spine-focus-ring`}
              onClick={handleBack}
            >
              <span aria-hidden="true">←</span>
              <span className={styles.backPillLabel}>{backLabel}</span>
            </button>
          )}

          <h1 className={`${styles.pageTitle} spine-display-page`}>
            {/* Story 4.5 (key-file-grid): a numbered Section shows its number
                as the accent sticker before the title, like its card. */}
            {pageSection?.number ? (
              <span className={`spine-display-label ${styles.titleSticker}`}>
                <small aria-hidden="true">{tc('numberPrefix')}</small>
                <span className="spine-visually-hidden">{tc('number')} </span>
                {pageSection.number}
              </span>
            ) : null}
            <span className={styles.pageTitleText}>{pageSection ? pageSection.title : pageTitle}</span>
            {currentProjectId === null ? (
              projects.length > 0 && <TagPill>{tn('projects', { count: projects.length })}</TagPill>
            ) : (
              <span className={`${styles.countChip} spine-chip`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  {currentFolderId ? (
                    <>
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path d="M3 15l5-5 4 4 3-3 6 6" />
                    </>
                  ) : (
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  )}
                </svg>
                {currentFolderId
                  ? tn('files', { count: folderFileCount })
                  : tn('sections', { count: sectionCount })}
              </span>
            )}
          </h1>

          <p className={`${styles.pageSub} spine-body-sub`}>
            {currentProjectId === null ? (
              <>
                {t('units.footage', { count: totalFilesAllProjects })}
                {/* Petunjuk intip: hanya perangkat ber-hover (CSS) dan
                    tidak dirender saat mode daftar (tidak ada kipas). */}
                {viewMode !== 'list' && (
                  <span className={styles.hoverHint}>
                    {' · '}{t('head.hoverHint')}
                  </span>
                )}
              </>
            ) : currentFolderId ? (
              <>
                {tn('files', { count: folderFileCount })}
                {folderContentParts.length > 0 && (
                  <span className={styles.subDetail}>{` · ${folderContentParts.join(' · ')}`}</span>
                )}
                {folderDate && ` · ${folderDate}`}
              </>
            ) : (
              <>
                {t('head.projectSub', {
                  files: tn('files', { count: projectFileCount }),
                  sections: tn('sections', { count: sectionCount }),
                })}
                {projectDate && ` · ${projectDate}`}
              </>
            )}
          </p>
        </div>

      </div>

      {/* ===== Story 2.5: baris alat — SATU baris untuk ketiga tingkat.
           Desktop: sort-pills kiri, search + Diskusi + view-toggle kanan
           (mock key-file-grid). < 900 px: baris 1 search + Diskusi,
           baris 2 view-toggle + sort-pills + "Pilih" (AC). Posisinya
           tidak berubah saat grid ↔ daftar — sort-pills dirender di
           kedua mode. ===== */}
      <div className={`${styles.toolbar} ${currentProjectId !== null ? styles.toolbarInProject : ""}`}>
        {/* sort-pills tidak dirender di tingkat Projects (perilaku sekarang) */}
        {currentProjectId !== null && (
          <div className={styles.sortPills} role="group" aria-label={t('sort.group')}>
            {SORT_FIELDS.map((field) => {
              const active = sortBy === field;
              return (
                <button
                  key={field}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.sortPill} ${active ? styles.sortPillActive : ""} spine-sort spine-focus-ring`}
                  onClick={() => handleSortChange(field)}
                >
                  {t(`sort.${field}`)}
                  {active && (
                    <>
                      <span className={styles.sortGlyph} aria-hidden="true">{sortAsc ? "▲" : "▼"}</span>
                      <span className="spine-visually-hidden">{sortAsc ? t('sort.asc') : t('sort.desc')}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.searchPill}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('toolbar.search')}
            aria-label={t('toolbar.search')}
            className={styles.searchInput}
            value={searchQuery}
            onChange={handleSearch}
          />
          {isSearching && searchQuery.trim().length >= 1 && (
            <div className={styles.searchDropdown}>
              {searchError ? (
                // Gagal ≠ kosong: daftar kosong atau "tidak ada hasil" akan
                // berbohong tentang isi arsip. Kata yang diketik tetap ada,
                // fokus tidak dipindah — "Coba lagi" mengirim ulang kata itu.
                <div className={styles.searchFailed} role="alert">
                  <span>{t('toolbar.searchFailed')}</span>
                  <button
                    type="button"
                    className={`${styles.retryBtn} spine-focus-ring`}
                    onClick={() => { refetchSearch().catch(() => {}); }}
                  >
                    {tc('retry')}
                  </button>
                </div>
              ) : searchLoading ? (
                <div className={styles.searchEmpty}>{t('toolbar.searching')}</div>
              ) : searchResults.length === 0 ? (
                <div className={styles.searchEmpty}>{t('toolbar.noResults', { query: searchQuery })}</div>
              ) : (
                searchResults.map((item: any) => (
                  <div
                    key={item.id + (item._type || '')}
                    className={styles.searchResultItem}
                    onClick={() => handleSearchResultClick(item)}
                  >
                    <span className={styles.searchResultName}>
                      {item._type === 'folder' ? '📁 ' : '📄 '}{item._type === 'folder' ? item.name : item.originalName}
                    </span>
                    <span className={styles.searchResultProject}>{item.project?.title}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {currentProjectId !== null && canDiscuss && (
          <button
            type="button"
            className={`${styles.iconBtn} ${isChatOpen ? styles.iconBtnOn : ""} spine-hit-area spine-focus-ring`}
            aria-label={t('toolbar.chat')}
            aria-expanded={isChatOpen}
            onClick={() => setIsChatOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        <div className={styles.viewToggle} role="group" aria-label={t('toolbar.viewGroup')}>
          <button
            type="button"
            aria-label={t('toolbar.gridView')}
            aria-pressed={viewMode === "grid"}
            className={`${styles.viewBtn} ${viewMode === "grid" ? styles.viewBtnActive : ""} spine-hit-area spine-focus-ring`}
            onClick={() => setViewMode("grid")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t('toolbar.listView')}
            aria-pressed={viewMode === "list"}
            className={`${styles.viewBtn} ${viewMode === "list" ? styles.viewBtnActive : ""} spine-hit-area spine-focus-ring`}
            onClick={() => setViewMode("list")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 6h11M9 12h11M9 18h11" />
              <circle cx="4.5" cy="6" r=".6" />
              <circle cx="4.5" cy="12" r=".6" />
              <circle cx="4.5" cy="18" r=".6" />
            </svg>
          </button>
        </div>

        {/* select-toggle: label yang membawa keadaan (tanpa aria-pressed);
            hanya perangkat tanpa hover / lebar HP (CSS). */}
        {currentProjectId !== null && (
          <button
            type="button"
            className={`${styles.selectToggle} spine-button spine-focus-ring`}
            onClick={toggleSelectMode}
          >
            {selectMode ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l2.7 2.7L16 9.8" />
              </svg>
            )}
            {selectMode ? tc('cancel') : t('toolbar.select')}
          </button>
        )}
        {/* Aksi utama ikut baris alat (design mock): satu baris
            berisi cari + tampilan + tombol aksi, bukan baris sendiri di atas. */}
        <div className={styles.pageActions}>
          {currentProjectId === null ? (
            canCreateProject ? (
              <button className={styles.actionBtn} onClick={() => setIsCreateProjectModalOpen(true)}>
                {t('toolbar.newProject')}
              </button>
            ) : null
          ) : (
            <>
              {canCreateProject && (
                <button className={styles.actionBtn} onClick={() => setIsCreateFolderModalOpen(true)}>
                  {t('toolbar.newSection')}
                </button>
              )}
              {currentFolderId && canUpload ? (
                <button
                  className={styles.actionBtn}
                  onClick={() =>
                    upload.open({
                      projectId: currentProjectId!,
                      folderId: currentFolderId!,
                      folderName: folderData?.folder?.name ?? null,
                      folderType: folderData?.folder?.folderType ?? null,
                    })
                  }
                >
                  {t('toolbar.uploadTo', { name: folderData?.folder?.name ?? '' })}
                </button>
              ) : currentProjectId !== null && canUpload ? (
                <button className={styles.actionBtn} onClick={() => setProjectRootPickerFiles([])}>
                  {t('toolbar.uploadFiles')}
                </button>
              ) : null}
            </>
          )}

        </div>


        {/* Satu live region polite: jumlah hasil pencarian / ketiadaan hasil
            dan masuk-keluar mode pilih — tanpa memindahkan fokus. */}
        <p className="spine-visually-hidden" aria-live="polite">{liveMessage}</p>
      </div>

      <div className={styles.section}>
        {/* Story 2.16: di MODE DAFTAR keadaan runtime dirender oleh ListView
            sendiri (memuat / gagal / kosong / tanpa hasil), supaya kepala
            kolom kosong tidak pernah ditampilkan. Mode grid tetap memakai
            cabang di bawah ini seperti sekarang. */}
        {viewMode === "grid" && isLoading ? (
          currentProjectId === null ? (
            /* project-skeleton: siluet diam (tanpa shimmer) di region aria-busy */
            <div className={styles.gridProjects} aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <SkeletonRow rows={4} />
          )
        ) : viewMode === "grid" && loadError ? (
          <ErrorBox text={t('states.loadError')} onRetry={retryLoad} />
        ) : (
          viewMode === "grid" ? (
            /* Story 2.7: tingkat Projects punya aturan kolom sendiri
               (1/2/3/4+ auto-fill 280 px, jarak 20 px). */
            <div
              ref={gridRef}
              className={currentProjectId === null ? styles.gridProjects : styles.gridStack}
              onMouseDown={handleGridMouseDown}
              onDragOver={(e) => {
                if (dragItem) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                if (dragItem) {
                  e.preventDefault();
                  handleDragEnd();
                }
              }}
              style={{ position: 'relative', userSelect: 'none' }}
            >
              {currentProjectId === null && projects.map((project: any) => (
                <ProjectCard
                  key={project.id}
                  id={project.id}
                  title={project.title}
                  totalFiles={project.totalFiles}
                  createdAt={project.createdAt}
                  contentSummary={project.contentSummary}
                  repFiles={project.repFiles}
                  canUpload={canUpload}
                  onUploadFirst={(id) => {
                    // Story 2.8: CTA membuka JALUR UPLOAD YANG ADA SEKARANG
                    // dengan Project ini sebagai lingkupnya — masuk project
                    // lalu pemilih Section tujuan (projectRootPickerFiles),
                    // persis jalur slot "Upload" bottom-bar Story 2.3.
                    try { sessionStorage.setItem("shotstash_upload_after_nav", "1"); } catch {}
                    handleProjectClick(id, project.title);
                  }}
                  onOpen={() => handleProjectClick(project.id, project.title)}
                  menuOpen={actionMenu?.id === project.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openProjectMenu(project.id, project, menuAnchorFrom(e));
                  }}
                  onOpenMenu={(anchor) => openProjectMenu(project.id, project, anchor)}
                />
              ))}

              {/* Story 2.10: Kartu Section punya aturan kolom sendiri
                  (1/2/3/4+ auto-fill 216 px, jarak 24 px), jadi Section
                  dan file berada di dua grid bersarang. */}
              {currentProjectId !== null && folders.length > 0 && (
                <div className={styles.gridSections}>
                  {folders.map((folder: any, idx: number) => (
                    <SectionCard
                      key={folder.id}
                      id={folder.id}
                      name={folder.name}
                      totalFiles={folder.totalFiles || 0}
                      contentSummary={folder.contentSummary}
                      repFiles={folder.repFiles}
                      canUpload={canUpload}
                      isSelected={selectedFolderIds.has(folder.id)}
                      isDragOver={dragOverFolderId === folder.id}
                      selectMode={selectMode}
                      anySelected={hasSelection}
                      onToggleSelect={(id, e) => toggleFolderSelect(id, idx, e as unknown as React.MouseEvent)}
                      menuOpen={actionMenu?.id === folder.id}
                      onOpenMenu={(anchor) => openFolderMenu(folder.id, folder, anchor)}
                      onOpen={() => handleFolderClick(folder.id, folder.name)}
                      onUploadFirst={(id) => {
                        // Jalur upload yang ADA SEKARANG dengan Section ini
                        // sebagai tujuannya (sama seperti tombol "+ Upload
                        // Files" di dalam Section).
                        upload.open({
                          projectId: currentProjectId!,
                          folderId: id,
                          folderName: folder.name,
                          folderType: null,
                        });
                      }}
                      draggable={canMove}
                      onDragStart={handleDragStartFolder}
                      onDragEnd={handleDragEnd}
                      onContextMenu={(e) => handleFolderContextMenu(e as unknown as React.MouseEvent, folder)}
                      dragOverLabel={dragOverChipLabel(folder.name)}
                      onDragOver={handleSectionDragOver}
                      onDragLeave={handleSectionDragLeave}
                      onDrop={(e, id) => handleDropOnFolder(e, id)}
                    />
                  ))}
                </div>
              )}

              {currentProjectId !== null && files.length > 0 && (
                <FileGrid
                  files={files}
                  className={styles.gridFiles}
                  rowClassName={styles.gridFilesRow}
                  renderCard={(file: any, idx: number) => (
                <FileCard
                  key={file.id}
                  id={file.id}
                  name={file.originalName}
                  kind={determineType(file.mimeType) as any}
                  sizeBytes={Number(file.size) || 0}
                  // Story 4.4: the thumbnail only; a file without one keeps the
                  // placeholder card (never the full original).
                  thumbnailUrl={file.thumbnailUrl ?? null}
                  draggable={canMove}
                  onOpen={(id) => {
                    // Story 3.5: foto & video → `file-viewer`; dokumen tetap
                    // memakai jalur unduh yang ada dan tidak pernah masuk
                    // urutan prev/next.
                    const f = files.find((x: any) => x.id === id);
                    if (f) openFile(f);
                  }}
                  onShare={canShare ? handleShare : undefined}
                  onDragStart={handleDragStartFile}
                  onDragEnd={handleDragEnd}
                  isSelected={selectedFileIds.has(file.id)}
                  selectMode={selectMode}
                  anySelected={hasSelection}
                  onToggleSelect={(id, e) => toggleFileSelect(id, idx, e as unknown as React.MouseEvent)}
                  onContextMenu={(e) => handleFileContextMenu(e as unknown as React.MouseEvent, file)}
                  menuOpen={actionMenu?.id === file.id}
                  onOpenMenu={(anchor) => openFileMenu(file.id, file, anchor)}
                  job={jobOfFile(file)}
                />
                  )}
                />
              )}

              {currentProjectId === null && projects.length === 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <EmptyState
                    variant="tile"
                    icon={(
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />
                        <path d="M3 7l2-4h14l2 4M7 3l2 4M12 3l2 4M17 3l2 4" />
                      </svg>
                    )}
                    title={t('states.noProjectsTitle')}
                    text={t('states.noProjectsText')}
                    action={canCreateProject ? (
                      <PillButton variant="accent" onClick={() => setIsCreateProjectModalOpen(true)}>
                        {t('states.newProject')}
                      </PillButton>
                    ) : undefined}
                  />
                </div>
              )}

              {/* Story 2.10: isi Section yang kosong (halaman, bukan kartu). */}
              {currentProjectId !== null && folders.length === 0 && files.length === 0 && (
                <EmptyState
                  variant="ghost"
                  title={t('states.emptySectionTitle')}
                  text={canUpload ? undefined : t('states.emptySectionText')}
                  action={canUpload && currentFolderId ? (
                    <PillButton variant="accent" onClick={() => {
                      upload.open({
                        projectId: currentProjectId!,
                        folderId: currentFolderId!,
                        folderName: folderData?.folder?.name ?? null,
                        folderType: folderData?.folder?.folderType ?? null,
                      });
                    }}>
                      {t('states.uploadFirst')}
                    </PillButton>
                  ) : canUpload ? (
                    <PillButton variant="accent" onClick={() => setProjectRootPickerFiles([])}>
                      {t('states.uploadFirst')}
                    </PillButton>
                  ) : undefined}
                />
              )}

              {/* Selection rectangle */}
              {selectRect && (
                <div
                  style={{
                    position: 'absolute',
                    left: Math.min(selectRect.x1, selectRect.x2),
                    top: Math.min(selectRect.y1, selectRect.y2),
                    width: Math.abs(selectRect.x2 - selectRect.x1),
                    height: Math.abs(selectRect.y2 - selectRect.y1),
                    background: 'var(--app-spine-accent-08)',
                    border: '1px solid var(--app-spine-accent-55)',
                    pointerEvents: 'none',
                    zIndex: 10,
                  }}
                />
              )}
            </div>
          ) : (
            /* Story 2.15/2.16: mode daftar — `list-row` tiga tingkat
               menggantikan tabel warisan. Kepala kolomnya memakai keadaan
               urut BERSAMA milik Story 2.5, jadi berpindah grid <-> daftar
               tidak pernah mengubah urutan. */
            <ListView
              level={currentProjectId === null ? "projects" : currentFolderId ? "files" : "sections"}
              sortBy={sortBy}
              sortAsc={sortAsc}
              onSort={handleSortChange}
              projects={projects}
              folders={folders}
              files={files}
              selectedFolderIds={selectedFolderIds}
              selectedFileIds={selectedFileIds}
              onToggleFolder={(id, idx, e) => toggleFolderSelect(id, idx, e)}
              onToggleFile={(id, idx, e) => toggleFileSelect(id, idx, e)}
              selectMode={selectMode}
              anySelected={hasSelection}
              onOpenProject={handleProjectClick}
              onOpenFolder={handleFolderClick}
              onOpenFile={(file) => openFile(file)}
              onShareFile={canShare ? handleShare : undefined}
              onProjectMenu={(project, anchor) =>
                openProjectMenu(project.id, project, anchor)
              }
              onFolderMenu={(folder, anchor) =>
                openFolderMenu(folder.id, folder, anchor)
              }
              onFileMenu={(file, anchor) =>
                openFileMenu(file.id, file, anchor)
              }
              jobOf={jobOfFile}
              menuOpenId={actionMenu?.id ?? null}
              canUpload={canUpload}
              onUploadFirst={(projectId, title) => {
                try { sessionStorage.setItem("shotstash_upload_after_nav", "1"); } catch {}
                handleProjectClick(projectId, title);
              }}
              draggableRows={canMove}
              dragOverFolderId={dragOverFolderId}
              dragOverLabel={
                dragOverFolderId
                  ? dragOverChipLabel(
                      folders.find((f: any) => f.id === dragOverFolderId)?.name || "",
                    )
                  : null
              }
              onFolderDragOver={handleSectionDragOver}
              onFolderDragLeave={handleSectionDragLeave}
              onFolderDrop={(e, id) => handleDropOnFolder(e, id)}
              onFolderDragStart={handleDragStartFolder}
              onFileDragStart={handleDragStartFile}
              onDragEnd={handleDragEnd}
              determineType={determineType}
              state={listState}
              searchTerm={searchQuery}
              onRetry={retryLoad}
              onUploadHere={() => {
                if (currentFolderId) {
                  upload.open({
                    projectId: currentProjectId!,
                    folderId: currentFolderId,
                    folderName: folderData?.folder?.name ?? null,
                    folderType: folderData?.folder?.folderType ?? null,
                  });
                } else {
                  setProjectRootPickerFiles([]);
                }
              }}
            />
          )
        )}
      </div>

      {/* Story 2.13: `bulk-bar` — pill mengambang di desktop, kartu
          pengganti `bottom-bar` di HP. Isinya identik di mode grid dan
          mode daftar; pilihan tidak hilang saat berpindah mode. */}
      {hasSelection && (
        <BulkBar
          count={totalSelected}
          noun={bulkNoun}
          resultText={bulkResult}
          allSelected={totalSelected > 0 && totalSelected === folders.length + files.length}
          canTrash={canManageTrash}
          onToggleSelectAll={toggleSelectAll}
          onCancel={() => {
            const wasSelectMode = selectMode;
            clearSelection();
            if (wasSelectMode) {
              setSelectMode(false);
              setLiveMessage(t('live.selectOff'));
            }
            focusLastTouched();
          }}
          onTrash={() => setConfirmTrash({ name: tn('items', { count: totalSelected }) })}
          onDownloadZip={handleDownloadZip}
        />
      )}

      {shareData && (
        <ShareModal {...shareData} onClose={() => setShareData(null)} />
      )}

      {currentProjectId !== null && canDiscuss && (
        <ChatPanel
          projectId={currentProjectId}
          projectTitle={currentProjectTitle}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
        />
      )}

      {/* Rename Project Modal */}
      {renameProjectData && (
        <div className={styles.modalOverlay} onClick={() => setRenameProjectData(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: "400px" }}>
            <h3>{t('dialogs.renameProject')}</h3>
            <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              {t('dialogs.renameLead', { name: renameProjectData.title })}
            </p>
            <input type="text" value={renameProjectName} onChange={(e) => setRenameProjectName(e.target.value)} autoFocus
              className={styles.modalInput} style={{ marginBottom: '1rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && renameProjectName.trim()) {
                renameProject({ variables: { id: renameProjectData.id, input: { title: renameProjectName.trim() } } });
                setRenameProjectData(null);
              }}}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className={styles.modalBtnSecondary} onClick={() => setRenameProjectData(null)}>{tc('cancel')}</button>
              <button className={styles.modalBtnPrimary} disabled={!renameProjectName.trim()} onClick={() => {
                renameProject({ variables: { id: renameProjectData.id, input: { title: renameProjectName.trim() } } });
                setRenameProjectData(null);
              }}>{t('dialogs.rename')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {renameFolderData && (
        <div className={styles.modalOverlay} onClick={() => setRenameFolderData(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: "400px" }}>
            <h3>{t('dialogs.renameSection')}</h3>
            <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              {t('dialogs.renameLead', { name: renameFolderData.name })}
            </p>
            <input type="text" value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} autoFocus
              className={styles.modalInput} style={{ marginBottom: '1rem' }}
              onKeyDown={(e) => { if (e.key === 'Enter' && renameFolderName.trim()) {
                renameFolderMutate({ variables: { folderId: renameFolderData.id, name: renameFolderName.trim() } });
              }}}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button type="button" className={styles.modalBtnSecondary} onClick={() => setRenameFolderData(null)}>{tc('cancel')}</button>
              <button className={styles.modalBtnPrimary} disabled={!renameFolderName.trim()} onClick={() => {
                renameFolderMutate({ variables: { folderId: renameFolderData.id, name: renameFolderName.trim() } });
              }}>{t('dialogs.rename')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Story 4.5: why some items of a bulk Trash failed (replaces alert()). */}
      {bulkReasons && (
        <Dialog
          title={t('bulk.reasonsTitle')}
          lead={t('bulk.reasonsLead', { count: bulkReasons.length })}
          onClose={() => setBulkReasons(null)}
          actions={
            <PillButton variant="accent" onClick={() => setBulkReasons(null)}>
              {tc('close')}
            </PillButton>
          }
        >
          <ul className={styles.bulkReasons}>
            {bulkReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Dialog>
      )}

      {/* Delete Project — Story 3.1 `dialog` / `confirm-sheet`, role="alertdialog",
          fokus awal di "Batal", tombol permanen = button-danger.solid. */}
      {deleteProjectData && (() => {
        const project = projects.find((p: any) => p.id === deleteProjectData.id);
        return (
          <ConfirmDialog
            tone="permanent"
            title={t('dialogs.deleteProjectTitle')}
            lead={t.rich('dialogs.deleteProjectLead', {
              name: deleteProjectData.title,
              b: (c) => <b>{c}</b>,
            })}
            preview={{
              thumb: <RepThumb variant="project" repFiles={project?.repFiles} />,
              name: deleteProjectData.title,
              meta: projectMetaLine(project),
            }}
            confirmLabel={t('dialogs.deleteForever')}
            onConfirm={() => {
              deleteProject({ variables: { id: deleteProjectData.id } });
              setDeleteProjectData(null);
            }}
            onClose={() => setDeleteProjectData(null)}
          />
        );
      })()}

      {/* Create Project Modal */}
      {isCreateProjectModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsCreateProjectModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>{t('dialogs.createProjectTitle')}</h3>
            <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              {t('dialogs.createProjectLead')}
            </p>
            <form onSubmit={handleCreateProject}>
              <input
                type="text"
                placeholder={t('dialogs.projectTitlePlaceholder')}
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                autoFocus
                className={styles.modalInput}
                style={{ marginBottom: '0.75rem' }}
              />
              <input
                type="text"
                placeholder={t('dialogs.descriptionPlaceholder')}
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                className={styles.modalInput}
                style={{ marginBottom: '0.75rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className={styles.modalBtnSecondary} onClick={() => setIsCreateProjectModalOpen(false)}>{tc('cancel')}</button>
                <button type="submit" className={styles.modalBtnPrimary} disabled={!newProjectTitle.trim()}>{t('dialogs.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {isCreateFolderModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsCreateFolderModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h3>{t('dialogs.createSectionTitle')}</h3>
            <p style={{ color: 'var(--color-on-surface-variant)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              {(() => {
                const parentName = currentFolderId ? folderData?.folder?.name : rootData?.project?.title;
                return parentName
                  ? t('dialogs.createSectionLead', { name: parentName })
                  : t('dialogs.createSectionLeadFallback');
              })()}
            </p>
            <form onSubmit={handleCreateFolder}>
              <input
                type="text"
                placeholder={t('dialogs.sectionPlaceholder')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                className={styles.modalInput}
                style={{ marginBottom: '1rem' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className={styles.modalBtnSecondary} onClick={() => setIsCreateFolderModalOpen(false)}>{tc('cancel')}</button>
                <button type="submit" className={styles.modalBtnPrimary} disabled={!newFolderName.trim()}>{t('dialogs.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Story 3.5 — `file-viewer`: SATU lapisan di atas grid, selalu gelap
          di dua tema. Dokumen tidak pernah masuk ke sini (lihat `openFile`). */}
      {previewFile && currentProjectId && viewerIndex >= 0 && (
        <FileViewer
          files={viewerFilesWithVersions}
          index={viewerIndex}
          onIndexChange={(i) => setPreviewFile(viewerFiles[i])}
          onClose={() => setPreviewFile(null)}
          srcOf={(f) => inlineSrcOf(f)}
          posterOf={(f) => f.thumbnailUrl ?? undefined}
          projectTitle={currentProjectTitle}
          sectionName={currentFolderName}
          onShare={
            canShare
              ? (f) => {
                  handleShare(f.id, f.originalName);
                  setPreviewFile(null);
                }
              : undefined
          }
          onDownload={(f) => openDirectDownload(f.id)}
          renderTopExtra={(f) => {
            const job = jobOfFile(f);
            return job ? <JobChip job={job} onDark /> : null;
          }}
          renderInfoExtra={(f) => (
            <ViewerProcess
              key={f.id}
              fileId={f.id}
              job={jobOfFile(f)}
              canTrigger={canTrigger}
              kindLabel={versionKindLabel}
              onJob={applyJob}
            />
          )}
        />
      )}

      {/* Story 3.12: "Pilih Section Tujuan" — dipakai saat tujuan upload
          belum ditentukan, dan saat panel meminta "Pilih Section lain".
          Istilahnya "Section", bukan "Folder". */}
      {projectRootPickerFiles !== null && currentProjectId && (
        <SectionPicker
          sections={(rootData?.project?.folders || []) as any[]}
          onPick={(f) => {
            const files = projectRootPickerFiles;
            setProjectRootPickerFiles(null);
            upload.open(
              { projectId: currentProjectId, folderId: f.id, folderName: f.name, folderType: null },
              files && files.length > 0 ? { files } : undefined,
            );
          }}
          onCreate={() => {
            setProjectRootPickerFiles(null);
            setIsCreateFolderModalOpen(true);
          }}
          onClose={() => setProjectRootPickerFiles(null)}
        />
      )}

      {/* Confirm Trash — Story 3.1: "Move to Trash" bisa dipulihkan 30 hari,
          so its button is the accent button-primary, not danger solid. */}
      {confirmTrash && (() => {
        const isBulk = !confirmTrash.fileId && !confirmTrash.folderId;
        const file = confirmTrash.fileId ? files.find((f: any) => f.id === confirmTrash.fileId) : null;
        const folder = confirmTrash.folderId
          ? folders.find((f: any) => f.id === confirmTrash.folderId)
          : null;
        const sectionName = folder ? parseSectionName(folder.name) : null;
        const preview = file
          ? {
              thumb: (
                <RepThumb
                  variant="file"
                  file={{ kind: mimeKind(file.mimeType), thumbnailUrl: file.thumbnailUrl }}
                />
              ),
              name: file.originalName,
              meta: fileMetaLine(file),
            }
          : folder
            ? {
                thumb: <RepThumb variant="section" repFiles={folder.repFiles} />,
                name: sectionName?.title ?? folder.name,
                meta: sectionMetaLine(folder),
              }
            : undefined;
        return (
          <ConfirmDialog
            tone="recoverable"
            title={t('dialogs.trashTitle')}
            lead={
              isBulk
                ? t.rich('dialogs.trashLeadBulk', { name: confirmTrash.name, b: (c) => <b>{c}</b> })
                : folder
                  ? t.rich('dialogs.trashLeadSection', { name: folder.name, b: (c) => <b>{c}</b> })
                  : t.rich('dialogs.trashLeadFile', { name: confirmTrash.name, b: (c) => <b>{c}</b> })
            }
            preview={preview}
            confirmLabel={t('dialogs.trashConfirm')}
            onConfirm={() => {
              const c = confirmTrash;
              setConfirmTrash(null);
              if (c.fileId) doTrash(c.fileId, true);
              else if (c.folderId) doFolderTrash(c.folderId, true);
              // Story 2.13: aksi massal memakai jalur yang tahu kegagalan
              // sebagian — item gagal tetap terpilih, item berhasil dilepas.
              else void runBulkTrash();
            }}
            onClose={() => setConfirmTrash(null)}
          />
        );
      })()}

      {/* Move/Copy Folder Picker Modal */}
      {moveCopyModal && <FolderPickerModal
        mode={moveCopyModal.mode}
        items={moveCopyModal.items}
        currentLocationId={currentFolderId}
        apolloClient={apolloClient}
        onSelect={async ({ folderId: targetFolderId, projectId: targetProjectId }) => {
          try {
            const ops: Promise<any>[] = [];
            for (const item of moveCopyModal.items) {
              if (moveCopyModal.mode === 'move' && item.type === 'file') {
                if (!targetFolderId) continue; // files cannot live at project root
                ops.push(moveFile({ variables: { fileId: item.id, targetFolderId } }));
              } else if (moveCopyModal.mode === 'copy' && item.type === 'file') {
                if (!targetFolderId) continue;
                ops.push(copyFileMutate({ variables: { fileId: item.id, targetFolderId } }));
              } else if (moveCopyModal.mode === 'move' && item.type === 'folder') {
                ops.push(moveFolder({
                  variables: targetFolderId
                    ? { folderId: item.id, targetFolderId }
                    : { folderId: item.id, targetProjectId },
                }));
              }
            }
            await Promise.all(ops);
            setMoveCopyModal(null);
            clearSelection();
            if (currentFolderId) refetchFolder();
            else if (currentProjectId) refetchRoot();
          } catch (err: any) {
            pushSpineToast({ tone: 'error', message: t('toasts.operationFailed'), cause: humanize(err) });
          }
        }}
        onClose={() => setMoveCopyModal(null)}
      />}

      {/* Context Menu */}
      {actionMenu && (
        <ActionMenu
          anchor={actionMenu.anchor}
          target={actionMenu.target}
          entries={actionMenu.entries}
          onClose={() => setActionMenu(null)}
        />
      )}
    </div>
  );
}
