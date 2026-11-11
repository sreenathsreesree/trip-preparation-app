import { unconfiguredProvider, type PlacesProvider } from './provider';

/**
 * The app's active place provider. Until the Places proxy exists (part B),
 * search is honestly unavailable and the planner works with places entered by
 * name. No provider key ever lives in the app.
 */
export const placesProvider: PlacesProvider = unconfiguredProvider;
