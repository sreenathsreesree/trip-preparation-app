import type { Migration } from '../migrate';
import { initialSchema } from './0001_initial_schema';

/**
 * Ordered list of schema migrations.
 *
 * Rules:
 * - Never edit or reorder a migration that has shipped; add a new one.
 * - Versions must start at 1 and increase by exactly 1.
 */
export const migrations: readonly Migration[] = [initialSchema];
