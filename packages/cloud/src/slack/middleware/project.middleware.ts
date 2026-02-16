import { NotFoundError, createLogger } from '@bematic/common';
import type { ProjectRepository, ProjectRow } from '@bematic/db';

const logger = createLogger('project-resolver');

export function createProjectResolver(projectRepo: ProjectRepository) {
  return {
    resolve(channelId: string): ProjectRow {
      const project = projectRepo.findByChannelId(channelId);
      if (!project) {
        throw new NotFoundError('Project', `channel:${channelId}`);
      }
      if (!project.active) {
        throw new NotFoundError('Project', `channel:${channelId} (deactivated)`);
      }
      logger.debug({ projectId: project.id, channelId }, 'Resolved project');
      return project;
    },

    tryResolve(channelId: string): ProjectRow | null {
      const project = projectRepo.findByChannelId(channelId);
      return project?.active ? project : null;
    },
  };
}
