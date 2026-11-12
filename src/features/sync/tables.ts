/**
 * Which local SQLite tables and columns synchronise with the cloud, and how.
 *
 * Single source of truth for the sync engine. Tests check it against both the
 * SQLite schema (every local table/column is either synced or deliberately
 * local) and the Supabase schema (every synced column exists in the cloud).
 * Keep this file dependency-free: the cloud tests import it directly in Node.
 */

export interface SyncTable {
  /** Same name locally and in the cloud. */
  name: string;
  /** Local primary key column (also the cloud key, together with user_id). */
  pk: string;
  /** Push order: parents (lower rank) before children. Matches public.sync_tables. */
  rank: number;
  /** Columns sent to and received from the cloud (includes the pk). */
  columns: readonly string[];
  /** Columns kept on the device only, with the reason. */
  localOnly?: Readonly<Record<string, string>>;
}

export const SYNC_TABLES: readonly SyncTable[] = [
  {
    name: 'trips',
    pk: 'id',
    rank: 1,
    columns: ['id', 'name', 'start_date', 'end_date', 'adults', 'children', 'transport_mode', 'category', 'created_at', 'updated_at', 'completed_at', 'archived_at'],
    localOnly: {
      destination: 'Derived from the planner’s main destinations on each device.',
      planner_opened_at: 'Per-device “continue planning” shortcut.',
    },
  },
  {
    name: 'checklist_templates',
    pk: 'id',
    rank: 1,
    columns: ['id', 'name', 'description', 'created_at', 'updated_at'],
  },
  {
    name: 'inventory_categories',
    pk: 'id',
    rank: 1,
    columns: ['id', 'parent_id', 'name', 'icon', 'color', 'position', 'cover_image_uri', 'system_key', 'created_at', 'updated_at'],
    localOnly: {
      description: 'Added locally in v5; synced once the matching cloud migration is approved (before G4).',
    },
  },
  {
    name: 'places',
    pk: 'id',
    rank: 1,
    columns: ['id', 'provider', 'provider_place_id', 'name', 'latitude', 'longitude', 'formatted_address', 'types', 'district', 'state', 'country', 'metadata', 'created_at', 'updated_at'],
    localOnly: {
      fetched_at: 'Device cache timestamp. Google content itself is never uploaded (only the Place ID).',
    },
  },
  {
    name: 'user_preferences',
    pk: 'key',
    rank: 1,
    columns: ['key', 'value', 'updated_at'],
  },
  {
    name: 'trip_travellers',
    pk: 'id',
    rank: 2,
    columns: ['id', 'trip_id', 'name', 'kind', 'position', 'created_at', 'updated_at'],
  },
  {
    name: 'checklist_sections',
    pk: 'id',
    rank: 2,
    columns: ['id', 'trip_id', 'template_id', 'title', 'kind', 'position', 'created_at', 'updated_at'],
  },
  {
    name: 'inventory_items',
    pk: 'id',
    rank: 2,
    columns: ['id', 'name', 'description', 'brand', 'model', 'quantity', 'weight_grams', 'condition', 'storage_location', 'category_id', 'subcategory_id', 'availability', 'image_uri', 'image_source', 'archived_at', 'created_at', 'updated_at'],
  },
  {
    name: 'trip_packing',
    pk: 'trip_id',
    rank: 2,
    columns: ['trip_id', 'activities', 'accommodation', 'laundry', 'confirmed_at', 'draft_reason', 'suggestions_generated_at', 'created_at', 'updated_at'],
  },
  {
    name: 'trip_plan_nodes',
    pk: 'id',
    rank: 2,
    columns: ['id', 'trip_id', 'parent_id', 'place_id', 'name', 'notes', 'position', 'created_at', 'updated_at'],
    localOnly: {
      trip_destination_id: 'Link to the derived trip_destinations row on this device.',
      origin: 'Derived bookkeeping for the derived destination rows.',
    },
  },
  {
    name: 'checklist_tasks',
    pk: 'id',
    rank: 3,
    columns: ['id', 'section_id', 'title', 'description', 'notes', 'priority', 'is_done', 'position', 'source_template_id', 'source_task_id', 'created_at', 'updated_at'],
  },
  {
    name: 'trip_luggage',
    pk: 'id',
    rank: 3,
    columns: ['id', 'trip_id', 'name', 'kind', 'traveller_id', 'position', 'created_at', 'updated_at'],
  },
  {
    name: 'trip_route_stops',
    pk: 'id',
    rank: 3,
    columns: ['id', 'trip_id', 'node_id', 'position', 'created_at'],
  },
  {
    name: 'packing_entries',
    pk: 'id',
    rank: 4,
    columns: ['id', 'trip_id', 'inventory_item_id', 'name', 'category_id', 'quantity', 'traveller_id', 'luggage_id', 'is_packed', 'notes', 'source', 'recommendation_id', 'position', 'created_at', 'updated_at'],
    localOnly: {
      unit: 'Added locally in v5; synced once the matching cloud migration is approved (before G4).',
    },
  },
  {
    name: 'packing_recommendations',
    pk: 'id',
    rank: 5,
    columns: ['id', 'trip_id', 'rule_key', 'name', 'category_key', 'quantity', 'priority', 'reason', 'traveller_id', 'inventory_item_id', 'status', 'packing_entry_id', 'created_at', 'updated_at', 'decided_at'],
  },
  {
    name: 'inventory_reservations',
    pk: 'id',
    rank: 5,
    columns: ['id', 'inventory_item_id', 'trip_id', 'packing_entry_id', 'quantity', 'start_date', 'end_date', 'status', 'created_at', 'updated_at', 'ended_at'],
  },
  {
    name: 'purchase_items',
    pk: 'id',
    rank: 6,
    columns: ['id', 'trip_id', 'trip_name', 'name', 'normalized_name', 'quantity', 'category_id', 'status', 'recommendation_id', 'inventory_item_id', 'packing_entry_id', 'notes', 'created_at', 'updated_at', 'purchased_at', 'resolved_at'],
  },
];

/** Local tables that never sync, with the reason. */
export const LOCAL_ONLY_TABLES: Readonly<Record<string, string>> = {
  trip_destinations: 'Derived from the planner’s main destinations (rebuilt on each device after sync).',
  // Destination planner upgrade (local schema v6). Synced only after a matching cloud
  // migration is separately approved (needed before G4).
  trip_navigation_items: 'Navigation list (local v6); cloud table pending approval.',
  plan_node_profiles: 'Visit status, saved flag, cover, tags and facts (local v6); cloud table pending approval.',
  plan_node_tasks: 'Destination preparation checklist (local v6); cloud table pending approval.',
  plan_node_notes: 'Notes & my plan (local v6); cloud table pending approval.',
  plan_node_alerts: 'Saved destination notices (local v6); cloud table pending approval.',
  plan_node_memories: 'Personal visit memories (local v6); cloud table pending approval.',
};
