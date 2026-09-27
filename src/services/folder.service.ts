import { promises as fs } from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { getProjectPhysicalPath, sanitizeName } from './project.service';

export async function createFolder(projectId: string, name: string, parentId?: string) {
  // 1. Validate project
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error('Project not found');

  // 2. Resolve paths
  const projectPhysicalPath = await getProjectPhysicalPath(projectId);
  let parentPhysicalPath = projectPhysicalPath;

  // Validate parent folder if provided
  if (parentId) {
    const parent = await prisma.folder.findUnique({ where: { id: parentId } });
    if (!parent) throw new Error('Parent folder not found');
    if (parent.projectId !== projectId) throw new Error('Parent folder belongs to a different project');
    
    // We would need a recursive function to build the full path if folders are deeply nested,
    // but for now, let's store folders physically as flat under the project, OR deeply nested.
    // Deeply nested is better for NAS readability.
    parentPhysicalPath = await getFolderPhysicalPath(parentId);
  }

  // 3. Create Database Record
  const folder = await prisma.folder.create({
    data: {
      name,
      projectId,
      parentId: parentId || null,
    },
  });

  // 4. Create Physical Directory
  const dirName = `${sanitizeName(name)}-${folder.id}`;
  const dirPath = path.join(parentPhysicalPath, dirName);
  await fs.mkdir(dirPath, { recursive: true });

  return folder;
}

export async function getFolderPhysicalPath(folderId: string): Promise<string> {
  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder) throw new Error('Folder not found');

  if (folder.parentId) {
    const parentPath = await getFolderPhysicalPath(folder.parentId);
    return path.join(parentPath, `${sanitizeName(folder.name)}-${folder.id}`);
  } else {
    const projectPath = await getProjectPhysicalPath(folder.projectId);
    return path.join(projectPath, `${sanitizeName(folder.name)}-${folder.id}`);
  }
}
