// Shotstash GraphQL type definitions (layer 2: API gateway).
//
// Story 7.2: every type, field, argument, input field and enum value carries
// a description. `npm run sdl` exports schema.graphql at the repo root and
// `npm run sdl:check` (CI) fails on a missing description or a stale export.
// Root field auth is declared in src/graphql/auth-map.ts.

export const typeDefs = `#graphql
  "An ISO-8601 UTC timestamp, such as 2026-10-01T12:00:00.000Z."
  scalar DateTime

  "A 64-bit integer (byte sizes), serialized as a JSON number."
  scalar BigInt

  "An account role. Permissions come from the role; read User.permissions instead of comparing roles."
  enum Role {
    "Owns the instance: every permission, including instance settings and workers."
    SUPER_ADMIN
    "Manages users, projects and every team share link."
    ADMIN
    "Uploads and organizes media in the field."
    FIELD_CREW
    "Works with media: uploads, organizes and processes files."
    EDITOR
    "Views projects and media only."
    VIEWER
  }

  "The lifecycle state of a project."
  enum ProjectStatus {
    "In use and shown in the project list."
    ACTIVE
    "Finished and kept for reference."
    ARCHIVED
    "Being prepared and not yet in active use."
    DRAFT
  }

  "Who may open a share link."
  enum ShareMode {
    "Anyone with the link."
    PUBLIC
    "Anyone with the link and its access code."
    PRIVATE
  }

  "A person with an account on this instance."
  type User {
    "Unique id."
    id: ID!
    "Display name."
    name: String!
    "Sign-in email address."
    email: String!
    "Current role."
    role: Role!
    "False when an admin deactivated the account (it cannot sign in)."
    active: Boolean!
    "Sign-up review state: PENDING (waiting for an admin; may still sign in to see the waiting screen or finish onboarding), ACTIVE or REJECTED (cannot sign in)."
    accountStatus: String!
    "The role asked for during onboarding, null when none."
    requestedRole: Role
    "When onboarding was completed, null before."
    onboardedAt: DateTime
    "Avatar image URL, null when none."
    avatarUrl: String
    "Answers given at sign-up (JSON text), null when none."
    signupAnswers: String
    "UI locale; null means the instance default (SHOTSTASH_DEFAULT_LOCALE, then en)."
    locale: String
    "False for a Google-only account that has no password yet."
    hasPassword: Boolean!
    "When true, every write is denied for this account."
    readOnly: Boolean!
    "Actions this user may perform; clients decide what to show from this list only."
    permissions: [String!]!
    "Instance feature toggles (the same for every user)."
    features: Features!
    "When the account was created."
    createdAt: DateTime!
  }

  "Features an operator can switch on or off at runtime. A disabled feature answers FEATURE_DISABLED; the schema never changes with toggles."
  type Features {
    "Public sign-up is open (SHOTSTASH_FEATURE_SIGNUP)."
    signup: Boolean!
    "Google sign-in is available (GOOGLE_CLIENT_ID is set)."
    google: Boolean!
    "Search runs on Elasticsearch (ELASTICSEARCH_NODE_URL is set)."
    search: Boolean!
    "Password reset by email is available (an email transport that can send)."
    passwordResetEmail: Boolean!
    "Project discussion and mentions are on (SHOTSTASH_FEATURE_DISCUSSION)."
    discussion: Boolean!
    "Public demo mode is on (SHOTSTASH_DEMO_MODE): demo accounts are read-only and the demo data resets every night."
    demo: Boolean!
  }

  "A project: the top-level container of folders (sections), files and discussion."
  type Project {
    "Unique id."
    id: ID!
    "Project title."
    title: String!
    "Optional description."
    description: String
    "Cover image URL, null when none."
    coverImage: String
    "Lifecycle state."
    status: ProjectStatus!
    "Live files directly in the project."
    files: [MediaFile!]!
    "Live folders of the project."
    folders: [Folder!]!
    "Discussion messages of the project. Empty while discussion is off."
    chats: [ProjectChat!]!
    "Number of live files."
    totalFiles: Int!
    "Total size of the live files in bytes."
    totalSize: BigInt!
    "Counts of the project content by kind."
    contentSummary: ContentSummary!
    "Representative files for the project card: a sample seeded by the project id and the calendar date, computed on the server in the Asia/Jakarta time zone (fixed in the resolver, not SHOTSTASH_DEFAULT_TIMEZONE), so every request on the same day sees the same files whatever the client time zone."
    repFiles(
      "How many files to return, 1 to 5 (INVALID_LIMIT otherwise); fewer when the project has fewer files."
      limit: Int!
    ): [RepFile!]!
    "When the project was created."
    createdAt: DateTime!
    "When the project was last changed."
    updatedAt: DateTime!
  }

  "A project in the project list: the same fields as Project without chats, so asking projects { chats } is a schema error; the discussion loads per project through project(id)."
  type ProjectSummary {
    "Unique id."
    id: ID!
    "Project title."
    title: String!
    "Optional description."
    description: String
    "Cover image URL, null when none."
    coverImage: String
    "Lifecycle state."
    status: ProjectStatus!
    "Live files directly in the project."
    files: [MediaFile!]!
    "Live folders of the project."
    folders: [Folder!]!
    "Number of live files."
    totalFiles: Int!
    "Total size of the live files in bytes."
    totalSize: BigInt!
    "Counts of the project content by kind."
    contentSummary: ContentSummary!
    "Representative files for the project card: a sample seeded by the project id and the calendar date, computed on the server in the Asia/Jakarta time zone (fixed in the resolver, not SHOTSTASH_DEFAULT_TIMEZONE), so every request on the same day sees the same files whatever the client time zone."
    repFiles(
      "How many files to return, 1 to 5 (INVALID_LIMIT otherwise); fewer when the project has fewer files."
      limit: Int!
    ): [RepFile!]!
    "When the project was created."
    createdAt: DateTime!
    "When the project was last changed."
    updatedAt: DateTime!
  }

  "A folder (section) inside a project. Folders nest."
  type Folder {
    "Unique id."
    id: ID!
    "Folder name."
    name: String!
    "The project the folder belongs to."
    project: Project!
    "The parent folder, null at the top level."
    parent: Folder
    "Live child folders."
    children: [Folder!]!
    "Live files directly in this folder."
    files: [MediaFile!]!
    "Number of live files directly in this folder."
    totalFiles: Int!
    "Counts of the content by kind, including every subfolder."
    contentSummary: ContentSummary!
    "Representative files for the folder card, from the folder and every subfolder: a sample seeded by the folder id and the calendar date, computed on the server in the Asia/Jakarta time zone (fixed in the resolver, not SHOTSTASH_DEFAULT_TIMEZONE), so every request on the same day sees the same files."
    repFiles(
      "How many files to return, 1 to 3 (INVALID_LIMIT otherwise); fewer when the folder has fewer files."
      limit: Int!
    ): [RepFile!]!
    "Optional folder type label, null when none."
    folderType: String
    "When the folder was moved to the trash, null while live."
    trashedAt: DateTime
    "When the folder was created."
    createdAt: DateTime!
    "When the folder was last changed."
    updatedAt: DateTime!
  }

  "Raw counts of content by kind (bucketed by MIME type); clients build the sentence."
  type ContentSummary {
    "Number of images."
    photos: Int!
    "Number of videos."
    videos: Int!
    "Number of other files (documents and the rest)."
    documents: Int!
    "Number of files in total."
    total: Int!
  }

  "One representative file shown on a project, folder or share card."
  type RepFile {
    "The file id."
    id: ID!
    "photo, video or document."
    kind: String!
    "Thumbnail URL (/media/t/{id}?v={n}), null when the file has no thumbnail and the client draws a placeholder."
    thumbnailUrl: String
    "Duration in seconds; currently always null."
    duration: Int
    "File extension, set for documents only."
    extension: String
  }

  "An uploaded file. The original bytes never change; derived outputs are processed versions."
  type MediaFile {
    "Unique id."
    id: ID!
    "Stored file name."
    filename: String!
    "The name the file had when it was uploaded."
    originalName: String!
    "MIME type."
    mimeType: String!
    "Size in bytes."
    size: BigInt!
    "MD5 checksum of the bytes (hex)."
    md5Checksum: String!
    "Thumbnail URL (/media/t/{id}?v={n}), null while the file has no thumbnail."
    thumbnailUrl: String
    "Set when the file was uploaded or copied although identical bytes were already in the project: the id of that original."
    duplicateOf: ID
    "Download URL of the original (cookie session, attachment)."
    downloadUrl: String!
    "Outputs derived from this file (HEIC preview, pipeline results), newest first."
    processedVersions: [ProcessedVersion!]!
    "URL (/media/p/{id}) of the image preview the viewer shows instead of the original (HEIC), null when the original is shown as is."
    previewUrl: String
    "Processing jobs on this file, newest first (at most 20)."
    jobs: [PipelineJob!]!
    "The job a card shows: the newest unfinished job, else one that failed within 24 hours, else null."
    currentJob: PipelineJob
    "The folder that holds the file."
    folder: Folder!
    "Who uploaded the file."
    uploadedBy: User!
    "The project that holds the file."
    project: Project!
    "When the file was moved to the trash, null while live."
    trashedAt: DateTime
    "When the file was uploaded."
    createdAt: DateTime!
  }

  "An output derived from a file, such as a HEIC preview or a pipeline result."
  type ProcessedVersion {
    "Unique id."
    id: ID!
    "preview (the HEIC preview made at upload) or a pipeline kind."
    kind: String!
    "The stored label of the kind, null when none; clients prefer their own translation of known kinds."
    kindLabel: String
    "MIME type of the output."
    mimeType: String!
    "Size in bytes."
    size: BigInt!
    "Download URL (/media/p/{id}): attachment, cookie session, same permission as the file."
    downloadUrl: String!
    "When the version was stored."
    createdAt: DateTime!
  }

  "A processing job on one file."
  type PipelineJob {
    "Unique id."
    id: ID!
    "The job kind, namespace/name, such as shotstash/proxy-720p."
    kind: String!
    "The stored label of the kind, null when none."
    kindLabel: String
    "The file the job processes."
    fileId: ID!
    "Stored status: queued, claimed, running, done, failed or cancelled (the last three are final)."
    status: String!
    "status plus the derived waiting_for_worker (queued while no live worker serves the kind)."
    state: String!
    "Percent done, 0 to 100."
    progress: Int!
    "Attempts made so far."
    attempts: Int!
    "Attempts allowed before the job fails."
    maxAttempts: Int!
    "Last error (failed jobs, and queued jobs retried after one), null when none."
    error: String
    "Grows with every state or progress change; drop events with a lower seq."
    seq: Int!
    "The processed version the job produced (done jobs only)."
    outputVersion: ProcessedVersion
    "When the job was queued."
    createdAt: DateTime!
    "When the job last changed."
    updatedAt: DateTime!
    "When the job reached a final status, null before."
    finishedAt: DateTime
  }

  "A registered processing worker (one per name)."
  type PipelineWorker {
    "Unique id."
    id: ID!
    "Worker name from its manifest."
    name: String!
    "Worker version from its manifest."
    version: String!
    "Job kinds the worker serves."
    kinds: [String!]!
    "When the worker last checked in."
    lastSeen: DateTime!
    "When the worker was revoked, null while allowed."
    revokedAt: DateTime
    "Seen within the lease and not revoked."
    live: Boolean!
    "When the worker first registered."
    createdAt: DateTime!
  }

  "A job kind the Process menu offers for one file."
  type PipelineKindOption {
    "The job kind."
    kind: String!
    "Stored label, null when none; clients prefer their own translation of known kinds."
    label: String
    "A worker serving this kind was seen within the lease (else a new job waits for one)."
    live: Boolean!
    "The file already has an unfinished job of this kind (enqueueJob would answer that job)."
    open: Boolean!
  }

  "A person the mention dropdown offers: an account that may view the project. Typing @handle notifies them."
  type MentionPerson {
    "User id."
    id: ID!
    "Display name."
    name: String!
    "The handle to type after @."
    handle: String!
    "The person's role."
    role: Role!
  }

  "One change in a project, delivered after the commit and after a per-event permission check."
  type ProjectEvent {
    "chat.created (chat is set), job.updated (job is set) or resync (an event was skipped: refetch)."
    type: String!
    "Id of the changed entity."
    id: ID!
    "Orders the events of one entity; drop events with a lower seq."
    seq: Int!
    "The new message, for chat.created."
    chat: ProjectChat
    "The changed job, for job.updated."
    job: PipelineJob
  }

  "A discussion message in a project."
  type ProjectChat {
    "Unique id."
    id: ID!
    "Per-project sequence number; history is ordered by (createdAt, id)."
    seq: Int!
    "Message text."
    message: String!
    "Null for a message a person wrote; upload for the system line added when a file finishes uploading."
    kind: String
    "Who sent the message."
    sender: User!
    "The project of the discussion."
    project: Project!
    "A file the message refers to, null when none."
    referencedFile: MediaFile
    "When the message was sent."
    createdAt: DateTime!
  }

  "A link that shares one file, folder or project with people outside the instance."
  type ShareLink {
    "Unique id."
    id: ID!
    "The slug in the share URL."
    slug: String!
    "The full share URL."
    url: String!
    "Who may open the link."
    mode: ShareMode!
    "When the link stops working, null for no expiry."
    expiresAt: DateTime
    "The shared file, when the target is a file."
    file: MediaFile
    "The shared folder, when the target is a folder."
    folder: Folder
    "The shared project, when the target is a project."
    project: Project
    "file, folder or project."
    targetType: String!
    "Name of the target, null when the target was deleted (the client shows its own label)."
    targetName: String
    "How many times the link was opened."
    accessCount: Int!
    "The access code of a PRIVATE link, returned once by createShareLink and null everywhere else."
    accessCode: String
    "Who created the link."
    createdBy: User!
    "One to three representative files of the target, only delegating: a project target uses Project.repFiles, a folder target Folder.repFiles (the same daily sample), a file target is the file itself while it is ready. Empty, not an error, when the target was deleted or is in the trash."
    repThumbs(
      "How many files to return, clamped to 1 to 3."
      limit: Int = 3
    ): [RepFile!]!
    "When the link was created."
    createdAt: DateTime!
  }

  "An in-app notification for the signed-in user."
  type Notification {
    "Unique id."
    id: ID!
    "Notification type: upload_complete, chat_mention, file_shared or project_created."
    type: String!
    "English fallback title; clients render from type and data."
    title: String!
    "English fallback body; clients render from type and data."
    body: String!
    "Structured details (JSON text), null when none."
    data: String
    "True once marked read."
    read: Boolean!
    "When the notification was created."
    createdAt: DateTime!
  }

  "One resumable upload. Parts (1 to partCount) go to PUT /api/v1/uploads/{id}/parts/{n} with a Content-MD5 header; every part but the last is partSize bytes."
  type UploadSession {
    "Upload session id."
    id: ID!
    "The file this upload fills (status uploading until completion)."
    fileId: ID
    "Name of the file being uploaded."
    filename: String!
    "Total size in bytes."
    totalSize: BigInt!
    "Size of every part but the last, in bytes."
    partSize: Int!
    "Number of parts."
    partCount: Int!
    "IN_PROGRESS, COMPLETING, COMPLETED, FAILED or EXPIRED."
    status: String!
    "Part numbers the server already stored (a resume sends only the rest)."
    confirmedParts: [Int!]!
    "Target project."
    projectId: ID!
    "Target folder."
    folderId: ID!
    "When the session expires if not completed."
    expiresAt: DateTime!
  }

  "Progress of one upload, streamed by the uploadProgress subscription."
  type UploadProgress {
    "Upload session id."
    sessionId: ID!
    "Name of the file being uploaded."
    filename: String!
    "Number of parts."
    partCount: Int!
    "Number of parts stored so far."
    confirmedParts: Int!
    "Percent stored, 0 to 100."
    percentage: Float!
  }

  "An advisory duplicate found before the bytes are sent."
  type DuplicateMatch {
    "Candidate name as sent."
    name: String!
    "Candidate size as sent."
    size: BigInt!
    "Candidate MD5 as sent, null when not sent."
    md5: String
    "name: same name and size (hash the file and ask again with md5); exact: identical bytes are already in the project."
    match: String!
    "Id of the existing file."
    existingFileId: ID!
    "Name of the existing file."
    existingName: String!
  }

  "Result of a sign-in or sign-up."
  type AuthPayload {
    "The signed-in user, null on failure."
    user: User
    "True when the call succeeded."
    success: Boolean!
    "Bearer session token for /api/graphql and /api/v1, null on failure."
    token: String
    "Human-readable message, null when none."
    message: String
    "Stable failure code, such as PASSWORD_TOO_SHORT; null on success."
    errorCode: String
  }

  "Result of an admin action on a user account."
  type AdminActionResult {
    "True when the action succeeded."
    success: Boolean!
    "Human-readable message, null when none."
    message: String
    "A generated password, returned once when adminSetPassword made one; null otherwise."
    password: String
    "Stable failure code (USER_NOT_FOUND, CANNOT_TARGET_SELF, SUPER_ADMIN_PROTECTED, USER_HAS_ACTIVITY, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG, INTERNAL); null on success."
    errorCode: String
    "USER_HAS_ACTIVITY only: uploads that block the delete."
    uploads: Int
    "USER_HAS_ACTIVITY only: share links that block the delete."
    shareLinks: Int
    "USER_HAS_ACTIVITY only: chat messages that block the delete."
    chats: Int
  }

  "Result of a self-service password reset step (code sent by email)."
  type PasswordResetResult {
    "True when the step succeeded."
    success: Boolean!
    "Human-readable message, null when none."
    message: String
    "Set only by a successful verifyPasswordResetCode: single use, valid for 10 minutes."
    resetToken: String
    "Failure kind: UNAVAILABLE, RATE_LIMITED, INVALID_EMAIL, INVALID_CODE, CODE_LOCKED, TOKEN_INVALID, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG, PASSWORD_MISMATCH or INTERNAL; null on success."
    errorCode: String
    "INVALID_CODE only: wrong tries left before the code is cancelled."
    attemptsLeft: Int
  }

  "Storage usage of the instance."
  type StorageStats {
    "Storage backend: local or s3."
    backend: String!
    "Disk size in bytes; null when the backend cannot tell (S3)."
    totalSpace: Float
    "Bytes used by stored media."
    usedSpace: Float!
    "Free disk space in bytes; null when the backend cannot tell (S3)."
    freeSpace: Float
    "Number of files."
    totalFiles: Int!
    "Number of projects."
    totalProjects: Int!
  }

  "Filters for the project list. Reserved: the server currently returns every project the caller may view and filters on the client."
  input ProjectFilter {
    "Reserved: a project status to filter by (currently ignored)."
    status: ProjectStatus
    "Reserved: title text to filter by (currently ignored)."
    search: String
  }

  "Starts a resumable upload."
  input InitiateUploadInput {
    "File name."
    filename: String!
    "Total size in bytes."
    totalSize: BigInt!
    "MD5 of the whole file (hex), when the client already computed it."
    md5Checksum: String
    "Target project."
    projectId: ID!
    "Target folder."
    folderId: ID!
    "Upload anyway although identical bytes may already be in the project."
    allowDuplicate: Boolean
  }

  "One file to check for duplicates before uploading."
  input DuplicateCandidateInput {
    "File name."
    name: String!
    "Size in bytes."
    size: BigInt!
    "MD5 of the file (hex), when computed."
    md5: String
  }

  "A new share link. Set exactly one of fileId, folderId and projectId."
  input ShareLinkInput {
    "Share this file."
    fileId: ID
    "Share this folder."
    folderId: ID
    "Share this project."
    projectId: ID
    "Who may open the link."
    mode: ShareMode!
    "Hours until the link expires; omit for no expiry."
    expiresInHours: Int
  }

  "Fields of a project to create or update."
  input CreateProjectInput {
    "Project title."
    title: String!
    "Optional description."
    description: String
    "Optional cover image URL."
    coverImage: String
  }

  "A new account."
  input CreateUserInput {
    "Display name."
    name: String!
    "Sign-in email address."
    email: String!
    "Password."
    password: String!
    "Role, honoured only when an admin creates the account."
    role: Role
    "Answers to the sign-up questions (JSON text)."
    signupAnswers: String
  }

  "Read operations. Every field needs a session unless noted as public."
  type Query {
    "Accounts waiting for sign-up approval. Needs users.manage."
    pendingUsers: [User!]!
    "The signed-in user. Public: null when the token is missing or expired or the account is deactivated."
    me: User
    "Public: true when password reset by email is available."
    passwordResetAvailable: Boolean!
    "Projects the caller may view, newest first."
    projects(
      "Reserved filters (currently ignored)."
      filter: ProjectFilter
    ): [ProjectSummary!]!
    "One project, null when it does not exist or the caller may not view it."
    project(
      "Project id."
      id: ID!
    ): Project
    "One folder, null when it does not exist or the caller may not view it."
    folder(
      "Folder id."
      id: ID!
    ): Folder
    "Files whose name matches the query."
    searchFiles(
      "Search text."
      query: String!
      "Limit the search to this project."
      projectId: ID
    ): [MediaFile!]!
    "Folders whose name matches the query."
    searchFolders(
      "Search text."
      query: String!
      "Limit the search to this project."
      projectId: ID
    ): [Folder!]!
    "Processed versions of one live file, newest first."
    processedVersions(
      "File id."
      fileId: ID!
    ): [ProcessedVersion!]!
    "One processing job, null when it or its file is gone."
    pipelineJob(
      "Job id."
      id: ID!
    ): PipelineJob
    "Registered workers, most recently seen first. Needs instance.configure (super admin)."
    pipelineWorkers: [PipelineWorker!]!
    "Job kinds that apply to one live file. Needs pipeline.trigger."
    availableKinds(
      "File id."
      fileId: ID!
    ): [PipelineKindOption!]!
    "People who may view the project, for the mention dropdown (at most 20). FEATURE_DISABLED while discussion is off."
    mentionPeople(
      "Project id."
      projectId: ID!
      "Only people whose name contains this text."
      query: String
    ): [MentionPerson!]!
    "Share links: every team link for admins, the caller's own links otherwise. On a demo instance a read-only account sees the demo Project's links. Any signed-in role may list; creating and revoking need share.manage."
    shareLinks: [ShareLink!]!
    "Share links of exactly one target, newest first, with the same visibility as shareLinks. Set one of the ids."
    shareLinksForTarget(
      "Target file."
      fileId: ID
      "Target folder."
      folderId: ID
      "Target project."
      projectId: ID
    ): [ShareLink!]!
    "Resume state of one of the caller's uploads, null when not found."
    uploadSession(
      "Upload session id."
      id: ID!
    ): UploadSession
    "Advisory duplicate check before upload: by name and size, then by MD5."
    checkDuplicates(
      "Target project."
      projectId: ID!
      "Files to check."
      candidates: [DuplicateCandidateInput!]!
    ): [DuplicateMatch!]!
    "Files in the trash the caller may see. Needs trash.view."
    allTrashedFiles: [MediaFile!]!
    "Folders in the trash the caller may see. Needs trash.view."
    allTrashedFolders: [Folder!]!
    "The caller's notifications, newest first (at most 50)."
    notifications(
      "Only unread notifications."
      unreadOnly: Boolean
    ): [Notification!]!
    "Number of the caller's unread notifications."
    unreadNotificationCount: Int!
    "Every account. Needs users.manage."
    users: [User!]!
    "Storage usage of the instance. Needs instance.configure."
    storageStats: StorageStats!
  }

  "Write operations. Every field needs a session unless noted as public."
  type Mutation {
    "Public: signs in with email and password."
    login(
      "Email address."
      email: String!
      "Password."
      password: String!
    ): AuthPayload!
    "Public: ends the current session, if any."
    logout: Boolean!
    "Public: creates an account (sign-up when open; an admin may also create accounts)."
    register(
      "The new account."
      input: CreateUserInput!
    ): AuthPayload!
    "Public: sends a reset code by email. The answer is the same for every address."
    requestPasswordReset(
      "Email address."
      email: String!
    ): PasswordResetResult!
    "Public: checks a reset code and returns a single-use reset token."
    verifyPasswordResetCode(
      "Email address."
      email: String!
      "The code from the email."
      code: String!
    ): PasswordResetResult!
    "Public: sets a new password with a reset token."
    completePasswordReset(
      "Token from verifyPasswordResetCode."
      resetToken: String!
      "The new password."
      newPassword: String!
      "The new password again."
      confirmPassword: String!
    ): PasswordResetResult!
    "Updates the caller's own profile; omitted arguments stay unchanged."
    updateProfile(
      "New display name."
      name: String
      "New avatar URL."
      avatarUrl: String
      "New UI locale."
      locale: String
    ): User!
    "Creates a project. Needs section.create."
    createProject(
      "The project fields."
      input: CreateProjectInput!
    ): Project!
    "Updates a project. Needs item.move."
    updateProject(
      "Project id."
      id: ID!
      "The new project fields."
      input: CreateProjectInput!
    ): Project!
    "Deletes a project. Needs trash.purge."
    deleteProject(
      "Project id."
      id: ID!
    ): Boolean!
    "Creates a folder. Needs section.create."
    createFolder(
      "Project id."
      projectId: ID!
      "Folder name."
      name: String!
      "Parent folder, omitted for the top level."
      parentId: ID
    ): Folder!
    "Renames a folder. Needs item.move."
    renameFolder(
      "Folder id."
      folderId: ID!
      "New name."
      name: String!
    ): Folder!
    "Moves a file to another folder. Needs item.move."
    moveFile(
      "File id."
      fileId: ID!
      "Destination folder."
      targetFolderId: ID!
    ): MediaFile!
    "Copies a file into another folder. Needs upload."
    copyFile(
      "File id."
      fileId: ID!
      "Destination folder."
      targetFolderId: ID!
    ): MediaFile!
    "Moves a folder under another folder or to the top level of a project. Needs item.move."
    moveFolder(
      "Folder id."
      folderId: ID!
      "Destination parent folder; omit for the top level."
      targetFolderId: ID
      "Destination project, when moving to another project."
      targetProjectId: ID
    ): Folder!
    "Starts a resumable upload; parts travel over REST (see UploadSession). Needs upload."
    initiateUpload(
      "The upload."
      input: InitiateUploadInput!
    ): UploadSession!
    "Completes an upload after every part is stored and returns the file."
    completeUpload(
      "Upload session id."
      sessionId: ID!
      "MD5 of the whole file (hex), when not sent at initiate."
      md5Checksum: String
      "Ignored since HEIC originals are kept as uploaded and get a preview version; kept for one release so older clients keep working."
      convertHeic: Boolean @deprecated(reason: "Ignored: HEIC originals are kept and get a preview version.")
    ): MediaFile!
    "Cancels one of the caller's uploads."
    cancelUpload(
      "Upload session id."
      sessionId: ID!
    ): Boolean!
    "Queues a processing job on a live file. When the file already has an unfinished job of the same kind, returns that job instead of queueing a second one. Errors: KIND_UNKNOWN (no such kind), KIND_NOT_APPLICABLE (the kind does not accept this file type), NOT_FOUND (the file is gone, in the trash or not ready). Needs pipeline.trigger."
    enqueueJob(
      "File id."
      fileId: ID!
      "Job kind, such as shotstash/proxy-720p."
      kind: String!
    ): PipelineJob!
    "Stops a queued, claimed or running job and returns it cancelled; a worker holding it learns on its next call (409 JOB_TERMINAL). Errors: JOB_TERMINAL when the job already finished (done, failed or cancelled), NOT_FOUND when there is no such job. Needs pipeline.trigger."
    cancelJob(
      "Job id."
      id: ID!
    ): PipelineJob!
    "Revokes a worker: its token stops working and its name cannot register again. Null when there is no such worker. Needs instance.configure."
    revokeWorker(
      "Worker id."
      id: ID!
    ): PipelineWorker
    "Creates a share link. Needs share.manage."
    createShareLink(
      "The link."
      input: ShareLinkInput!
    ): ShareLink!
    "Revokes a share link. Needs share.manage."
    revokeShareLink(
      "Share link id."
      id: ID!
    ): Boolean!
    "Marks all of the caller's notifications read."
    markNotificationsRead: Boolean!
    "Public: signs in (or signs up) with a Google ID token."
    googleAuth(
      "Google ID token."
      idToken: String!
    ): AuthPayload!
    "Posts a discussion message; @handles notify the people named. Needs discussion.use."
    sendMessage(
      "Project id."
      projectId: ID!
      "Message text."
      message: String!
      "A file the message refers to."
      referencedFileId: ID
    ): ProjectChat!
    "Moves a file to the trash. Needs item.trash."
    moveToTrash(
      "File id."
      fileId: ID!
    ): Boolean!
    "Restores a file from the trash. Needs item.trash."
    restoreFile(
      "File id."
      fileId: ID!
    ): MediaFile!
    "Deletes a trashed file for good. Needs trash.purge."
    permanentDelete(
      "File id."
      fileId: ID!
    ): Boolean!
    "Moves a folder and its content to the trash. Needs item.trash."
    moveFolderToTrash(
      "Folder id."
      folderId: ID!
    ): Boolean!
    "Restores a folder from the trash. Needs item.trash."
    restoreFolder(
      "Folder id."
      folderId: ID!
    ): Folder!
    "Deletes a trashed folder and its content for good. Needs trash.purge."
    permanentDeleteFolder(
      "Folder id."
      folderId: ID!
    ): Boolean!
    "Finishes the caller's onboarding with the role asked for."
    completeOnboarding(
      "The role asked for."
      requestedRole: Role!
      "Answers to the sign-up questions (JSON text)."
      signupAnswers: String
    ): User!
    "Approves a pending account with a role. Needs users.manage."
    approveUser(
      "User id."
      userId: ID!
      "The role to give."
      role: Role!
    ): User!
    "Rejects a pending account. Needs users.manage."
    rejectUser(
      "User id."
      userId: ID!
    ): User!
    "Changes an account's role. Needs users.manage."
    updateUserRole(
      "User id."
      userId: ID!
      "The new role."
      role: Role!
    ): User!
    "Deactivates an account and ends its sessions. Needs users.manage."
    deactivateUser(
      "User id."
      id: ID!
    ): User!
    "Reactivates a deactivated account. Needs users.manage."
    reactivateUser(
      "User id."
      id: ID!
    ): User!
    "Super admin only: sets an account's password; without newPassword a random one is returned once in password."
    adminSetPassword(
      "User id."
      userId: ID!
      "The new password; omit to generate one."
      newPassword: String
    ): AdminActionResult!
    "Super admin only: deletes an account that has no uploads, share links or chat messages."
    deleteUser(
      "User id."
      id: ID!
    ): AdminActionResult!
  }

  "Live streams over WebSocket (graphql-ws). Every stream needs a session, re-checks it and the permission on each event, and ends when the session is revoked or the account deactivated."
  type Subscription {
    "Progress of one of the caller's uploads."
    uploadProgress(
      "Upload session id."
      sessionId: ID!
    ): UploadProgress!
    "New discussion messages of a project."
    chatMessages(
      "Project id."
      projectId: ID!
    ): ProjectChat!
    "New notifications for the caller."
    notificationReceived: Notification!
    "Changes of one job (anyone who may view its file may follow it)."
    jobUpdated(
      "Job id."
      jobId: ID!
    ): PipelineJob!
    "Discussion messages (while discussion is on) and job changes of one project."
    projectEvents(
      "Project id."
      projectId: ID!
    ): ProjectEvent!
  }
`;
