import prisma from '../lib/prisma';
import { codedError } from '@/modules/errors';

/**
 * Creates a Section (optionally inside another). Database only: storage
 * keys never encode hierarchy, so a Section has no directory (Story 4.1).
 */
export async function createFolder(projectId: string, name: string, parentId?: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw codedError('NOT_FOUND', 'Project not found');

  if (parentId) {
    const parent = await prisma.folder.findUnique({ where: { id: parentId }, select: { projectId: true } });
    if (!parent) throw codedError('NOT_FOUND', 'Parent Section not found');
    if (parent.projectId !== projectId) throw codedError('NOT_FOUND', 'Parent Section belongs to a different project');
  }

  return prisma.folder.create({
    data: {
      name,
      projectId,
      parentId: parentId || null,
    },
  });
}
