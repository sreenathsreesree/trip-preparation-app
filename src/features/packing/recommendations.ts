import { inclusiveDayCount, type ISODate } from '@/lib/dates';

import { containsWord, type CategoryKey } from '../inventory/model';
import type { Priority } from '../preparation/model';
import type { Traveller, TransportMode, TripCategory } from '../trips/model';
import type { Accommodation, Activity, PackingStyle, Suggestion } from './model';

/**
 * Deterministic, rules-based packing recommendations.
 *
 * Every rule states when it applies, how many to bring, its priority, which
 * category it belongs to and a human-readable reason. The same inputs always
 * produce the same suggestions in the same order, with stable keys, so
 * regeneration can be diffed against the user's earlier decisions.
 * No network, AI or randomness is involved.
 */

export interface RecommendationInput {
  startDate: ISODate;
  endDate: ISODate;
  destinations: readonly string[];
  transportMode: TransportMode;
  category: TripCategory;
  travellers: readonly Traveller[];
  activities: readonly Activity[];
  accommodation: Accommodation;
  laundry: boolean;
  packingStyle: PackingStyle;
  /** Inventory the user owns (archived items excluded by the caller). */
  inventory: readonly InventoryCandidate[];
}

export interface InventoryCandidate {
  id: string;
  name: string;
  description: string;
  categoryKey: CategoryKey | null;
}

/** Facts derived from the input, shared by all rules. */
export interface RuleContext {
  days: number;
  months: Set<number>;
  destinations: string[];
  transport: TransportMode;
  category: TripCategory;
  travellers: readonly Traveller[];
  adults: readonly Traveller[];
  children: readonly Traveller[];
  activities: Set<Activity>;
  accommodation: Accommodation;
  laundry: boolean;
  style: PackingStyle;
  /** First destination matching each climate list, for readable reasons. */
  cold: string | null;
  highAltitude: string | null;
  beach: string | null;
  monsoon: boolean;
  summer: boolean;
  winter: boolean;
  drives: boolean;
}

type Scope = 'trip' | 'traveller' | 'adult' | 'child';

interface Rule {
  key: string;
  name: string;
  category: CategoryKey;
  scope: Scope;
  /** Words that identify a matching inventory item. */
  keywords: readonly string[];
  when: (ctx: RuleContext) => boolean;
  priority: Priority | ((ctx: RuleContext) => Priority);
  quantity?: (ctx: RuleContext) => number;
  reason: (ctx: RuleContext) => string;
}

/* Destination keyword lists (lower-case substrings). */
const COLD_PLACES = [
  'leh', 'ladakh', 'spiti', 'kaza', 'manali', 'shimla', 'gulmarg', 'srinagar', 'kashmir', 'sikkim',
  'gangtok', 'tawang', 'darjeeling', 'auli', 'mussoorie', 'kedarnath', 'badrinath', 'chopta',
  'nainital', 'chandratal', 'rohtang', 'pahalgam', 'sonamarg', 'zanskar', 'kufri', 'dharamshala',
  'mcleodganj', 'munsiyari', 'switzerland', 'iceland', 'nepal',
];
const HIGH_ALTITUDE_PLACES = [
  'leh', 'ladakh', 'spiti', 'kaza', 'tawang', 'kedarnath', 'nathula', 'pangong', 'rohtang',
  'chandratal', 'zanskar', 'gurudongmar', 'everest',
];
const BEACH_PLACES = [
  'goa', 'gokarna', 'varkala', 'kovalam', 'andaman', 'havelock', 'pondicherry', 'puducherry', 'puri',
  'alibaug', 'diu', 'lakshadweep', 'beach', 'kanyakumari', 'tarkarli', 'maldives', 'bali', 'phuket',
];

function matchPlace(destinations: readonly string[], places: readonly string[]): string | null {
  for (const destination of destinations) {
    const text = destination.toLocaleLowerCase();
    if (places.some((place) => text.includes(place))) return destination;
  }
  return null;
}

function monthsBetween(start: ISODate, end: ISODate): Set<number> {
  const months = new Set<number>();
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endKey = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  while (year * 12 + month <= endKey && months.size < 12) {
    months.add(month);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function buildContext(input: RecommendationInput): RuleContext {
  const months = monthsBetween(input.startDate, input.endDate);
  const any = (list: number[]) => list.some((m) => months.has(m));
  return {
    days: inclusiveDayCount(input.startDate, input.endDate),
    months,
    destinations: [...input.destinations],
    transport: input.transportMode,
    category: input.category,
    travellers: input.travellers,
    adults: input.travellers.filter((t) => t.kind === 'adult'),
    children: input.travellers.filter((t) => t.kind === 'child'),
    activities: new Set(input.activities),
    accommodation: input.accommodation,
    laundry: input.laundry,
    style: input.packingStyle,
    cold: matchPlace(input.destinations, COLD_PLACES),
    highAltitude: matchPlace(input.destinations, HIGH_ALTITUDE_PLACES),
    beach: matchPlace(input.destinations, BEACH_PLACES),
    monsoon: any([6, 7, 8, 9]),
    summer: any([4, 5, 6]),
    winter: any([11, 12, 1, 2]),
    drives: input.transportMode === 'car' || input.transportMode === 'bike' || input.transportMode === 'mixed',
  };
}

/** Changes of clothing per traveller, from duration, laundry and packing style. */
export function clothingSets(ctx: RuleContext): number {
  let sets = ctx.laundry ? Math.min(ctx.days, 4) : ctx.days;
  if (ctx.style === 'light') sets = Math.ceil(sets * 0.7);
  if (ctx.style === 'thorough') sets += 1;
  return Math.max(1, Math.min(sets, 10));
}

function clothingReason(ctx: RuleContext, unit: string): string {
  const base = `${ctx.days}-day trip, ${unit}`;
  const notes = [
    ctx.laundry && ctx.days > 4 ? 'capped at 4 because laundry is available' : '',
    ctx.style === 'light' ? 'reduced for packing light' : '',
    ctx.style === 'thorough' ? 'plus a spare' : '',
  ].filter(Boolean);
  return notes.length > 0 ? `${base} (${notes.join('; ')})` : base;
}

const has = (ctx: RuleContext, activity: Activity) => ctx.activities.has(activity);
const isCold = (ctx: RuleContext) => Boolean(ctx.cold) || has(ctx, 'snow') || ctx.category === 'mountains';
const coldReason = (ctx: RuleContext) =>
  ctx.cold ? `${ctx.cold} can be cold` : has(ctx, 'snow') ? 'Snow on the itinerary' : 'Mountain trip';
const isBeach = (ctx: RuleContext) => Boolean(ctx.beach) || ctx.category === 'beach';
const isOutdoors = (ctx: RuleContext) =>
  has(ctx, 'trekking') || has(ctx, 'camping') || ctx.category === 'adventure';
const camping = (ctx: RuleContext) => has(ctx, 'camping') || ctx.accommodation === 'camping';
const overnightTransit = (ctx: RuleContext) =>
  ctx.accommodation === 'train_bus' || ctx.transport === 'train' || ctx.transport === 'bus';

export const RULES: readonly Rule[] = [
  /* Documents */
  {
    key: 'documents.id', name: 'Government photo ID', category: 'documents', scope: 'traveller',
    keywords: ['aadhaar', 'passport', 'pan card', 'id card', 'voter id'], when: () => true, priority: 'essential',
    reason: () => 'Needed for check-ins and identity checks',
  },
  {
    key: 'documents.tickets', name: 'Tickets saved offline or printed', category: 'documents', scope: 'trip',
    keywords: ['ticket', 'boarding pass'], when: (c) => !c.drives || c.transport === 'mixed', priority: 'essential',
    reason: (c) => `Travelling by ${c.transport}`,
  },
  {
    key: 'documents.licence', name: 'Driving licence', category: 'documents', scope: 'trip',
    keywords: ['licence', 'license', 'driving'], when: (c) => c.drives, priority: 'essential',
    reason: (c) => `Self-driven trip (${c.transport})`,
  },
  {
    key: 'documents.vehicle', name: 'Vehicle RC, insurance and PUC', category: 'documents', scope: 'trip',
    keywords: ['vehicle rc', 'rc book', 'registration', 'insurance', 'puc'], when: (c) => c.drives, priority: 'essential',
    reason: () => 'Required when driving your own vehicle',
  },
  {
    key: 'documents.permits', name: 'Permits (e.g. Inner Line Permit)', category: 'documents', scope: 'trip',
    keywords: ['permit'], when: (c) => Boolean(c.highAltitude), priority: 'recommended',
    reason: (c) => `Some areas around ${c.highAltitude} require permits`,
  },

  /* Clothing */
  {
    key: 'clothing.tops', name: 'T-shirts or tops', category: 'clothing', scope: 'traveller',
    keywords: ['t-shirt', 'tshirt', 'top', 'shirt', 'kurta'], when: () => true, priority: 'recommended',
    quantity: clothingSets, reason: (c) => clothingReason(c, 'one per day'),
  },
  {
    key: 'clothing.bottoms', name: 'Trousers or bottoms', category: 'clothing', scope: 'traveller',
    keywords: ['trouser', 'pants', 'jeans', 'shorts', 'leggings'], when: () => true, priority: 'recommended',
    quantity: (c) => Math.max(1, Math.ceil(clothingSets(c) / 2)), reason: (c) => clothingReason(c, 'one per two days'),
  },
  {
    key: 'clothing.innerwear', name: 'Innerwear', category: 'clothing', scope: 'traveller',
    keywords: ['innerwear', 'underwear', 'briefs', 'boxers', 'bra'], when: () => true, priority: 'essential',
    quantity: (c) => Math.min(clothingSets(c) + 1, 10), reason: (c) => clothingReason(c, 'one per day plus one'),
  },
  {
    key: 'clothing.socks', name: 'Pairs of socks', category: 'clothing', scope: 'traveller',
    keywords: ['sock'], when: () => true, priority: 'recommended',
    quantity: clothingSets, reason: (c) => clothingReason(c, 'one pair per day'),
  },
  {
    key: 'clothing.sleepwear', name: 'Sleepwear', category: 'clothing', scope: 'traveller',
    keywords: ['pyjama', 'pajama', 'nightwear', 'sleepwear'], when: (c) => c.days >= 2, priority: 'optional',
    reason: () => 'Overnight stay',
  },
  {
    key: 'clothing.warm_jacket', name: 'Warm jacket', category: 'clothing', scope: 'traveller',
    keywords: ['jacket', 'fleece', 'down', 'puffer', 'coat'], when: isCold,
    priority: (c) => (c.cold || has(c, 'snow') ? 'essential' : 'recommended'), reason: coldReason,
  },
  {
    key: 'clothing.thermals', name: 'Thermal innerwear', category: 'clothing', scope: 'traveller',
    keywords: ['thermal'], when: (c) => has(c, 'snow') || Boolean(c.highAltitude) || (Boolean(c.cold) && c.winter),
    priority: 'recommended', quantity: () => 2,
    reason: (c) => (c.highAltitude ? `High altitude at ${c.highAltitude}` : coldReason(c)),
  },
  {
    key: 'clothing.gloves', name: 'Gloves and beanie', category: 'clothing', scope: 'traveller',
    keywords: ['glove', 'beanie', 'woollen cap'], when: (c) => has(c, 'snow') || (Boolean(c.cold) && c.winter) || Boolean(c.highAltitude),
    priority: 'recommended', reason: coldReason,
  },
  {
    key: 'clothing.rain', name: 'Rain jacket or poncho', category: 'clothing', scope: 'traveller',
    keywords: ['raincoat', 'rain jacket', 'poncho'], when: (c) => c.monsoon || has(c, 'trekking'),
    priority: 'recommended', reason: (c) => (c.monsoon ? 'Travel during the monsoon months' : 'Weather changes quickly on treks'),
  },
  {
    key: 'clothing.swimwear', name: 'Swimwear', category: 'clothing', scope: 'traveller',
    keywords: ['swim', 'bikini', 'trunks'], when: (c) => isBeach(c) || has(c, 'swimming'),
    priority: 'recommended', reason: (c) => (c.beach ? `Beach time in ${c.beach}` : 'Swimming planned'),
  },
  {
    key: 'clothing.formal', name: 'Formal outfits', category: 'clothing', scope: 'adult',
    keywords: ['formal', 'blazer', 'suit'], when: (c) => c.category === 'business' || has(c, 'business'),
    priority: 'essential', quantity: (c) => Math.min(c.days, 3), reason: () => 'Meetings on this trip',
  },
  {
    key: 'clothing.festive', name: 'Festive outfits', category: 'clothing', scope: 'traveller',
    keywords: ['saree', 'sherwani', 'lehenga', 'festive', 'ethnic'], when: (c) => c.category === 'wedding',
    priority: 'essential', quantity: (c) => Math.min(c.days, 3), reason: () => 'Wedding functions',
  },
  {
    key: 'clothing.modest', name: 'Modest outfits for temple visits', category: 'clothing', scope: 'traveller',
    keywords: ['kurta', 'dupatta', 'dhoti', 'modest'], when: (c) => c.category === 'pilgrimage' || has(c, 'temple'),
    priority: 'recommended', quantity: (c) => Math.min(c.days, 2), reason: () => 'Temples often have dress codes',
  },
  {
    key: 'clothing.sunhat', name: 'Cap or sun hat', category: 'clothing', scope: 'traveller',
    keywords: ['cap', 'hat'], when: (c) => isBeach(c) || has(c, 'trekking') || c.summer,
    priority: 'optional', reason: (c) => (c.summer ? 'Strong sun in April–June' : 'Long hours outdoors'),
  },

  /* Footwear */
  {
    key: 'footwear.walking', name: 'Comfortable walking shoes', category: 'footwear', scope: 'traveller',
    keywords: ['sneaker', 'shoe', 'trainer'], when: () => true, priority: 'recommended',
    reason: () => 'Sightseeing and transit days',
  },
  {
    key: 'footwear.trekking', name: 'Trekking shoes', category: 'footwear', scope: 'traveller',
    keywords: ['trekking shoe', 'hiking shoe', 'boot'], when: (c) => has(c, 'trekking'), priority: 'essential',
    reason: () => 'Trekking planned',
  },
  {
    key: 'footwear.sandals', name: 'Sandals or flip-flops', category: 'footwear', scope: 'traveller',
    keywords: ['sandal', 'slipper', 'flip-flop', 'flip flop', 'chappal'],
    when: (c) => isBeach(c) || has(c, 'swimming') || c.accommodation === 'hostel' || c.accommodation === 'camping',
    priority: 'optional', reason: (c) => (isBeach(c) ? 'Beach and wet areas' : 'Shared bathrooms'),
  },
  {
    key: 'footwear.formal', name: 'Formal shoes', category: 'footwear', scope: 'adult',
    keywords: ['formal shoe', 'oxford', 'loafer', 'heels'],
    when: (c) => c.category === 'business' || c.category === 'wedding' || has(c, 'business'),
    priority: 'recommended', reason: (c) => (c.category === 'wedding' ? 'Wedding functions' : 'Meetings on this trip'),
  },

  /* Toiletries */
  {
    key: 'toiletries.toothbrush', name: 'Toothbrush', category: 'toiletries', scope: 'traveller',
    keywords: ['toothbrush'], when: () => true, priority: 'essential', reason: () => 'Daily essential',
  },
  {
    key: 'toiletries.kit', name: 'Toiletries kit', category: 'toiletries', scope: 'trip',
    keywords: ['toiletr', 'wash bag', 'shampoo', 'soap'], when: () => true,
    priority: (c) => (c.accommodation === 'hotel' ? 'recommended' : 'essential'),
    reason: (c) =>
      c.accommodation === 'hotel' ? 'Hotels may only provide basics' : `Staying at a ${c.accommodation.replace('_', '/')} — bring your own`,
  },
  {
    key: 'toiletries.sunscreen', name: 'Sunscreen', category: 'toiletries', scope: 'trip',
    keywords: ['sunscreen', 'sunblock', 'spf'], when: (c) => isBeach(c) || isCold(c) || isOutdoors(c) || c.summer,
    priority: 'recommended',
    reason: (c) => (isBeach(c) ? 'Beach sun' : c.highAltitude || isCold(c) ? 'Strong UV in the mountains' : 'Long hours outdoors'),
  },
  {
    key: 'toiletries.towel', name: 'Quick-dry towel', category: 'toiletries', scope: 'traveller',
    keywords: ['towel'], when: (c) => ['hostel', 'camping', 'train_bus'].includes(c.accommodation) || isBeach(c),
    priority: 'recommended', reason: (c) => (isBeach(c) ? 'Beach days' : 'Towels are not usually provided'),
  },
  {
    key: 'toiletries.lipbalm', name: 'Lip balm and moisturiser', category: 'toiletries', scope: 'trip',
    keywords: ['lip balm', 'moisturi', 'cold cream'], when: (c) => isCold(c), priority: 'optional', reason: coldReason,
  },

  /* Electronics */
  {
    key: 'electronics.phone_charger', name: 'Phone charger', category: 'electronics', scope: 'adult',
    keywords: ['phone charger', 'charger'], when: () => true, priority: 'essential', reason: () => 'Keep your phone alive',
  },
  {
    key: 'electronics.power_bank', name: 'Power bank', category: 'electronics', scope: 'trip',
    keywords: ['power bank', 'powerbank'], when: () => true,
    priority: (c) => (isOutdoors(c) || c.highAltitude ? 'essential' : 'recommended'),
    reason: (c) => (isOutdoors(c) || c.highAltitude ? 'Charging points may be scarce' : 'Long travel days'),
  },
  {
    key: 'electronics.laptop', name: 'Laptop and charger', category: 'electronics', scope: 'adult',
    keywords: ['laptop', 'macbook'], when: (c) => c.category === 'business' || has(c, 'business'),
    priority: 'essential', reason: () => 'Work on this trip',
  },
  {
    key: 'electronics.headlamp', name: 'Torch or headlamp', category: 'electronics', scope: 'trip',
    keywords: ['torch', 'headlamp', 'flashlight', 'lantern'], when: (c) => isOutdoors(c) || camping(c) || Boolean(c.highAltitude),
    priority: (c) => (camping(c) ? 'essential' : 'recommended'), reason: (c) => (camping(c) ? 'Camping after dark' : 'Remote areas and power cuts'),
  },
  {
    key: 'electronics.car_charger', name: 'Car charger and phone mount', category: 'electronics', scope: 'trip',
    keywords: ['car charger', 'phone mount', 'phone holder'], when: (c) => c.transport === 'car' || has(c, 'road_trip'),
    priority: 'recommended', reason: () => 'Navigation on the road',
  },
  {
    key: 'electronics.extension', name: 'Extension board', category: 'electronics', scope: 'trip',
    keywords: ['extension', 'multi plug', 'power strip'], when: (c) => c.travellers.length >= 3 && c.accommodation !== 'camping',
    priority: 'optional', reason: (c) => `${c.travellers.length} travellers sharing sockets`,
  },

  /* Medicines */
  {
    key: 'medicines.first_aid', name: 'First-aid kit', category: 'medicines', scope: 'trip',
    keywords: ['first aid', 'first-aid', 'medkit'], when: () => true, priority: 'essential', reason: () => 'Minor cuts and illness',
  },
  {
    key: 'medicines.personal', name: 'Personal prescription medicines', category: 'medicines', scope: 'traveller',
    keywords: ['prescription'], when: () => true, priority: 'recommended', reason: (c) => `Enough for ${c.days} days plus a spare`,
  },
  {
    key: 'medicines.motion', name: 'Motion sickness tablets', category: 'medicines', scope: 'trip',
    keywords: ['motion sickness', 'avomine', 'travel sickness'],
    when: (c) => (c.transport === 'car' || c.transport === 'bus' || c.transport === 'mixed') && (isCold(c) || c.category === 'mountains'),
    priority: 'recommended', reason: () => 'Winding mountain roads',
  },
  {
    key: 'medicines.ors', name: 'ORS sachets', category: 'medicines', scope: 'trip',
    keywords: ['ors', 'electral', 'electrolyte'], when: (c) => c.summer || c.days >= 4 || has(c, 'trekking'),
    priority: 'recommended', reason: (c) => (c.summer ? 'Heat and dehydration in summer' : 'Longer trip, stay hydrated'),
  },
  {
    key: 'medicines.altitude', name: 'Altitude sickness medicine (ask your doctor)', category: 'medicines', scope: 'trip',
    keywords: ['diamox', 'acetazolamide', 'altitude'], when: (c) => Boolean(c.highAltitude), priority: 'recommended',
    reason: (c) => `High altitude at ${c.highAltitude}`,
  },
  {
    key: 'medicines.kids', name: "Children's medicines (fever, cold)", category: 'medicines', scope: 'trip',
    keywords: ['kids medicine', 'syrup', 'calpol'], when: (c) => c.children.length > 0, priority: 'essential',
    reason: (c) => `${c.children.length} ${c.children.length === 1 ? 'child' : 'children'} travelling`,
  },
  {
    key: 'medicines.mosquito', name: 'Mosquito repellent', category: 'medicines', scope: 'trip',
    keywords: ['repellent', 'odomos', 'mosquito'], when: (c) => c.monsoon || isBeach(c) || camping(c),
    priority: 'recommended', reason: (c) => (c.monsoon ? 'Monsoon months' : camping(c) ? 'Camping outdoors' : 'Coastal areas'),
  },

  /* Travel accessories */
  {
    key: 'accessories.bottle', name: 'Reusable water bottle', category: 'accessories', scope: 'traveller',
    keywords: ['bottle', 'flask', 'sipper'], when: () => true, priority: 'recommended', reason: () => 'Stay hydrated, less plastic',
  },
  {
    key: 'accessories.daypack', name: 'Daypack', category: 'accessories', scope: 'trip',
    keywords: ['daypack', 'backpack'], when: (c) => isOutdoors(c) || has(c, 'photography') || c.days >= 3,
    priority: 'recommended', reason: () => 'Carry essentials on day outings',
  },
  {
    key: 'accessories.pillow', name: 'Travel neck pillow', category: 'accessories', scope: 'traveller',
    keywords: ['neck pillow', 'travel pillow'], when: (c) => c.transport === 'flight' || overnightTransit(c),
    priority: 'optional', reason: (c) => (overnightTransit(c) ? 'Overnight journey' : 'Rest on the flight'),
  },
  {
    key: 'accessories.padlock', name: 'Padlock', category: 'accessories', scope: 'trip',
    keywords: ['padlock', 'lock'], when: (c) => c.accommodation === 'hostel' || overnightTransit(c),
    priority: 'recommended', reason: (c) => (c.accommodation === 'hostel' ? 'Hostel lockers' : 'Secure bags on overnight journeys'),
  },
  {
    key: 'accessories.sunglasses', name: 'Sunglasses', category: 'accessories', scope: 'traveller',
    keywords: ['sunglass', 'shades'], when: (c) => isBeach(c) || has(c, 'snow') || Boolean(c.highAltitude) || c.summer,
    priority: (c) => (has(c, 'snow') || c.highAltitude ? 'essential' : 'recommended'),
    reason: (c) => (has(c, 'snow') ? 'Snow glare' : c.highAltitude ? 'Strong UV at altitude' : 'Bright sun'),
  },
  {
    key: 'accessories.umbrella', name: 'Umbrella', category: 'accessories', scope: 'trip',
    keywords: ['umbrella'], when: (c) => c.monsoon, priority: 'recommended', reason: () => 'Monsoon months',
  },
  {
    key: 'accessories.laundry_bag', name: 'Laundry bag', category: 'accessories', scope: 'trip',
    keywords: ['laundry bag'], when: (c) => c.days >= 4, priority: 'optional', reason: (c) => `${c.days}-day trip`,
  },
  {
    key: 'accessories.dry_bags', name: 'Zip-lock or dry bags', category: 'accessories', scope: 'trip',
    keywords: ['zip-lock', 'ziplock', 'dry bag'], when: (c) => c.monsoon || isBeach(c) || has(c, 'trekking'),
    priority: 'optional', reason: (c) => (c.monsoon ? 'Keep things dry in the monsoon' : 'Protect phones and documents'),
  },
  {
    key: 'accessories.helmet', name: 'Riding helmet', category: 'accessories', scope: 'adult',
    keywords: ['helmet'], when: (c) => c.transport === 'bike' || has(c, 'cycling'), priority: 'essential',
    reason: (c) => (c.transport === 'bike' ? 'Motorbike trip' : 'Cycling planned'),
  },
  {
    key: 'accessories.riding_gear', name: 'Riding jacket and gloves', category: 'accessories', scope: 'adult',
    keywords: ['riding jacket', 'riding glove'], when: (c) => c.transport === 'bike', priority: 'recommended',
    reason: () => 'Protection on long rides',
  },

  /* Camping and outdoor */
  {
    key: 'outdoor.tent', name: 'Tent', category: 'outdoor', scope: 'trip', keywords: ['tent'],
    when: camping, priority: 'essential', quantity: (c) => Math.max(1, Math.ceil(c.travellers.length / 2)),
    reason: (c) => `Camping for ${c.travellers.length} — one tent per two people`,
  },
  {
    key: 'outdoor.sleeping_bag', name: 'Sleeping bag', category: 'outdoor', scope: 'traveller',
    keywords: ['sleeping bag'], when: camping, priority: 'essential', reason: () => 'Camping nights',
  },
  {
    key: 'outdoor.sleeping_mat', name: 'Sleeping mat', category: 'outdoor', scope: 'traveller',
    keywords: ['sleeping mat', 'sleeping pad', 'yoga mat'], when: camping, priority: 'recommended', reason: () => 'Insulation from the ground',
  },
  {
    key: 'outdoor.poles', name: 'Trekking poles', category: 'outdoor', scope: 'adult',
    keywords: ['trekking pole', 'walking stick'], when: (c) => has(c, 'trekking'), priority: 'optional', reason: () => 'Easier on the knees on descents',
  },

  /* Photography */
  {
    key: 'photography.camera', name: 'Camera', category: 'photography', scope: 'trip',
    keywords: ['camera', 'dslr', 'mirrorless', 'gopro'], when: (c) => has(c, 'photography'), priority: 'essential',
    reason: () => 'Photography planned',
  },
  {
    key: 'photography.cards', name: 'Spare memory cards', category: 'photography', scope: 'trip',
    keywords: ['memory card', 'sd card'], when: (c) => has(c, 'photography'), priority: 'recommended',
    quantity: (c) => (c.days > 5 ? 3 : 2), reason: (c) => `${c.days} days of shooting`,
  },
  {
    key: 'photography.batteries', name: 'Spare camera batteries', category: 'photography', scope: 'trip',
    keywords: ['camera battery', 'spare battery'], when: (c) => has(c, 'photography'), priority: 'recommended',
    quantity: (c) => (isCold(c) ? 3 : 2), reason: (c) => (isCold(c) ? 'Batteries drain faster in the cold' : 'Full days of shooting'),
  },

  /* Food and essentials */
  {
    key: 'food.snacks', name: 'Travel snacks', category: 'food', scope: 'trip',
    keywords: ['snack', 'dry fruit', 'nuts', 'biscuit'], when: (c) => c.drives || c.transport === 'train' || c.transport === 'bus' || isOutdoors(c),
    priority: 'recommended', reason: (c) => (isOutdoors(c) ? 'Energy on the trail' : 'Long journey'),
  },
  {
    key: 'food.water', name: 'Drinking water bottles', category: 'food', scope: 'trip',
    keywords: ['water can', 'drinking water'], when: (c) => c.drives, priority: 'recommended',
    quantity: (c) => Math.max(2, c.travellers.length), reason: () => 'Stretches without shops on the road',
  },
  {
    key: 'food.kids_snacks', name: 'Snacks for the kids', category: 'food', scope: 'trip',
    keywords: ['kids snack'], when: (c) => c.children.length > 0, priority: 'recommended',
    reason: (c) => `${c.children.length} ${c.children.length === 1 ? 'child' : 'children'} travelling`,
  },

  /* Miscellaneous */
  {
    key: 'misc.kids_entertainment', name: 'Books or games', category: 'misc', scope: 'child',
    keywords: ['book', 'game', 'toy', 'colouring'], when: (c) => c.children.length > 0 && c.days >= 2,
    priority: 'optional', reason: () => 'Keep kids busy on the way',
  },
  {
    key: 'misc.gifts', name: 'Gifts for hosts', category: 'misc', scope: 'trip',
    keywords: ['gift'], when: (c) => c.category === 'wedding' || c.category === 'family' || c.accommodation === 'family',
    priority: 'optional', reason: (c) => (c.category === 'wedding' ? 'Wedding gift' : 'Staying with family or friends'),
  },
];

/** Finds an owned item whose name or description contains one of the rule's keywords. */
function matchInventory(rule: Rule, inventory: readonly InventoryCandidate[]): string | null {
  const matches = inventory.filter((item) =>
    rule.keywords.some((keyword) => containsWord(`${item.name} ${item.description}`, keyword.trim())),
  );
  if (matches.length === 0) return null;
  const preferred = matches.find((item) => item.categoryKey === rule.category) ?? matches[0];
  return preferred?.id ?? null;
}

export function generateSuggestions(input: RecommendationInput): Suggestion[] {
  const ctx = buildContext(input);
  const inventory = [...input.inventory].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const suggestions: Suggestion[] = [];

  for (const rule of RULES) {
    if (!rule.when(ctx)) continue;
    const priority = typeof rule.priority === 'function' ? rule.priority(ctx) : rule.priority;
    const quantity = Math.max(1, Math.round(rule.quantity?.(ctx) ?? 1));
    const reason = rule.reason(ctx);
    const inventoryItemId = matchInventory(rule, inventory);
    const base = { name: rule.name, quantity, priority, reason, categoryKey: rule.category, inventoryItemId };

    const people =
      rule.scope === 'traveller' ? ctx.travellers : rule.scope === 'adult' ? ctx.adults : rule.scope === 'child' ? ctx.children : null;
    if (people === null) {
      suggestions.push({ ...base, key: rule.key, travellerId: null });
    } else {
      for (const traveller of people) {
        suggestions.push({ ...base, key: `${rule.key}:${traveller.id}`, travellerId: traveller.id });
      }
    }
  }
  return suggestions;
}

/**
 * Words identifying a packing entry that already covers a suggestion: the
 * rule's inventory keywords (suggestion keys are `rule` or `rule:traveller`).
 */
export function suggestionKeywords(key: string): readonly string[] {
  const ruleKey = key.split(':')[0];
  return RULES.find((rule) => rule.key === ruleKey)?.keywords ?? [];
}
