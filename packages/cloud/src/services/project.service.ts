import { generateProjectId, createLogger, type ProjectCreateInput } from '@bematic/common';
import type { ProjectRepository, ProjectRow, AuditLogRepository } from '@bematic/db';

const logger = createLogger('project-service');

export class ProjectService {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  create(input: ProjectCreateInput, userId?: string): ProjectRow {
    const project = this.projectRepo.create({
      id: generateProjectId(),
      name: input.name,
      slackChannelId: input.slackChannelId,
      localPath: input.localPath,
      agentId: input.agentId,
      defaultModel: input.defaultModel ?? 'claude-sonnet-4-6',
      defaultMaxBudget: input.defaultMaxBudget ?? 5.0,
    });

    this.auditLogRepo.log('project:created', 'project', project.id, userId, {
      name: input.name,
      channelId: input.slackChannelId,
    });

    logger.info({ projectId: project.id, name: input.name }, 'Project created');
    return project;
  }

  findByChannel(channelId: string): ProjectRow | undefined {
    return this.projectRepo.findByChannelId(channelId);
  }

  findAll(): ProjectRow[] {
    return this.projectRepo.findAll();
  }

  update(id: string, data: Partial<ProjectCreateInput>, userId?: string): ProjectRow | undefined {
    const updated = this.projectRepo.update(id, data as any);
    if (updated) {
      this.auditLogRepo.log('project:updated', 'project', id, userId, data);
    }
    return updated;
  }

  delete(id: string, userId?: string): void {
    this.projectRepo.delete(id);
    this.auditLogRepo.log('project:deleted', 'project', id, userId);
    logger.info({ projectId: id }, 'Project deleted');
  }
}
