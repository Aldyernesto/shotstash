// Shotstash — Upload Service
// Layer 3: Business Logic
// Multipart Concurrent Upload (IDM-style chunking)

import { createHash } from 'crypto';
import { promises as fs, createWriteStream, createReadStream } from 'fs';
import path from 'path';
import prisma from '@/lib/prisma';
import { pubsub } from '../lib/pubsub';
import { dfPublisher } from '../lib/dragonfly';
import { bigIntToNumber } from '../lib/bigint';
import { getProjectPhysicalPath } from './project.service';
import { getFolderPhysicalPath } from './folder.service';
import { generateThumbnail, needsThumbnail } from './thumbnail.service';
import { createNotification } from './notification.service';
import { maybeConvertHeicToJpg } from './heic-convert.service';

// ============================================
// Configuration
// ============================================

const STORAGE_LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT || './data/media';
const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB per chunk (web default)

export const STORAGE_PATHS = {
  projects: path.join(STORAGE_LOCAL_ROOT, 'projects'),
  tempUploads: path.join(STORAGE_LOCAL_ROOT, 'uploads', 'temp'),
  thumbnails: path.join(STORAGE_LOCAL_ROOT, 'thumbnails'),
};

// ============================================
// Initiate Upload Session
// ============================================

export async function initiateUpload(data: {
  filename: string;
  totalSize: bigint;
  md5Checksum?: string;
  projectId: string;
  folderId: string;
  uploadedById: string;
  clientLatencyMs?: number;
  clientChunkSize?: number;
  countryCode?: string;
}) {
  // Use client-requested chunk size if provided (mobile sends 5MB), else default 50MB (web)
  const chunkSize = data.clientChunkSize && data.clientChunkSize > 0
    ? Math.min(data.clientChunkSize, DEFAULT_CHUNK_SIZE)
    : DEFAULT_CHUNK_SIZE;
  const totalChunks = Math.ceil(Number(data.totalSize) / chunkSize);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const uploadMode = 'direct' as const;

  const session = await prisma.uploadSession.create({
    data: {
      filename: data.filename,
      totalSize: data.totalSize,
      chunkSize,
      totalChunks,
      md5Expected: data.md5Checksum,
      projectId: data.projectId,
      folderId: data.folderId,
      uploadedById: data.uploadedById,
      expiresAt,
    },
  });

  // Direct mode: siapkan temp dir di NAS
  const tempDir = path.join(STORAGE_PATHS.tempUploads, session.id);
  await fs.mkdir(tempDir, { recursive: true });

  return { session, uploadMode, presignedUrl: null, r2Key: null };
}

// ============================================
// Upload Single Chunk
// ============================================

export async function uploadChunk(data: {
  sessionId: string;
  chunkIndex: number;
  chunkData: Buffer;
}) {
  const session = await prisma.uploadSession.findUnique({
    where: { id: data.sessionId },
  });

  if (!session) throw new Error('Upload session tidak ditemukan');
  if (session.status !== 'IN_PROGRESS') throw new Error('Upload session sudah selesai atau gagal');

  // Simpan chunk ke temp directory di NAS
  const chunkPath = path.join(
    STORAGE_PATHS.tempUploads,
    data.sessionId,
    `chunk_${data.chunkIndex.toString().padStart(5, '0')}`
  );

  await fs.writeFile(chunkPath, data.chunkData);

  // Update counter
  const updated = await prisma.uploadSession.update({
    where: { id: data.sessionId },
    data: { uploadedChunks: { increment: 1 } },
  });

  // Publish progress via Dragonfly PubSub
  const percentage = (updated.uploadedChunks / session.totalChunks) * 100;
  pubsub.publish(`UPLOAD_PROGRESS_${session.id}`, {
    uploadProgress: {
      sessionId: session.id,
      filename: session.filename,
      totalChunks: session.totalChunks,
      uploadedChunks: updated.uploadedChunks,
      percentage,
      speed: 0 // TODO: calculate speed
    }
  }).catch(() => {});

  return {
    chunkIndex: data.chunkIndex,
    received: true,
    uploadedChunks: updated.uploadedChunks,
    totalChunks: session.totalChunks,
  };
}

// ============================================
// Complete Upload — Reassemble Chunks
// ============================================

export async function completeUpload(sessionId: string, _r2Key?: string | null, convertHeic: boolean = true) {
  const session = await prisma.uploadSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) throw new Error('Upload session tidak ditemukan');

  const tempDir = path.join(STORAGE_PATHS.tempUploads, sessionId);

  // Determine final path
  const ext = path.extname(session.filename);
  const storedFilename = `${sessionId}${ext}`;
  const finalDir = await getFolderPhysicalPath(session.folderId);
  await fs.mkdir(finalDir, { recursive: true });
  const finalPath = path.join(finalDir, storedFilename);

  // Stream chunks to final file — avoids loading entire file into memory
  const md5Hash = createHash('md5');
  const writeStream = createWriteStream(finalPath);

  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = path.join(tempDir, `chunk_${i.toString().padStart(5, '0')}`);
    const chunkStream = createReadStream(chunkPath);
    await new Promise<void>((resolve, reject) => {
      chunkStream.on('data', (data) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        writeStream.write(buf);
        md5Hash.update(buf);
      });
      chunkStream.on('end', resolve);
      chunkStream.on('error', reject);
    });
  }

  // Close write stream and wait for finish
  await new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    writeStream.end();
  });

  const md5Checksum = md5Hash.digest('hex');

  // Verify MD5 if client provided expected hash
  if (session.md5Expected && session.md5Expected !== md5Checksum) {
    await fs.unlink(finalPath).catch(() => {});
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: 'FAILED' },
    });
    throw new Error('MD5 checksum mismatch — file corrupt selama upload');
  }

  // Auto-convert HEIC/HEIF → JPEG before recording (unless caller opted out)
  const converted = convertHeic
    ? await maybeConvertHeicToJpg(
        finalPath,
        session.filename,
        detectMimeType(session.filename),
      ).catch((err) => {
        console.warn('[upload] HEIC conversion failed, keeping original:', err?.message);
        return null;
      })
    : null;
  const effectivePath = converted?.converted ? converted.storagePath : finalPath;
  const effectiveName = converted?.converted ? converted.originalName : session.filename;
  const effectiveMime = converted?.converted ? converted.mimeType : detectMimeType(session.filename);
  const effectiveSize = converted?.converted ? BigInt(converted.size) : session.totalSize;
  const effectiveStoredFilename = converted?.converted
    ? path.basename(effectivePath)
    : storedFilename;

  // Generate thumbnail for RAW/heic/tiff formats
  let thumbnailPath: string | null = null;
  if (needsThumbnail(effectiveName)) {
    thumbnailPath = await generateThumbnail(effectivePath, sessionId);
  }

  // Hapus temp chunks
  await fs.rm(tempDir, { recursive: true, force: true });

  // Buat record MediaFile di database
  const mediaFile = await prisma.mediaFile.create({
    data: {
      filename: effectiveStoredFilename,
      originalName: effectiveName,
      mimeType: effectiveMime,
      size: effectiveSize,
      md5Checksum,
      storagePath: effectivePath,
      thumbnailPath: thumbnailPath,
      folderId: session.folderId,
      projectId: session.projectId,
      uploadedById: session.uploadedById,
    },
    include: {
      uploadedBy: true,
      project: true,
      folder: true,
    },
  });

  // Update session status
  await prisma.uploadSession.update({
    where: { id: sessionId },
    data: { status: 'COMPLETED' },
  });

  // System Bot ngirim notifikasi ke Project Chat
  const botMessage = `File ${session.filename} berhasil di-upload dan selesai dirakit!`;
  const chat = await prisma.projectChat.create({
    data: {
      message: botMessage,
      projectId: session.projectId,
      senderId: session.uploadedById, // or bot ID if a bot user exists
      referencedFileId: mediaFile.id,
    },
    include: {
      sender: true,
      project: true,
      referencedFile: true,
    }
  });

  const safeChat = bigIntToNumber(chat);
  pubsub.publish(`CHAT_MESSAGES_${session.projectId}`, { chatMessages: safeChat }).catch(() => {});

  // Notify project members
  const projectMembers = await prisma.user.findMany({ select: { id: true }});
  console.log('[notif] members found:', projectMembers.length);
  for (const member of projectMembers) {
    console.log('[notif] creating for:', member.id);
    try {
      await createNotification({
        userId: member.id, type: 'upload_complete',
        title: 'File Uploaded', body: `${session.filename} added to project`,
        data: { projectId: session.projectId, fileId: mediaFile.id },
      });
      console.log('[notif] created for:', member.id);
    } catch (err: any) {
      console.error('[notif] error:', err.message, err.stack);
    }
  }

  return bigIntToNumber(mediaFile) as typeof mediaFile;
}

// ============================================
// Helper Functions
// ============================================

function detectMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.dng': 'image/x-adobe-dng',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ============================================
// Cleanup Expired Sessions
// ============================================

export async function cleanupExpiredSessions() {
  const expired = await prisma.uploadSession.findMany({
    where: {
      status: 'IN_PROGRESS',
      expiresAt: { lt: new Date() },
    },
  });

  for (const session of expired) {
    const tempDir = path.join(STORAGE_PATHS.tempUploads, session.id);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'FAILED' },
    });
  }

  return expired.length;
}
