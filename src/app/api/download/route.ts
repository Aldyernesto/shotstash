import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import archiver from 'archiver';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

type DownloadUser = { id: string; role: string } | null;
function isVideoMime(mime?: string | null) { return String(mime || '').startsWith('video/'); }
async function descendantFolderIds(rootId: string): Promise<string[]> {
  const all = await prisma.folder.findMany({ where: { trashedAt: null }, select: { id: true, parentId: true } });
  const out = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of all) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); changed = true; }
  }
  return [...out];
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId');
  const fileIds = url.searchParams.get('fileIds')?.split(',').filter(Boolean) || [];
  const folderId = url.searchParams.get('folderId');
  const folderIds = url.searchParams.get('folderIds')?.split(',').filter(Boolean) || [];
  const token = url.searchParams.get('token');
  const inline = url.searchParams.get('inline') === '1';

  if (!projectId && !fileIds.length && !folderId && !folderIds.length) {
    return NextResponse.json({ error: 'projectId, fileIds, or folderId is required' }, { status: 400 });
  }

  const shareSlug = url.searchParams.get('shareSlug');

  // Authenticate: share link OR session token
  let authenticated = false;
  let authUser: DownloadUser = null;

  if (shareSlug) {
    // Public share link download — validate share link covers the requested resource
    const share = await prisma.shareLink.findUnique({ where: { slug: shareSlug } });
    if (share && (!share.expiresAt || share.expiresAt > new Date())) {
      // Verify the share link actually covers the requested file/folder
      const coversFile = fileIds.length > 0 && share.fileId && fileIds.includes(share.fileId);
      const coversFolder = folderId && share.folderId === folderId;
      const coversFolderIds = folderIds.length > 0 && share.projectId2 && projectId === share.projectId2;
      const coversProject = projectId && share.projectId2 === projectId;

      // Story 3.9: tombol unduh PER FILE di halaman share. Sebelumnya
      // permintaan ini ditolak 401 untuk link Section/Project — hanya link
      // file tunggal yang lolos — sehingga "jalan lain untuk mengambil
      // isinya" di AC tidak pernah berfungsi. File yang diminta dianggap
      // tercakup bila ia BENAR-BENAR berada di dalam yang dibagikan.
      let coversFileInShare = false;
      if (!coversFile && !coversFolder && !coversFolderIds && !coversProject && fileIds.length > 0) {
        if (share.folderId) {
          const scope = await descendantFolderIds(share.folderId);
          const n = await prisma.mediaFile.count({
            where: { id: { in: fileIds }, trashedAt: null, folderId: { in: scope } },
          });
          coversFileInShare = n === fileIds.length;
        } else if (share.projectId2) {
          const n = await prisma.mediaFile.count({
            where: { id: { in: fileIds }, trashedAt: null, projectId: share.projectId2 },
          });
          coversFileInShare = n === fileIds.length;
        }
      }

      if (coversFile || coversFolder || coversFolderIds || coversProject || coversFileInShare) {
        authenticated = true;
        // Increment access count
        await prisma.shareLink.update({ where: { slug: shareSlug }, data: { accessCount: { increment: 1 } } }).catch(() => {});
      }
    }
  }

  if (!authenticated) {
    // Fall back to session auth
    const authHeader = req.headers.get('authorization');
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : token;
    if (!authToken) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const session = await prisma.session.findUnique({
      where: { token: authToken },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }
    authUser = { id: session.user.id, role: session.user.role };
  }

  try {
    // 1. DIRECT STREAM: Single file, no folder context (supports Range for parallel download)
    if (fileIds.length === 1 && !folderId) {
      const file = await prisma.mediaFile.findUnique({
        where: { id: fileIds[0] },
      });

      if (!file || (projectId && file.projectId !== projectId)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const fileStat = await stat(file.storagePath);
      const rangeHeader = req.headers.get('range');

      if (rangeHeader) {
        // Handle Range request for parallel chunk download (IDM-style)
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
        const chunkSize = end - start + 1;

        const readStream = createReadStream(file.storagePath, { start, end });
        const webStream = new ReadableStream({
          start(controller) {
            readStream.on('data', (chunk) => controller.enqueue(chunk));
            readStream.on('end', () => controller.close());
            readStream.on('error', (err) => controller.error(err));
          },
          cancel() { readStream.destroy(); }
        });

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            'Content-Type': file.mimeType,
            'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
            'Content-Length': chunkSize.toString(),
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const readStream = createReadStream(file.storagePath);
      const webStream = new ReadableStream({
        start(controller) {
          readStream.on('data', (chunk) => controller.enqueue(chunk));
          readStream.on('end', () => controller.close());
          readStream.on('error', (err) => controller.error(err));
        },
        cancel() { readStream.destroy(); }
      });

      const disposition = inline ? 'inline' : 'attachment';
      return new NextResponse(webStream, {
        headers: {
          'Content-Type': file.mimeType,
          'Content-Disposition': `${disposition}; filename="${encodeURIComponent(file.originalName)}"`,
          'Content-Length': fileStat.size.toString(),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    // 2. BULK / FOLDER DOWNLOAD: On-the-fly Zipping
    const archive = archiver('zip', {
      zlib: { level: 1 } // level 1 for speed (fastest compression)
    });

    // Skip missing files so one orphan doesn't break the whole ZIP stream.
    const skipped: string[] = [];
    async function addFileIfExists(storagePath: string, zipName: string) {
      try {
        await stat(storagePath);
        archive.file(storagePath, { name: zipName });
      } catch {
        skipped.push(zipName);
        console.warn(`[download] skip missing file: ${storagePath}`);
      }
    }

    // We'll collect all files to zip
    // Helper to recursively fetch files in a folder
    async function getFilesInFolder(fId: string, currentPath: string = '') {
      const folder = await prisma.folder.findUnique({
        where: { id: fId },
        include: { files: true, children: true }
      });
      if (!folder) return;

      const folderPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;

      // Always add folder entry (even if empty) via a zero-byte marker
      if (folder.files.length === 0 && folder.children.length === 0) {
        archive.append('', { name: `${folderPath}/` });
      }

      for (const file of folder.files) {
        await addFileIfExists(file.storagePath, `${folderPath}/${file.originalName}`);
      }

      for (const child of folder.children) {
        await getFilesInFolder(child.id, folderPath);
      }
    }

    if (folderIds.length > 0) {
      for (const fId of folderIds) {
        await getFilesInFolder(fId);
      }
    } else if (folderId) {
      await getFilesInFolder(folderId);
    } else if (fileIds.length > 0) {
      const files = await prisma.mediaFile.findMany({
        where: { id: { in: fileIds }, ...(projectId ? { projectId } as any : {}) },
      });

      for (const file of files) {
        await addFileIfExists(file.storagePath, file.originalName);
      }
    } else {
      return NextResponse.json({ error: 'Provide fileIds or folderId' }, { status: 400 });
    }

    if (skipped.length > 0) {
      // Embed a manifest of skipped files inside the zip so the user knows
      const note = `The following files were skipped because they could not be found on storage:\n\n${skipped.map(s => `  - ${s}`).join('\n')}\n\nContact admin if this list is unexpected.`;
      archive.append(note, { name: '_MISSING_FILES.txt' });
    }

    const webStream = new ReadableStream({
      start(controller) {
        archive.on('data', (chunk) => controller.enqueue(chunk));
        archive.on('end', () => controller.close());
        archive.on('error', (err) => controller.error(err));
        
        // Start archiving
        archive.finalize();
      },
      cancel() {
        archive.abort();
      }
    });

    const zipFilename = folderIds.length > 0 ? `project_${folderIds[0].slice(0,8)}.zip` : folderId ? `folder_${folderId}.zip` : `bulk_download_${Date.now()}.zip`;

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        // Content-Length is not set because we stream dynamically
      },
    });

  } catch (err: any) {
    console.error('Download error:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
