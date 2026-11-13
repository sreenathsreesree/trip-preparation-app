import type { Migration } from '../migrate';
import { initialSchema } from './0001_initial_schema';
import { tripManagementAndChecklists } from './0002_trip_management_and_checklists';
import { inventoryAndPacking } from './0003_inventory_and_packing';
import { destinationPlanner } from './0004_destination_planner';
import { packingUnitsAndCategoryDescriptions } from './0005_packing_units_and_category_descriptions';
import { destinationCompanion } from './0006_destination_companion';
import { journeyJournal } from './0007_journey_journal';
import { drivePhotoUploads } from './0008_drive_photo_uploads';
import { sharedTrips } from './0009_shared_trips';
import { tripExpenses } from './0010_trip_expenses';
import { cloudSync } from './0011_cloud_sync';
import { travelExperience } from './0012_travel_experience';
import { groupWorkspace } from './0013_group_workspace';

/**
 * Ordered list of schema migrations.
 *
 * Rules:
 * - Never edit or reorder a migration that has shipped; add a new one.
 * - Versions must start at 1 and increase by exactly 1.
 */
export const migrations: readonly Migration[] = [
  initialSchema,
  tripManagementAndChecklists,
  inventoryAndPacking,
  destinationPlanner,
  packingUnitsAndCategoryDescriptions,
  destinationCompanion,
  journeyJournal,
  drivePhotoUploads,
  sharedTrips,
  tripExpenses,
  cloudSync,
  travelExperience,
  groupWorkspace,
];
