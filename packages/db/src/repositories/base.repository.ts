import type { DB } from '../connection.js';

export abstract class BaseRepository {
  constructor(protected readonly db: DB) {}
}
