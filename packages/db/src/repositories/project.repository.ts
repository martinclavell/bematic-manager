import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { projects } from '../schema/projects.js';
import type { ProjectInsert, ProjectRow } from '../schema/projects.js';

export class ProjectRepository extends BaseRepository {
  create(data: ProjectInsert): ProjectRow {
    return this.db.insert(projects).values(data).returning().get();
  }

  findById(id: string): ProjectRow | undefined {
    return this.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  findByChannelId(channelId: string): ProjectRow | undefined {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.slackChannelId, channelId))
      .get();
  }

  findByAgentId(agentId: string): ProjectRow[] {
    return this.db
      .select()
      .from(projects)
      .where(eq(projects.agentId, agentId))
      .all();
  }

  findAll(): ProjectRow[] {
    return this.db.select().from(projects).all();
  }

  update(id: string, data: Partial<ProjectInsert>): ProjectRow | undefined {
    return this.db
      .update(projects)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(projects.id, id))
      .returning()
      .get();
  }

  delete(id: string): void {
    this.db.delete(projects).where(eq(projects.id, id)).run();
  }
}
