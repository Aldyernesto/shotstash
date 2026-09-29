// Shotstash — GraphQL Type Definitions
// Layer 2: API Gateway

export const typeDefs = `#graphql
  scalar DateTime
  scalar BigInt
  scalar Upload

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

  # Story 2.4: satu file perwakilan. thumbnailUrl = /media/t/{id}
  # bila thumbnailPath ada, selain itu null (klien merender placeholder);
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
    thumbnailUrl: String
    thumbnailPath: String
    downloadUrl: String!
    folder: Folder!
    uploadedBy: User!
    project: Project!
    trashedAt: DateTime
    createdAt: DateTime!
  }

  type ProjectChat {
    id: ID!
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

  type UploadSession {
    id: ID!
    filename: String!
    totalSize: BigInt!
    chunkSize: Int!
    totalChunks: Int!
    uploadedChunks: Int!
    status: String!
    uploadMode: String!
    presignedUrl: String
    r2Key: String
  }

  type UploadProgress {
    sessionId: ID!
    filename: String!
    totalChunks: Int!
    uploadedChunks: Int!
    percentage: Float!
    speed: Float
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

  type ChunkResult {
    chunkIndex: Int!
    received: Boolean!
    uploadedChunks: Int!
    totalChunks: Int!
  }

  type StorageStats {
    totalSpace: Float!
    usedSpace: Float!
    freeSpace: Float!
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
    md5Checksum: String
    projectId: ID!
    folderId: ID
    clientLatencyMs: Int
    clientChunkSize: Int
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

    # Shares
    shareLinks: [ShareLink!]!
    # Story 4.4 (aditif): link untuk TEPAT SATU target (file / Section /
    # Project) — hak lihat sama dengan shareLinks: SUPER_ADMIN/ADMIN semua
    # link tim, role lain hanya miliknya. Urut createdAt menurun.
    shareLinksForTarget(fileId: ID, folderId: ID, projectId: ID): [ShareLink!]!

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

    # Upload (Multipart Chunking)
    initiateUpload(input: InitiateUploadInput!): UploadSession!
    uploadChunk(sessionId: ID!, chunkIndex: Int!, data: Upload!): ChunkResult!
    completeUpload(sessionId: ID!, r2Key: String, convertHeic: Boolean): MediaFile!
    cancelUpload(sessionId: ID!): Boolean!

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

  type Subscription {
    uploadProgress(sessionId: ID!): UploadProgress!
    chatMessages(projectId: ID!): ProjectChat!
    notificationReceived: Notification!
  }
`;
