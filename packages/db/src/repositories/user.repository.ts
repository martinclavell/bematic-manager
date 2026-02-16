import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { users } from '../schema/users.js';
import type { UserInsert, UserRow } from '../schema/users.js';

export class UserRepository extends BaseRepository {
  create(data: UserInsert): UserRow {
    return this.db.insert(users).values(data).returning().get();
  }

  findById(id: string): UserRow | undefined {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  findBySlackUserId(slackUserId: string): UserRow | undefined {
    return this.db
      .select()
      .from(users)
      .where(eq(users.slackUserId, slackUserId))
      .get();
  }

  upsert(data: UserInsert): UserRow {
    // Try to find existing
    const existing = this.findBySlackUserId(data.slackUserId);
    if (existing) {
      return this.db
        .update(users)
        .set({
          slackUsername: data.slackUsername,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, existing.id))
        .returning()
        .get();
    }
    return this.create(data);
  }

  updateRole(id: string, role: string): UserRow | undefined {
    return this.db
      .update(users)
      .set({ role, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  findAll(): UserRow[] {
    return this.db.select().from(users).all();
  }
}
