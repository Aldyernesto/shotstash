import { promises as fs } from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { createNotification } from './notification.service';

const STORAGE_LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT || './data/media';
const PROJECTS_PATH = path.join(STORAGE_LOCAL_ROOT, 'projects');

// Utility to sanitize strings for folder names
export function sanitizeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

export async function createProject(title: string, description?: string, coverImage?: string) {
  // 1. Create in Database
  const project = await prisma.project.create({
    data: {
      title,
      description,
      coverImage: coverImage || null,
      status: 'ACTIVE',
    },
  });

  // 2. Create Physical Directory on NAS
  // Format: [SanitizedTitle]-[ProjectID]
  const dirName = `${sanitizeName(title)}-${project.id}`;
  const dirPath = path.join(PROJECTS_PATH, dirName);

  await fs.mkdir(dirPath, { recursive: true });

  // 3. Auto-create default folders: Video, Photo, Dokumen
  const defaultFolders = ['Video', 'Photo', 'Dokumen'];
  for (const folderName of defaultFolders) {
    const folder = await prisma.folder.create({
      data: {
        name: folderName,
        projectId: project.id,
      },
    });
    const folderDirName = `${sanitizeName(folderName)}-${folder.id}`;
    const folderPath = path.join(dirPath, folderDirName);
    await fs.mkdir(folderPath, { recursive: true });
  }

  // Notify all users about new project
  const users = await prisma.user.findMany({ select: { id: true } });
  for (const u of users) {
    createNotification({
      userId: u.id, type: 'project_created',
      title: 'New Project', body: `${title} has been created`,
      data: { projectId: project.id },
    }).catch(() => {});
  }

  return prisma.project.findUnique({
    where: { id: project.id },
    include: { folders: true },
  }) as Promise<any>;
}

export async function getProjectPhysicalPath(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error('Project not found');
  
  const dirName = `${sanitizeName(project.title)}-${project.id}`;
  return path.join(PROJECTS_PATH, dirName);
}
