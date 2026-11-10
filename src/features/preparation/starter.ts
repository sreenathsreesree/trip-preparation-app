import { inclusiveDayCount } from '@/lib/dates';

import { countTravellers, type TripInput } from '../trips/model';
import {
  getStandardSectionsFor,
  SECTION_META,
  type ChecklistPlan,
  type PlanTask,
  type Priority,
  type StandardSectionKind,
} from './model';

type Entry = readonly [title: string, priority: Priority] | false | null | undefined;
type Builder = (trip: TripInput) => Entry[];

const E = (title: string) => [title, 'essential'] as const;
const R = (title: string) => [title, 'recommended'] as const;
const O = (title: string) => [title, 'optional'] as const;

const drives = (trip: TripInput) =>
  trip.transportMode === 'car' || trip.transportMode === 'bike' || trip.transportMode === 'mixed';

const BUILDERS: Record<StandardSectionKind, Builder> = {
  packing: (trip) => {
    const days = inclusiveDayCount(trip.startDate, trip.endDate);
    const c = trip.category;
    const { children } = countTravellers(trip.travellers);
    return [
      R(`Clothes for ${days} ${days === 1 ? 'day' : 'days'}`),
      E('Phone charger and power bank'),
      R('Toiletries kit'),
      E('Personal medicines and first-aid kit'),
      O('Reusable water bottle'),
      (c === 'mountains' || c === 'adventure') && R('Warm layers and rain jacket'),
      c === 'adventure' && R('Trekking shoes and daypack'),
      c === 'beach' && R('Sunscreen, sunglasses and swimwear'),
      c === 'business' && E('Laptop, charger and formal wear'),
      c === 'wedding' && R('Festive outfits and accessories'),
      c === 'wedding' && O('Gift for the hosts'),
      c === 'pilgrimage' && R('Modest clothing for temple visits'),
      children > 0 && R("Kids' clothes, snacks and comfort items"),
      trip.transportMode === 'bike' && E('Riding jacket, gloves and helmet'),
    ];
  },
  documents: (trip) => [
    E('Government photo ID for every traveller (Aadhaar, PAN or passport)'),
    R('Hotel and stay booking confirmations'),
    R('Emergency contacts written down offline'),
    trip.transportMode === 'flight' && E('Flight e-tickets and web check-in'),
    trip.transportMode === 'train' && E('Train e-ticket and PNR saved offline'),
    trip.transportMode === 'bus' && E('Bus ticket saved offline'),
    trip.transportMode === 'mixed' && E('Tickets for every leg saved offline'),
    drives(trip) && E('Driving licence'),
    drives(trip) && E('Vehicle RC, insurance and PUC certificate'),
  ],
  vehicle: (trip) =>
    trip.transportMode === 'bike'
      ? [
          E('Check tyre pressure and tread'),
          R('Lubricate and adjust the chain'),
          R('Check engine oil level'),
          E('Test brakes, lights, indicators and horn'),
          E('Fill the fuel tank'),
          R('Carry a toolkit and puncture repair kit'),
        ]
      : [
          E('Check tyre pressure, including the spare'),
          R('Check engine oil and coolant levels'),
          E('Test brakes, lights, indicators and horn'),
          R('Top up FASTag balance'),
          E('Fill the fuel tank'),
          R('Pack jack, wheel spanner and warning triangle'),
        ],
  tasks: (trip) => [
    E('Confirm all bookings'),
    R('Download offline maps for the route'),
    R('Share your itinerary with family'),
    R('Charge all devices and power banks'),
    trip.category === 'business' && O('Set an out-of-office reply'),
  ],
  shopping: (trip) => [
    O('Snacks for the journey'),
    O('Travel-size toiletries'),
    countTravellers(trip.travellers).children > 0 && O('Snacks and entertainment for the kids'),
  ],
  home: () => [
    E('Turn off the gas cylinder regulator'),
    R('Switch off the geyser and unplug appliances'),
    O('Pause newspaper and milk delivery'),
    R('Clear perishables from the fridge'),
    O('Take out the trash'),
    E('Lock all doors and windows'),
  ],
};

function tasksFor(kind: StandardSectionKind, trip: TripInput): PlanTask[] {
  return BUILDERS[kind](trip)
    .filter((entry): entry is readonly [string, Priority] => Array.isArray(entry))
    .map(([title, priority]) => ({ title, priority }));
}

/**
 * Recommended starter checklist for a trip, tailored to its transport mode,
 * category, duration and travellers. Only applicable standard sections are
 * included; each task carries a priority.
 */
export function buildStarterChecklist(trip: TripInput): ChecklistPlan {
  return {
    sections: getStandardSectionsFor(trip.transportMode).map((kind) => ({
      title: SECTION_META[kind].title,
      kind,
      tasks: tasksFor(kind, trip),
    })),
  };
}

/** Starter tasks for one standard section (e.g. adding vehicle checks after switching to a car). */
export function buildStarterSection(kind: StandardSectionKind, trip: TripInput): ChecklistPlan {
  return { sections: [{ title: SECTION_META[kind].title, kind, tasks: tasksFor(kind, trip) }] };
}
