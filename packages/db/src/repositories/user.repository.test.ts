import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { UserRepository } from './user.repository.js';
import { users } from '../schema/users.js';
import { DatabaseTestFactory } from '../test-utils/database-test-factory.js';
import { ConstraintViolationError, RecordNotFoundError } from '../errors.js';

function createTestDatabase() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);

  // Create users table
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      slack_user_id TEXT NOT NULL UNIQUE,
      slack_username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      rate_limit_override INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  return db;
}

describe('UserRepository', () => {
  let db: ReturnType<typeof drizzle>;
  let repo: UserRepository;
  let factory: DatabaseTestFactory;

  beforeEach(() => {
    db = createTestDatabase();
    repo = new UserRepository(db);
    factory = new DatabaseTestFactory();
  });

  describe('create', () => {
    it('should create user successfully', () => {
      const userData = factory.createUser();

      const result = repo.create(userData);

      expect(result.id).toBe(userData.id);
      expect(result.slackUserId).toBe(userData.slackUserId);
      expect(result.slackUsername).toBe(userData.slackUsername);
      expect(result.role).toBe(userData.role);
      expect(result.active).toBe(userData.active);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create user with default values', () => {
      const userData = factory.createUser({
        role: undefined, // Should default to 'developer'
        active: undefined, // Should default to true
        rateLimitOverride: undefined, // Should be null
      });

      const result = repo.create(userData);

      expect(result.role).toBe('developer');
      expect(result.active).toBe(true);
      expect(result.rateLimitOverride).toBeNull();
    });

    it('should throw ConstraintViolationError on duplicate slack_user_id', () => {
      const userData1 = factory.createUser();
      const userData2 = factory.createUser({
        id: 'different-id',
        slackUserId: userData1.slackUserId, // Same Slack user ID
      });

      repo.create(userData1);

      expect(() => repo.create(userData2)).toThrow(ConstraintViolationError);
    });

    it('should throw ConstraintViolationError on duplicate ID', () => {
      const userData = factory.createUser();

      repo.create(userData);

      expect(() => repo.create(userData)).toThrow(ConstraintViolationError);
    });

    it('should create user with custom role and rate limit override', () => {
      const userData = factory.createUser({
        role: 'admin',
        rateLimitOverride: 1000,
      });

      const result = repo.create(userData);

      expect(result.role).toBe('admin');
      expect(result.rateLimitOverride).toBe(1000);
    });

    it('should create inactive user', () => {
      const userData = factory.createUser({
        active: false,
      });

      const result = repo.create(userData);

      expect(result.active).toBe(false);
    });
  });

  describe('findById', () => {
    it('should find user by ID when it exists', () => {
      const userData = factory.createUser();
      const created = repo.create(userData);

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.slackUserId).toBe(created.slackUserId);
      expect(found?.slackUsername).toBe(created.slackUsername);
    });

    it('should return undefined when user does not exist', () => {
      const found = repo.findById('user_nonexistent');

      expect(found).toBeUndefined();
    });

    it('should return user with all fields', () => {
      const userData = factory.createUser({
        role: 'admin',
        rateLimitOverride: 500,
        active: false,
      });
      const created = repo.create(userData);

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.role).toBe('admin');
      expect(found?.rateLimitOverride).toBe(500);
      expect(found?.active).toBe(false);
      expect(found?.createdAt).toBeDefined();
      expect(found?.updatedAt).toBeDefined();
    });
  });

  describe('findBySlackUserId', () => {
    it('should find user by Slack user ID when it exists', () => {
      const userData = factory.createUser();
      const created = repo.create(userData);

      const found = repo.findBySlackUserId(created.slackUserId);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.slackUserId).toBe(created.slackUserId);
      expect(found?.slackUsername).toBe(created.slackUsername);
    });

    it('should return undefined when user does not exist', () => {
      const found = repo.findBySlackUserId('U_NONEXISTENT');

      expect(found).toBeUndefined();
    });

    it('should be case sensitive', () => {
      const userData = factory.createUser({
        slackUserId: 'U123456789',
      });
      repo.create(userData);

      const found = repo.findBySlackUserId('u123456789'); // lowercase

      expect(found).toBeUndefined();
    });
  });

  describe('upsert', () => {
    it('should insert new user when user does not exist', () => {
      const userData = factory.createUser();

      const result = repo.upsert(userData);

      expect(result.id).toBe(userData.id);
      expect(result.slackUserId).toBe(userData.slackUserId);
      expect(result.slackUsername).toBe(userData.slackUsername);
      expect(result.role).toBe(userData.role);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();

      // Verify it was actually inserted
      const found = repo.findById(result.id);
      expect(found).toBeDefined();
    });

    it('should update existing user when user exists', () => {
      const originalUserData = factory.createUser({
        slackUsername: 'oldusername',
      });
      const created = repo.create(originalUserData);

      const updateData = factory.createUser({
        id: 'different-id', // Different ID
        slackUserId: created.slackUserId, // Same Slack user ID
        slackUsername: 'newusername', // Updated username
        role: 'admin', // This should NOT be updated by upsert
      });

      const result = repo.upsert(updateData);

      expect(result.id).toBe(created.id); // Should keep original ID
      expect(result.slackUserId).toBe(created.slackUserId);
      expect(result.slackUsername).toBe('newusername'); // Should be updated
      expect(result.role).toBe(originalUserData.role); // Should NOT be updated by upsert
      expect(result.createdAt).toBe(created.createdAt); // Should keep original
      expect(result.updatedAt).not.toBe(created.updatedAt); // Should be updated
    });

    it('should handle concurrent upserts gracefully', () => {
      const userData = factory.createUser();

      // Multiple upserts should not cause issues
      const result1 = repo.upsert(userData);
      const result2 = repo.upsert({
        ...userData,
        slackUsername: 'updated-username',
      });

      expect(result1.id).toBe(result2.id);
      expect(result2.slackUsername).toBe('updated-username');
    });

    it('should throw RecordNotFoundError if update fails internally', () => {
      // This is a bit contrived since the implementation handles this case,
      // but we test the error path exists
      const userData = factory.createUser();

      // First create the user
      const created = repo.create(userData);

      // Now manually delete the user to simulate the race condition
      db.delete(users).where(users.id.is(created.id)).run();

      // Now try to upsert - should fail because the user was deleted between
      // the findBySlackUserId and the update
      expect(() => repo.upsert({
        ...userData,
        slackUsername: 'updated-username',
      })).toThrow(RecordNotFoundError);
    });
  });

  describe('updateRole', () => {
    it('should update user role successfully', () => {
      const userData = factory.createUser({
        role: 'developer',
      });
      const created = repo.create(userData);

      const updated = repo.updateRole(created.id, 'admin');

      expect(updated).toBeDefined();
      expect(updated?.role).toBe('admin');
      expect(updated?.id).toBe(created.id);
      expect(updated?.slackUserId).toBe(created.slackUserId);
      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it('should throw RecordNotFoundError when user does not exist', () => {
      expect(() => repo.updateRole('user_nonexistent', 'admin'))
        .toThrow(RecordNotFoundError);
    });

    it('should handle role change to same value', () => {
      const userData = factory.createUser({
        role: 'developer',
      });
      const created = repo.create(userData);

      const updated = repo.updateRole(created.id, 'developer');

      expect(updated).toBeDefined();
      expect(updated?.role).toBe('developer');
      expect(updated?.updatedAt).not.toBe(created.updatedAt); // Timestamp should still update
    });

    it('should update updatedAt timestamp', () => {
      const userData = factory.createUser();
      const created = repo.create(userData);
      const originalUpdatedAt = created.updatedAt;

      const updated = repo.updateRole(created.id, 'admin');

      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );
    });
  });

  describe('findAll', () => {
    it('should return all users', () => {
      const user1 = factory.createUser();
      const user2 = factory.createUser();
      const user3 = factory.createUser();

      repo.create(user1);
      repo.create(user2);
      repo.create(user3);

      const allUsers = repo.findAll();

      expect(allUsers).toHaveLength(3);
      expect(allUsers.map(u => u.id).sort()).toEqual([user1.id, user2.id, user3.id].sort());
    });

    it('should return empty array when no users exist', () => {
      const allUsers = repo.findAll();

      expect(allUsers).toEqual([]);
    });

    it('should return all user fields', () => {
      const userData = factory.createUser({
        role: 'admin',
        rateLimitOverride: 1000,
        active: false,
      });
      repo.create(userData);

      const allUsers = repo.findAll();

      expect(allUsers).toHaveLength(1);
      const user = allUsers[0];
      expect(user.id).toBe(userData.id);
      expect(user.slackUserId).toBe(userData.slackUserId);
      expect(user.slackUsername).toBe(userData.slackUsername);
      expect(user.role).toBe('admin');
      expect(user.rateLimitOverride).toBe(1000);
      expect(user.active).toBe(false);
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it('should include both active and inactive users', () => {
      const activeUser = factory.createUser({ active: true });
      const inactiveUser = factory.createUser({ active: false });

      repo.create(activeUser);
      repo.create(inactiveUser);

      const allUsers = repo.findAll();

      expect(allUsers).toHaveLength(2);
      expect(allUsers.some(u => u.active === true)).toBe(true);
      expect(allUsers.some(u => u.active === false)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values gracefully', () => {
      const userData = factory.createUser({
        slackUsername: '', // Empty username
      });

      const result = repo.create(userData);

      expect(result.slackUsername).toBe('');
    });

    it('should handle very long usernames', () => {
      const longUsername = 'a'.repeat(1000);
      const userData = factory.createUser({
        slackUsername: longUsername,
      });

      const result = repo.create(userData);

      expect(result.slackUsername).toBe(longUsername);
    });

    it('should handle special characters in username', () => {
      const specialUsername = 'user.name-123_test@example.com';
      const userData = factory.createUser({
        slackUsername: specialUsername,
      });

      const result = repo.create(userData);

      expect(result.slackUsername).toBe(specialUsername);
    });

    it('should handle unicode characters in username', () => {
      const unicodeUsername = '用户名123 🎉 café';
      const userData = factory.createUser({
        slackUsername: unicodeUsername,
      });

      const result = repo.create(userData);

      expect(result.slackUsername).toBe(unicodeUsername);
    });

    it('should handle null rate limit override', () => {
      const userData = factory.createUser({
        rateLimitOverride: null,
      });

      const result = repo.create(userData);

      expect(result.rateLimitOverride).toBeNull();
    });

    it('should handle negative rate limit override', () => {
      const userData = factory.createUser({
        rateLimitOverride: -1,
      });

      const result = repo.create(userData);

      expect(result.rateLimitOverride).toBe(-1);
    });

    it('should handle very large rate limit override', () => {
      const largeLimit = Number.MAX_SAFE_INTEGER;
      const userData = factory.createUser({
        rateLimitOverride: largeLimit,
      });

      const result = repo.create(userData);

      expect(result.rateLimitOverride).toBe(largeLimit);
    });

    it('should preserve exact timestamps', () => {
      const specificTime = '2024-01-01T12:00:00.000Z';
      const userData = factory.createUser({
        createdAt: specificTime,
        updatedAt: specificTime,
      });

      const result = repo.create(userData);

      expect(result.createdAt).toBe(specificTime);
      expect(result.updatedAt).toBe(specificTime);
    });

    it('should handle role changes to unusual values', () => {
      const userData = factory.createUser();
      const created = repo.create(userData);

      const unusualRole = 'custom-role-123';
      const updated = repo.updateRole(created.id, unusualRole);

      expect(updated?.role).toBe(unusualRole);
    });

    it('should handle concurrent operations on same user', () => {
      const userData = factory.createUser();
      const created = repo.create(userData);

      // Simulate concurrent updates
      const updated1 = repo.updateRole(created.id, 'admin');
      const updated2 = repo.updateRole(created.id, 'developer');

      expect(updated1).toBeDefined();
      expect(updated2).toBeDefined();
      expect(updated2?.role).toBe('developer'); // Last update wins
    });

    it('should handle finding by slack user ID with special characters', () => {
      const specialSlackId = 'U123-456_789.ABC';
      const userData = factory.createUser({
        slackUserId: specialSlackId,
      });
      repo.create(userData);

      const found = repo.findBySlackUserId(specialSlackId);

      expect(found).toBeDefined();
      expect(found?.slackUserId).toBe(specialSlackId);
    });
  });
});