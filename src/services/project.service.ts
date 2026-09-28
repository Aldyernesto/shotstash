import { promises as fs } from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { createNotification } from './notification.service';
import { storageRoot } from '../lib/storageRoot';
import { codedError } from '@/modules/errors';

const projectsPath = () => path.join(storageRoot(), 'projects');

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
  const dirPath = path.join(projectsPath(), dirName);

  await fs.mkdir(dirPath, { recursive: true });

  // 3. Auto-create the default Sections: Video, Photo, Documents
  const defaultFolders = ['Video', 'Photo', 'Documents'];
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
      title: 'New project', body: `${title} was created`,
      data: { projectId: project.id, projectTitle: title },
    }).catch(() => {});
  }

  return prisma.project.findUnique({
    where: { id: project.id },
    include: { folders: true },
  }) as Promise<any>;
}

export async function getProjectPhysicalPath(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw codedError('NOT_FOUND', 'Project not found');
  
  const dirName = `${sanitizeName(project.title)}-${project.id}`;
  return path.join(projectsPath(), dirName);
}
