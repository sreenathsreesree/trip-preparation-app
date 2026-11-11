import type { Database } from './types';

/**
 * Runs transactions one at a time on a shared connection.
 *
 * expo-sqlite's `withTransactionAsync` is not exclusive (its exclusive variant
 * is unavailable on web): if a second transaction starts while one is open —
 * e.g. two quick taps on a reorder arrow — its BEGIN fails, or its statements
 * mix into the other transaction. Queuing whole transactions prevents both. A
 * failed transaction rolls back and the queue carries on.
 *
 * Rules for callers: never start a transaction inside another one (it would
 * wait for itself); plain reads and single-statement writes outside a
 * transaction are not queued.
 */
export function serializeTransactions(db: Database): Database {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    execAsync: (source) => db.execAsync(source),
    runAsync: (source, params) => db.runAsync(source, params),
    getFirstAsync: (source, params) => db.getFirstAsync(source, params),
    getAllAsync: (source, params) => db.getAllAsync(source, params),
    withTransactionAsync(task) {
      const run = tail.then(() => db.withTransactionAsync(task));
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
