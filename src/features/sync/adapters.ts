import type { Database, SqlValue } from '@/db/types';

import { PENDING_SYNC_TABLES, SYNC_TABLES, type SyncTable } from './tables';

/**
 * How each cloud table maps to the device database.
 *
 * Most tables are 1:1 (same name, same columns). The exceptions:
 * - photos: device paths ("file:…", "data:…") never leave the device. A photo
 *   that is already in the user's Google Drive is sent as "drive:<file id>";
 *   one that is not yet in Drive is left out (and counted, so the UI can say
 *   so). A downloaded empty value never replaces a photo kept on this device;
 * - columns that exist only on the device are left alone (or get their
 *   default when a record is created by a download);
 * - side tables carry v5 columns (category descriptions, packing units) so the
 *   G1 tables stay unchanged; budgets have a combined key; expense splits travel
 *   inside their expense; a participant's account is `member_user_id` in the cloud.
 */

export type CloudRow = Record<string, SqlValue>;

export interface Adapter {
  table: SyncTable;
  /** All device records as cloud rows (pk → row). */
  read(db: Database, ctx: PhotoRefs): Promise<Map<string, CloudRow>>;
  /** Writes a downloaded row (create or update). */
  write(db: Database, row: CloudRow, ctx: PhotoRefs): Promise<void>;
  /** Applies a downloaded deletion. */
  remove(db: Database, pk: string): Promise<void>;
}

/** Device photo ↔ Drive file id, built once per sync. */
export interface PhotoRefs {
  /** Device URI → Drive file id, for photos already in the user's Drive. */
  driveIdOf: Map<string, string>;
  /** Drive file id → device URI, so a download keeps the photo already on this device. */
  uriOf: Map<string, string>;
  /** Photos left out because they are not in Drive yet. */
  notInDrive: Set<string>;
}

const DRIVE = 'drive:';
const isDevicePath = (uri: string) => uri.startsWith('file:') || uri.startsWith('data:');

export async function loadPhotoRefs(db: Database): Promise<PhotoRefs> {
  const driveIdOf = new Map<string, string>();
  for (const r of await db.getAllAsync<{ local_uri: string; drive_file_id: string }>(
    "SELECT local_uri, drive_file_id FROM drive_photo_uploads WHERE status = 'uploaded' AND drive_file_id IS NOT NULL",
    [],
  )) {
    driveIdOf.set(r.local_uri, r.drive_file_id);
  }
  // Journal photos uploaded by the manual journal backup.
  for (const r of await db.getAllAsync<{ uri: string; drive_file_id: string }>(
    "SELECT p.uri, d.drive_file_id FROM journal_photos p JOIN drive_files d ON d.local_kind = 'photo' AND d.local_id = p.id",
    [],
  )) {
    driveIdOf.set(r.uri, r.drive_file_id);
  }
  const uriOf = new Map<string, string>();
  for (const [uri, id] of driveIdOf) uriOf.set(id, uri);
  return { driveIdOf, uriOf, notInDrive: new Set() };
}

/** Device URI → what the cloud may hold (a Drive reference or nothing). */
function toCloudPhoto(uri: string | null, ctx: PhotoRefs): string | null {
  if (!uri) return null;
  if (uri.startsWith(DRIVE)) return uri;
  if (!isDevicePath(uri)) return uri; // e.g. built-in illustration keys
  const id = ctx.driveIdOf.get(uri);
  if (id) return `${DRIVE}${id}`;
  ctx.notInDrive.add(uri);
  return null;
}

/** Cloud value → device URI, preferring the photo already on this device. */
function toDevicePhoto(value: string | null, ctx: PhotoRefs): string | null {
  if (!value) return null;
  if (value.startsWith(DRIVE)) return ctx.uriOf.get(value.slice(DRIVE.length)) ?? value;
  return value;
}

/** Cloud tables that must not carry device paths at all (G1 checks reject them). */
const G1_PHOTO_COLUMNS: Record<string, string> = { inventory_categories: 'cover_image_uri', inventory_items: 'image_uri' };

/** Device-only settings (location prompts depend on this phone's permissions). */
const DEVICE_PREFERENCES = new Set(['arrival_prompts']);

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

async function upsert(db: Database, table: string, pk: string, row: CloudRow, extraInsert: CloudRow = {}) {
  const insert = { ...extraInsert, ...row };
  const cols = Object.keys(insert);
  const updates = Object.keys(row).filter((c) => c !== pk);
  await db.runAsync(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders(cols.length)})
     ON CONFLICT (${pk}) DO ${updates.length ? `UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}` : 'NOTHING'}`,
    cols.map((c) => insert[c] as SqlValue),
  );
}

/** 1:1 table: same name and columns on both sides. */
function plain(table: SyncTable, options: { insertDefaults?: CloudRow; photo?: string; where?: string } = {}): Adapter {
  return {
    table,
    async read(db, ctx) {
      const rows = await db.getAllAsync<CloudRow>(`SELECT ${table.columns.join(', ')} FROM ${table.name}${options.where ? ` WHERE ${options.where}` : ''}`, []);
      const out = new Map<string, CloudRow>();
      for (const r of rows) {
        if (options.photo) r[options.photo] = toCloudPhoto(r[options.photo] as string | null, ctx);
        out.set(String(r[table.pk]), r);
      }
      return out;
    },
    async write(db, row, ctx) {
      const data: CloudRow = {};
      for (const c of table.columns) data[c] = row[c] ?? null;
      if (options.photo) {
        const incoming = toDevicePhoto(data[options.photo] as string | null, ctx);
        if (incoming === null) {
          // Never replace a photo kept on this device with an empty value.
          const local = await db.getFirstAsync<CloudRow>(`SELECT ${options.photo} AS v FROM ${table.name} WHERE ${table.pk} = ?`, [data[table.pk] as SqlValue]);
          data[options.photo] = (local?.v as string | null) ?? null;
        } else data[options.photo] = incoming;
      }
      await upsert(db, table.name, table.pk, data, options.insertDefaults);
    },
    async remove(db, pk) {
      await db.runAsync(`DELETE FROM ${table.name} WHERE ${table.pk} = ?`, [pk]);
    },
  };
}

const byName = new Map([...SYNC_TABLES, ...PENDING_SYNC_TABLES].map((t) => [t.name, t]));
const t = (name: string) => byName.get(name) as SyncTable;

function custom(): Record<string, Adapter> {
  return {
    trips: plain(t('trips'), { insertDefaults: { destination: '' } }),
    inventory_categories: plain(t('inventory_categories'), { photo: G1_PHOTO_COLUMNS.inventory_categories }),
    inventory_items: plain(t('inventory_items'), { photo: G1_PHOTO_COLUMNS.inventory_items }),
    user_preferences: plain(t('user_preferences'), { where: `key NOT IN (${[...DEVICE_PREFERENCES].map((k) => `'${k}'`).join(', ')})` }),
    plan_node_profiles: plain(t('plan_node_profiles'), { photo: 'cover_image_uri' }),

    inventory_category_details: {
      table: t('inventory_category_details'),
      async read(db) {
        const rows = await db.getAllAsync<{ id: string; description: string }>("SELECT id, description FROM inventory_categories WHERE description <> ''", []);
        return new Map(rows.map((r) => [r.id, { category_id: r.id, description: r.description }]));
      },
      async write(db, row) {
        await db.runAsync('UPDATE inventory_categories SET description = ? WHERE id = ?', [String(row.description ?? ''), String(row.category_id)]);
      },
      async remove(db, pk) {
        await db.runAsync("UPDATE inventory_categories SET description = '' WHERE id = ?", [pk]);
      },
    },

    packing_entry_units: {
      table: t('packing_entry_units'),
      async read(db) {
        const rows = await db.getAllAsync<{ id: string; unit: string }>("SELECT id, unit FROM packing_entries WHERE unit <> 'pcs'", []);
        return new Map(rows.map((r) => [r.id, { entry_id: r.id, unit: r.unit }]));
      },
      async write(db, row) {
        await db.runAsync('UPDATE packing_entries SET unit = ? WHERE id = ?', [String(row.unit ?? 'pcs'), String(row.entry_id)]);
      },
      async remove(db, pk) {
        await db.runAsync("UPDATE packing_entries SET unit = 'pcs' WHERE id = ?", [pk]);
      },
    },

    expense_participants: {
      table: t('expense_participants'),
      async read(db) {
        const rows = await db.getAllAsync<CloudRow>(
          'SELECT id, trip_id, name, user_id AS member_user_id, is_me, position, archived_at, created_at, updated_at FROM expense_participants',
          [],
        );
        return new Map(rows.map((r) => [String(r.id), r]));
      },
      async write(db, row) {
        const { member_user_id, ...rest } = row;
        await upsert(db, 'expense_participants', 'id', { ...rest, user_id: member_user_id ?? null });
      },
      async remove(db, pk) {
        // Participants referenced by history are archived rather than deleted.
        const used = await db.getFirstAsync('SELECT 1 FROM expense_splits WHERE participant_id = ? UNION SELECT 1 FROM expenses WHERE paid_by = ? UNION SELECT 1 FROM expense_settlements WHERE from_id = ? OR to_id = ?', [pk, pk, pk, pk]);
        if (used) await db.runAsync("UPDATE expense_participants SET archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?", [pk]);
        else await db.runAsync('DELETE FROM expense_participants WHERE id = ?', [pk]);
      },
    },

    expense_budgets: {
      table: t('expense_budgets'),
      async read(db) {
        const rows = await db.getAllAsync<CloudRow>('SELECT trip_id, currency, total_minor, daily_limit_minor, lines, updated_at FROM expense_budgets', []);
        return new Map(rows.map((r) => [`${r.trip_id}:${r.currency}`, { id: `${r.trip_id}:${r.currency}`, ...r }]));
      },
      async write(db, row) {
        const { id: _id, ...rest } = row;
        await db.runAsync(
          `INSERT INTO expense_budgets (trip_id, currency, total_minor, daily_limit_minor, lines, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (trip_id, currency) DO UPDATE SET total_minor = excluded.total_minor, daily_limit_minor = excluded.daily_limit_minor,
             lines = excluded.lines, updated_at = excluded.updated_at`,
          [rest.trip_id, rest.currency, rest.total_minor, rest.daily_limit_minor, rest.lines ?? '[]', rest.updated_at] as SqlValue[],
        );
      },
      async remove(db, pk) {
        const at = pk.lastIndexOf(':');
        await db.runAsync('DELETE FROM expense_budgets WHERE trip_id = ? AND currency = ?', [pk.slice(0, at), pk.slice(at + 1)]);
      },
    },

    expenses: {
      table: t('expenses'),
      async read(db) {
        const rows = await db.getAllAsync<CloudRow>(
          'SELECT id, trip_id, scope, title, amount_minor, currency, category, category_name, spent_on, paid_by, split_method, notes, created_by, created_at, updated_at FROM expenses',
          [],
        );
        const splits = await db.getAllAsync<{ expense_id: string; participant_id: string; share_minor: number; input_value: number }>(
          'SELECT expense_id, participant_id, share_minor, input_value FROM expense_splits ORDER BY expense_id, participant_id',
          [],
        );
        const byExpense = new Map<string, { participant_id: string; share_minor: number; input_value: number }[]>();
        for (const s of splits) byExpense.set(s.expense_id, [...(byExpense.get(s.expense_id) ?? []), { participant_id: s.participant_id, share_minor: s.share_minor, input_value: s.input_value }]);
        return new Map(rows.map((r) => [String(r.id), { ...r, splits: JSON.stringify(byExpense.get(String(r.id)) ?? []) }]));
      },
      async write(db, row) {
        const { splits, ...rest } = row;
        await upsert(db, 'expenses', 'id', rest);
        await db.runAsync('DELETE FROM expense_splits WHERE expense_id = ?', [String(row.id)]);
        let parsed: unknown = [];
        try {
          parsed = JSON.parse(String(splits ?? '[]'));
        } catch {
          parsed = [];
        }
        for (const s of Array.isArray(parsed) ? (parsed as { participant_id: string; share_minor: number; input_value?: number }[]) : []) {
          await db.runAsync('INSERT INTO expense_splits (expense_id, participant_id, share_minor, input_value) VALUES (?, ?, ?, ?)', [
            String(row.id),
            s.participant_id,
            s.share_minor,
            s.input_value ?? 0,
          ]);
        }
      },
      async remove(db, pk) {
        await db.runAsync('DELETE FROM expenses WHERE id = ?', [pk]);
      },
    },

    journal_photos: {
      table: t('journal_photos'),
      async read(db, ctx) {
        const rows = await db.getAllAsync<{ id: string; entry_id: string; uri: string; caption: string; position: number; created_at: string }>('SELECT * FROM journal_photos', []);
        const out = new Map<string, CloudRow>();
        for (const r of rows) {
          const ref = toCloudPhoto(r.uri, ctx);
          if (!ref?.startsWith(DRIVE)) continue; // not in Drive yet: counted, sent once it is
          out.set(r.id, { id: r.id, entry_id: r.entry_id, drive_file_id: ref.slice(DRIVE.length), caption: r.caption, position: r.position, created_at: r.created_at });
        }
        return out;
      },
      async write(db, row, ctx) {
        const existing = await db.getFirstAsync<{ uri: string }>('SELECT uri FROM journal_photos WHERE id = ?', [String(row.id)]);
        const uri = existing?.uri ?? toDevicePhoto(`${DRIVE}${String(row.drive_file_id)}`, ctx);
        await upsert(db, 'journal_photos', 'id', { id: row.id ?? null, entry_id: row.entry_id ?? null, uri, caption: row.caption ?? '', position: row.position ?? 0, created_at: row.created_at ?? null });
      },
      async remove(db, pk) {
        await db.runAsync('DELETE FROM journal_photos WHERE id = ?', [pk]);
      },
    },

    plan_node_memories: {
      table: t('plan_node_memories'),
      async read(db, ctx) {
        const rows = await db.getAllAsync<CloudRow>(`SELECT ${t('plan_node_memories').columns.join(', ')} FROM plan_node_memories`, []);
        return new Map(
          rows.map((r) => {
            let photos: unknown = [];
            try {
              photos = JSON.parse(String(r.photos));
            } catch {
              photos = [];
            }
            const refs = (Array.isArray(photos) ? photos : []).map((p) => toCloudPhoto(String(p), ctx)).filter((p): p is string => !!p);
            return [String(r.node_id), { ...r, photos: JSON.stringify(refs) }];
          }),
        );
      },
      async write(db, row, ctx) {
        let incoming: unknown = [];
        try {
          incoming = JSON.parse(String(row.photos ?? '[]'));
        } catch {
          incoming = [];
        }
        const mapped = (Array.isArray(incoming) ? incoming : []).map((p) => toDevicePhoto(String(p), ctx)).filter((p): p is string => !!p);
        // Keep photos on this device that are not in Drive yet (they are not in the cloud copy).
        const local = await db.getFirstAsync<{ photos: string }>('SELECT photos FROM plan_node_memories WHERE node_id = ?', [String(row.node_id)]);
        let kept: string[] = [];
        try {
          kept = (JSON.parse(local?.photos ?? '[]') as string[]).filter((p) => isDevicePath(p) && !ctx.driveIdOf.has(p));
        } catch {
          kept = [];
        }
        await upsert(db, 'plan_node_memories', 'node_id', { ...row, photos: JSON.stringify([...mapped, ...kept.filter((p) => !mapped.includes(p))]) });
      },
      async remove(db, pk) {
        await db.runAsync('DELETE FROM plan_node_memories WHERE node_id = ?', [pk]);
      },
    },
  };
}

/** Adapters for the tables the server knows about, in push order (parents first). */
export function adaptersFor(serverTables: ReadonlySet<string>): Adapter[] {
  const special = custom();
  return [...SYNC_TABLES, ...PENDING_SYNC_TABLES]
    .filter((table) => serverTables.has(table.name))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .map((table) => special[table.name] ?? plain(table));
}
