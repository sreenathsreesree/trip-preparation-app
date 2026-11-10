import { inclusiveDayCount } from '@/lib/dates';

import type { NewTripInput } from '../trips/model';
import { getApplicableSections, type PrepSectionId } from './model';

export interface StarterItem {
  section: PrepSectionId;
  title: string;
}

type Builder = (trip: NewTripInput) => (string | false | null | undefined)[];

const isDriving = (trip: NewTripInput) =>
  trip.transportMode === 'car' || trip.transportMode === 'mixed';

const BUILDERS: Record<PrepSectionId, Builder> = {
  packing: (trip) => {
    const days = inclusiveDayCount(trip.startDate, trip.endDate);
    const c = trip.category;
    return [
      `Clothes for ${days} ${days === 1 ? 'day' : 'days'}`,
      'Phone charger and power bank',
      'Toiletries kit',
      'Personal medicines and first-aid kit',
      'Reusable water bottle',
      (c === 'mountains' || c === 'adventure') && 'Warm layers and rain jacket',
      c === 'adventure' && 'Trekking shoes and daypack',
      c === 'beach' && 'Sunscreen, sunglasses and swimwear',
      c === 'business' && 'Laptop, charger and formal wear',
      c === 'wedding' && 'Festive outfits and accessories',
      c === 'wedding' && 'Gift for the hosts',
      c === 'pilgrimage' && 'Modest clothing for temple visits',
      trip.travellers.children > 0 && "Kids' clothes, snacks and comfort items",
      trip.transportMode === 'bike' && 'Riding jacket, gloves and helmet',
    ];
  },
  documents: (trip) => [
    'Government photo ID for every traveller (Aadhaar, PAN or passport)',
    'Hotel and stay booking confirmations',
    'Emergency contacts written down offline',
    trip.transportMode === 'flight' && 'Flight e-tickets and web check-in',
    trip.transportMode === 'train' && 'Train e-ticket and PNR saved offline',
    trip.transportMode === 'bus' && 'Bus ticket saved offline',
    trip.transportMode === 'mixed' && 'Tickets for every leg saved offline',
    (isDriving(trip) || trip.transportMode === 'bike') && 'Driving licence',
    (isDriving(trip) || trip.transportMode === 'bike') &&
      'Vehicle RC, insurance and PUC certificate',
  ],
  vehicle: (trip) =>
    trip.transportMode === 'bike'
      ? [
          'Check tyre pressure and tread',
          'Lubricate and adjust the chain',
          'Check engine oil level',
          'Test brakes, lights, indicators and horn',
          'Fill the fuel tank',
          'Carry a toolkit and puncture repair kit',
        ]
      : [
          'Check tyre pressure, including the spare',
          'Check engine oil and coolant levels',
          'Test brakes, lights, indicators and horn',
          'Top up FASTag balance',
          'Fill the fuel tank',
          'Pack jack, wheel spanner and warning triangle',
        ],
  tasks: (trip) => [
    'Confirm all bookings',
    'Download offline maps for the route',
    'Share your itinerary with family',
    'Charge all devices and power banks',
    trip.category === 'business' && 'Set an out-of-office reply',
  ],
  shopping: (trip) => [
    'Snacks for the journey',
    'Travel-size toiletries',
    trip.travellers.children > 0 && 'Snacks and entertainment for the kids',
  ],
  home: () => [
    'Turn off the gas cylinder regulator',
    'Switch off the geyser and unplug appliances',
    'Pause newspaper and milk delivery',
    'Clear perishables from the fridge',
    'Take out the trash',
    'Lock all doors and windows',
  ],
};

/**
 * Recommended starter checklist for a new trip, tailored to its transport
 * mode, category, duration and travellers. Only applicable sections are included.
 */
export function buildStarterChecklist(trip: NewTripInput): StarterItem[] {
  return getApplicableSections(trip.transportMode).flatMap((section) =>
    BUILDERS[section](trip)
      .filter((title): title is string => typeof title === 'string' && title.length > 0)
      .map((title) => ({ section, title })),
  );
}
