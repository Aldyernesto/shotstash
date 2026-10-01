// Shotstash — GraphQL Type Definitions
// Layer 2: API Gateway

export const typeDefs = `#graphql
  scalar DateTime
  scalar BigInt

  # ============================================
  # ENUMS
  # ============================================

  enum Role {
    SUPER_ADMIN
    ADMIN
    FIELD_CREW
    EDITOR
    VIEWER
  }

  enum ProjectStatus {
    ACTIVE
    ARCHIVED
    DRAFT
  }

  enum ShareMode {
    PUBLIC
    PRIVATE
  }

  # ============================================
  # TYPES
  # ============================================

  type User {
    id: ID!
    name: String!
    email: String!
    role: Role!
    active: Boolean!
    accountStatus: String!
    requestedRole: Role
    onboardedAt: DateTime
    avatarUrl: String
    signupAnswers: String
    # UI locale; null = instance default (SHOTSTASH_DEFAULT_LOCALE, then en).
    locale: String
    # false = akun Google-only (belum punya password)
    hasPassword: Boolean!
    # Denies every write when true.
    readOnly: Boolean!
    # Story 2.4: actions this user may perform (can()); the UI reads only this.
    permissions: [String!]!
    # Story 6.3: instance feature toggles (the same for every user).
    features: Features!
    createdAt: DateTime!
  }

  # Story 6.3: features an operator can switch on or off at runtime. A disabled
  # feature answers FEATURE_DISABLED; the schema never changes with toggles.
  type Features {
    # Public sign-up (SHOTSTASH_FEATURE_SIGNUP).
    signup: Boolean!
    # Google sign-in (GOOGLE_CLIENT_ID set).
    google: Boolean!
    # Elasticsearch search (ELASTICSEARCH_NODE_URL set).
    search: Boolean!
    # Password reset by email (an email transport that can send).
    passwordResetEmail: Boolean!
    # Story 5.5: project discussion and mentions (SHOTSTASH_FEATURE_DISCUSSION).
    discussion: Boolean!
  }

  type Project {
    id: ID!
    title: String!
    description: String
    coverImage: String
    status: ProjectStatus!
    files: [MediaFile!]!
    folders: [Folder!]!
    chats: [ProjectChat!]!
    totalFiles: Int!
    totalSize: BigInt!
    # Story 2.4 (aditif): ringkasan isi per jenis + sampel Kartu Perwakilan
    # harian — deterministik per tanggal Asia/Jakarta.
    contentSummary: ContentSummary!
    repFiles(limit: Int!): [RepFile!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # Story 2.5: the project list. Same fields as Project except chats, so
  # "projects { chats }" is a schema error: discussion loads per project
  # through project(id) only.
  type ProjectSummary {
    id: ID!
    title: String!
    description: String
    coverImage: String
    status: ProjectStatus!
    files: [MediaFile!]!
    folders: [Folder!]!
    totalFiles: Int!
    totalSize: BigInt!
    contentSummary: ContentSummary!
    repFiles(limit: Int!): [RepFile!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Folder {
    id: ID!
    name: String!
    project: Project!
    parent: Folder
    children: [Folder!]!
    files: [MediaFile!]!
    totalFiles: Int!
    # Story 2.4 (aditif): rekursif ke seluruh sub-Section.
    contentSummary: ContentSummary!
    repFiles(limit: Int!): [RepFile!]!
    folderType: String
    trashedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  # Story 2.4: angka mentah per jenis (ember mimeType) — kalimat
  # "Berisi {n} video · …" dirakit di klien.
  type ContentSummary {
    photos: Int!
    videos: Int!
    documents: Int!
    total: Int!
  }

  # Story 2.4: satu file perwakilan. thumbnailUrl = /media/t/{id}?v={n}
  # bila file punya thumbnail, selain itu null (klien merender placeholder);
  # duration null (tidak ada kolomnya di DB); extension hanya dokumen.
  type RepFile {
    id: ID!
    kind: String!
    thumbnailUrl: String
    duration: Int
    extension: String
  }

  type MediaFile {
    id: ID!
    filename: String!
    originalName: String!
    mimeType: String!
    size: BigInt!
    md5Checksum: String!
    # /media/t/{id}?v={n}, null while the file has no thumbnail.
    thumbnailUrl: String
    # Set when this file was uploaded anyway although identical bytes were
    # already in the project (or copied): the id of that original.
    duplicateOf: ID
    downloadUrl: String!
    # Story 4.4: outputs derived from this file (the HEIC preview today,
    # pipeline results with Epic 5), newest first. The original never changes.
    processedVersions: [ProcessedVersion!]!
    # /media/p/{id} of the image preview the viewer shows instead of the
    # original (HEIC), null when the original is shown as is.
    previewUrl: String
    # Story 5.1: processing jobs on this file, newest first (at most 20).
    jobs: [PipelineJob!]!
    # Story 5.4: the job a card shows: the newest unfinished job, else one
    # that failed within 24 hours, else null. Batched per request.
    currentJob: PipelineJob
    folder: Folder!
    uploadedBy: User!
    project: Project!
    trashedAt: DateTime
    createdAt: DateTime!
  }

  type ProcessedVersion {
    id: ID!
    # "preview" (HEIC preview made at upload) or a pipeline kind.
    kind: String!
    # Story 5.1: the kind's stored label (pipeline_kinds.label), null when
    # none; clients prefer their own translation of known kinds.
    kindLabel: String
    mimeType: String!
    size: BigInt!
    # /media/p/{id}: attachment, cookie session, same permission as the file.
    downloadUrl: String!
    createdAt: DateTime!
  }

  # Story 5.1: a processing job on one file. status is stored: queued,
  # claimed, running, done, failed or cancelled (the last three are final).
  # state is status plus the derived waiting_for_worker (queued while no live
  # worker serves its kind). seq grows with every state or progress change.
  type PipelineJob {
    id: ID!
    # <namespace>/<name>, such as shotstash/proxy-720p.
    kind: String!
    # Story 5.4: the kind's stored label, null when none.
    kindLabel: String
    fileId: ID!
    status: String!
    state: String!
    # Percent done, 0 to 100.
    progress: Int!
    attempts: Int!
    maxAttempts: Int!
    # Last error (failed jobs, and queued jobs retried after one).
    error: String
    seq: Int!
    # The processed version the job produced (done jobs only).
    outputVersion: ProcessedVersion
    createdAt: DateTime!
    updatedAt: DateTime!
    finishedAt: DateTime
  }

  # Story 5.2: a registered processing worker (one per name).
  type PipelineWorker {
    id: ID!
    name: String!
    version: String!
    kinds: [String!]!
    lastSeen: DateTime!
    revokedAt: DateTime
    # Seen within the lease and not revoked.
    live: Boolean!
    createdAt: DateTime!
  }

  # Story 5.4: a kind the Process menu offers for one file.
  type PipelineKindOption {
    kind: String!
    # Stored label; clients prefer their own translation of known kinds.
    label: String
    # A worker serving this kind was seen within the lease (else the job
    # waits for one).
    live: Boolean!
    # The file already has an unfinished job of this kind (the menu entry is
    # disabled; enqueueJob would answer that job).
    open: Boolean!
  }

  # Story 5.5: a person the mention dropdown offers (an account that may
  # view the Project). Typing @handle notifies them.
  type MentionPerson {
    id: ID!
    name: String!
    handle: String!
    role: Role!
  }

  # Story 5.5: one change in a Project, delivered after the commit and after
  # a per-event permission check. type is chat.created (chat set),
  # job.updated (job set) or resync (a transient server error skipped an
  # event: refetch); seq orders the events of one entity (drop lower).
  type ProjectEvent {
    type: String!
    id: ID!
    seq: Int!
    chat: ProjectChat
    job: PipelineJob
  }

  type ProjectChat {
    id: ID!
    # Story 5.5: per-Project sequence; history is ordered by (createdAt, id).
    seq: Int!
    message: String!
    # Null for a message a person wrote; "upload" for the system line added
    # when a file finishes uploading (the client renders it from messages).
    kind: String
    sender: User!
    project: Project!
    referencedFile: MediaFile
    createdAt: DateTime!
  }

  type ShareLink {
    id: ID!
    slug: String!
    url: String!
    mode: ShareMode!
    expiresAt: DateTime
    file: MediaFile
    folder: Folder
    project: Project
    targetType: String!
    # null when the target was deleted; the client shows its own label.
    targetName: String
    accessCount: Int!
    # Story 2.3: PRIVATE access code, returned once by createShareLink, null elsewhere.
    accessCode: String
    # Story 4.4 (aditif): pembuat link — "dibuat {nama}" / "dibuat kamu"
    # di bagian "Link aktif" share-modal; dimuat dari createdById.
    createdBy: User!
    # Story 4.7 (aditif, FR40): 1–3 file perwakilan target untuk rep-thumb
    # baris Shared. HANYA mendelegasikan ke Project.repFiles / Folder.repFiles
    # / file itu sendiri (aturan & seed harian Story 2.4); limit dijepit
    # 1–3 di server; target yang sudah dihapus → [] (bukan error).
    repThumbs(limit: Int = 3): [RepFile!]!
    createdAt: DateTime!
  }

  type Notification {
    id: ID!
    type: String!
    title: String!
    body: String!
    data: String
    read: Boolean!
    createdAt: DateTime!
  }

  # Story 4.3: one upload. Parts (1 to partCount) go to
  # PUT /api/v1/uploads/{id}/parts/{n} with a Content-MD5 header; every part
  # but the last is partSize bytes.
  type UploadSession {
    id: ID!
    # The file row this upload fills (status uploading until completion).
    fileId: ID
    filename: String!
    totalSize: BigInt!
    partSize: Int!
    partCount: Int!
    # IN_PROGRESS, COMPLETING, COMPLETED, FAILED or EXPIRED.
    status: String!
    # Part numbers the server already stored (resume sends only the rest).
    confirmedParts: [Int!]!
    projectId: ID!
    folderId: ID!
    expiresAt: DateTime!
  }

  type UploadProgress {
    sessionId: ID!
    filename: String!
    partCount: Int!
    confirmedParts: Int!
    percentage: Float!
  }

  # Story 4.3: advisory dedup check before bytes are sent.
  type DuplicateMatch {
    name: String!
    size: BigInt!
    md5: String
    # "name": same name and size (hash the file and ask again with md5);
    # "exact": identical bytes are already in the project.
    match: String!
    existingFileId: ID!
    existingName: String!
  }

  type AuthPayload {
    user: User
    success: Boolean!
    token: String
    message: String
    # Stable failure code, e.g. PASSWORD_TOO_SHORT. null on success.
    errorCode: String
  }

  type AdminActionResult {
    success: Boolean!
    message: String
    # Hanya terisi sekali saat password dibuat otomatis oleh adminSetPassword
    password: String
    # Stable failure code (USER_NOT_FOUND, CANNOT_TARGET_SELF, SUPER_ADMIN_PROTECTED,
    # USER_HAS_ACTIVITY, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG, INTERNAL). null on success.
    errorCode: String
    # USER_HAS_ACTIVITY only: what blocks the delete.
    uploads: Int
    shareLinks: Int
    chats: Int
  }

  # Reset password mandiri via email (kode OTP).
  type PasswordResetResult {
    success: Boolean!
    message: String
    # Hanya diisi verifyPasswordResetCode yang berhasil. Sekali pakai, berlaku 10 menit.
    resetToken: String
    # Jenis kegagalan untuk UI: UNAVAILABLE | RATE_LIMITED | INVALID_EMAIL | INVALID_CODE | CODE_LOCKED |
    # TOKEN_INVALID | PASSWORD_TOO_SHORT | PASSWORD_TOO_LONG | PASSWORD_MISMATCH | INTERNAL. null saat sukses.
    errorCode: String
    # INVALID_CODE only: wrong tries left before the code is cancelled.
    attemptsLeft: Int
  }

  type StorageStats {
    # local or s3.
    backend: String!
    # Disk size and free space; null when the backend cannot tell (S3).
    totalSpace: Float
    usedSpace: Float!
    freeSpace: Float
    totalFiles: Int!
    totalProjects: Int!
  }

  # ============================================
  # INPUT TYPES
  # ============================================

  input ProjectFilter {
    status: ProjectStatus
    search: String
  }

  input InitiateUploadInput {
    filename: String!
    totalSize: BigInt!
    # MD5 of the whole file (hex), when the client already computed it.
    md5Checksum: String
    projectId: ID!
    folderId: ID!
    # "Upload anyway": identical bytes may already be in the project.
    allowDuplicate: Boolean
  }

  input DuplicateCandidateInput {
    name: String!
    size: BigInt!
    md5: String
  }

  input ShareLinkInput {
    fileId: ID
    folderId: ID
    projectId: ID
    mode: ShareMode!
    expiresInHours: Int
  }

  input CreateProjectInput {
    title: String!
    description: String
    coverImage: String
  }

  input CreateUserInput {
    name: String!
    email: String!
    password: String!
    role: Role
    signupAnswers: String
  }

  # ============================================
  # QUERIES
  # ============================================

  type Query {
    pendingUsers: [User!]!
    # Auth — nullable: returns null when token expired/missing/user deactivated
    me: User
    # Publik: true bila reset password via email sudah aktif (env provider email ada di server)
    passwordResetAvailable: Boolean!

    # Projects & Folders
    projects(filter: ProjectFilter): [ProjectSummary!]!
    project(id: ID!): Project
    folder(id: ID!): Folder

    # Files
    searchFiles(query: String!, projectId: ID): [MediaFile!]!
    searchFolders(query: String!, projectId: ID): [Folder!]!
    # Story 4.4: processed versions of one live file, newest first (the
    # viewer loads them when it opens a file; large Section lists skip them).
    processedVersions(fileId: ID!): [ProcessedVersion!]!
    # Story 5.1: one processing job (null when it or its file is gone).
    pipelineJob(id: ID!): PipelineJob
    # Story 5.2: registered workers, most recently seen first (super admin).
    pipelineWorkers: [PipelineWorker!]!
    # Story 5.4: kinds that apply to one live file (pipeline.trigger).
    availableKinds(fileId: ID!): [PipelineKindOption!]!
    # Story 5.5: people who may view the Project, for the mention dropdown
    # (name contains query; at most 20). FEATURE_DISABLED when discussion is off.
    mentionPeople(projectId: ID!, query: String): [MentionPerson!]!

    # Shares
    shareLinks: [ShareLink!]!
    # Story 4.4 (aditif): link untuk TEPAT SATU target (file / Section /
    # Project) — hak lihat sama dengan shareLinks: SUPER_ADMIN/ADMIN semua
    # link tim, role lain hanya miliknya. Urut createdAt menurun.
    shareLinksForTarget(fileId: ID, folderId: ID, projectId: ID): [ShareLink!]!

    # Uploads (Story 4.3): resume state of an own upload, and the advisory
    # dedup check (by name and size, then by md5).
    uploadSession(id: ID!): UploadSession
    checkDuplicates(projectId: ID!, candidates: [DuplicateCandidateInput!]!): [DuplicateMatch!]!

    # Trash
    allTrashedFiles: [MediaFile!]!
    allTrashedFolders: [Folder!]!

    # Notifications
    notifications(unreadOnly: Boolean): [Notification!]!
    unreadNotificationCount: Int!

    # Admin only
    users: [User!]!
    storageStats: StorageStats!
  }

  # ============================================
  # MUTATIONS
  # ============================================

  type Mutation {
    # Auth
    login(email: String!, password: String!): AuthPayload!
    logout: Boolean!
    register(input: CreateUserInput!): AuthPayload!
    # Reset password mandiri (publik, tanpa login). Respons requestPasswordReset seragam untuk semua email.
    requestPasswordReset(email: String!): PasswordResetResult!
    verifyPasswordResetCode(email: String!, code: String!): PasswordResetResult!
    completePasswordReset(resetToken: String!, newPassword: String!, confirmPassword: String!): PasswordResetResult!

    # Profile
    updateProfile(name: String, avatarUrl: String, locale: String): User!

    # Projects
    createProject(input: CreateProjectInput!): Project!
    updateProject(id: ID!, input: CreateProjectInput!): Project!
    deleteProject(id: ID!): Boolean!

    # Folders
    createFolder(projectId: ID!, name: String!, parentId: ID): Folder!
    renameFolder(folderId: ID!, name: String!): Folder!
    moveFile(fileId: ID!, targetFolderId: ID!): MediaFile!
    copyFile(fileId: ID!, targetFolderId: ID!): MediaFile!
    moveFolder(folderId: ID!, targetFolderId: ID, targetProjectId: ID): Folder!

    # Upload (Story 4.3): parts travel over REST, see UploadSession.
    initiateUpload(input: InitiateUploadInput!): UploadSession!
    # md5Checksum: MD5 of the whole file, when not sent at initiate.
    # convertHeic is ignored since Story 4.4 (originals stay as uploaded; HEIC
    # gets a preview version). Kept for one release so older clients work.
    completeUpload(
      sessionId: ID!
      md5Checksum: String
      convertHeic: Boolean @deprecated(reason: "Ignored: HEIC originals are kept and get a preview version.")
    ): MediaFile!
    cancelUpload(sessionId: ID!): Boolean!

    # Processing jobs (Story 5.1). enqueueJob answers the unfinished job of
    # the same kind on the file instead of queueing a second one; an unknown
    # kind is KIND_UNKNOWN. cancelJob stops a queued, claimed or running job
    # (JOB_TERMINAL when it already finished).
    enqueueJob(fileId: ID!, kind: String!): PipelineJob!
    cancelJob(id: ID!): PipelineJob!
    # Revokes a worker: its token stops working and its name cannot register
    # again (super admin). Null when there is no such worker.
    revokeWorker(id: ID!): PipelineWorker

    # Share
    createShareLink(input: ShareLinkInput!): ShareLink!
    revokeShareLink(id: ID!): Boolean!

    # Notifications
    markNotificationsRead: Boolean!

    # Auth
    googleAuth(idToken: String!): AuthPayload!

    # Chat
    sendMessage(projectId: ID!, message: String!, referencedFileId: ID): ProjectChat!

    # Trash
    moveToTrash(fileId: ID!): Boolean!
    restoreFile(fileId: ID!): MediaFile!
    permanentDelete(fileId: ID!): Boolean!
    moveFolderToTrash(folderId: ID!): Boolean!
    restoreFolder(folderId: ID!): Folder!
    permanentDeleteFolder(folderId: ID!): Boolean!

    # Admin
    completeOnboarding(requestedRole: Role!, signupAnswers: String): User!
    approveUser(userId: ID!, role: Role!): User!
    rejectUser(userId: ID!): User!
    updateUserRole(userId: ID!, role: Role!): User!
    deactivateUser(id: ID!): User!
    reactivateUser(id: ID!): User!
    # SUPER_ADMIN only. Tanpa newPassword → password acak dikembalikan sekali di field password.
    adminSetPassword(userId: ID!, newPassword: String): AdminActionResult!
    # SUPER_ADMIN only. Hanya untuk akun tanpa upload/share link/chat.
    deleteUser(id: ID!): AdminActionResult!
  }

  # ============================================
  # SUBSCRIPTIONS (WebSocket)
  # ============================================

  # Story 5.5: every stream re-checks the session and can() on each event and
  # ends when the session is revoked or the account deactivated.
  type Subscription {
    uploadProgress(sessionId: ID!): UploadProgress!
    chatMessages(projectId: ID!): ProjectChat!
    notificationReceived: Notification!
    # One job (the viewer of the file may follow it).
    jobUpdated(jobId: ID!): PipelineJob!
    # Chat messages (while discussion is on) and job changes of one Project.
    projectEvents(projectId: ID!): ProjectEvent!
  }
`;
