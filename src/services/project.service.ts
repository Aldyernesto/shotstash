import prisma from '../lib/prisma';
import { createNotification } from './notification.service';

// Projects and Sections exist only in the database (Story 4.1): storage keys
// never encode hierarchy, so creating, renaming or moving them touches no bytes.
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

  // 2. Auto-create the default Sections: Video, Photo, Documents
  const defaultFolders = ['Video', 'Photo', 'Documents'];
  for (const folderName of defaultFolders) {
    await prisma.folder.create({
      data: {
        name: folderName,
        projectId: project.id,
      },
    });
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
