import type { CategoryKey } from '../inventory/model';
import type { EntryUnit } from './model';

/**
 * Default suggested items per starter category: quick, optional picks shown in
 * a category. Nothing here is ever added automatically. `keywords` identify an
 * existing packing entry that already covers the suggestion (matched at word
 * starts, see `containsWord`); the name itself always counts too.
 */
export interface CatalogueItem {
  name: string;
  unit: EntryUnit;
  keywords: readonly string[];
}

const item = (name: string, unit: EntryUnit, ...keywords: string[]): CatalogueItem => ({ name, unit, keywords });

export const PACKING_CATALOGUE: Readonly<Record<CategoryKey, readonly CatalogueItem[]>> = {
  clothing: [
    item('T-shirts', 'pcs', 't-shirt', 'tshirt', 'tee'),
    item('Shirts', 'pcs', 'shirt'),
    item('Jeans', 'pcs', 'jeans'),
    item('Trousers', 'pcs', 'trouser', 'pants'),
    item('Shorts', 'pcs', 'shorts'),
    item('Underwear', 'pcs', 'underwear', 'innerwear', 'briefs', 'boxers'),
    item('Socks', 'pairs', 'sock'),
    item('Towels', 'pcs', 'towel'),
    item('Jackets', 'pcs', 'jacket'),
    item('Sleepwear', 'sets', 'sleepwear', 'pyjama', 'pajama', 'nightwear'),
  ],
  electronics: [
    item('Mobile phone', 'pcs', 'mobile phone', 'smartphone'),
    item('Phone charger', 'pcs', 'phone charger'),
    item('Power bank', 'pcs', 'power bank', 'powerbank'),
    item('Earphones', 'pairs', 'earphone', 'earbud', 'headphone'),
    item('Camera', 'pcs', 'camera'),
    item('Camera charger', 'pcs', 'camera charger', 'battery charger'),
    item('Memory card', 'pcs', 'memory card', 'sd card'),
    item('Laptop', 'pcs', 'laptop'),
    item('Laptop charger', 'pcs', 'laptop charger', 'laptop and charger'),
    item('Travel adapter', 'pcs', 'travel adapter', 'adapter'),
  ],
  toiletries: [
    item('Toothbrush', 'pcs', 'toothbrush'),
    item('Toothpaste', 'pcs', 'toothpaste'),
    item('Shampoo', 'bottles', 'shampoo'),
    item('Conditioner', 'bottles', 'conditioner'),
    item('Face wash', 'bottles', 'face wash', 'facewash'),
    item('Soap', 'pcs', 'soap'),
    item('Deodorant', 'pcs', 'deodorant', 'deo'),
    item('Comb', 'pcs', 'comb', 'hairbrush'),
    item('Sunscreen', 'bottles', 'sunscreen', 'sunblock'),
    item('Moisturiser', 'bottles', 'moisturiser', 'moisturizer'),
  ],
  footwear: [
    item('Casual shoes', 'pairs', 'casual shoe'),
    item('Walking shoes', 'pairs', 'walking shoe'),
    item('Slippers', 'pairs', 'slipper'),
    item('Sandals', 'pairs', 'sandal', 'flip-flop'),
    item('Trekking shoes', 'pairs', 'trekking shoe', 'hiking boot'),
  ],
  medicines: [
    item('Regular medicines', 'packs', 'regular medicine', 'prescription'),
    item('First-aid kit', 'pcs', 'first-aid', 'first aid'),
    item('Bandages', 'packs', 'bandage', 'band-aid'),
    item('Personal medical essentials', 'pcs', 'medical essential'),
  ],
  documents: [
    item('ID proof', 'pcs', 'id proof', 'id card', 'photo id', 'aadhaar'),
    item('Driving licence', 'pcs', 'driving licence', 'driving license'),
    item('Passport', 'pcs', 'passport'),
    item('Tickets', 'sets', 'ticket'),
    item('Hotel reservations', 'sets', 'hotel reservation', 'hotel booking'),
    item('Travel insurance documents', 'sets', 'travel insurance'),
  ],
  accessories: [
    item('Wallet', 'pcs', 'wallet'),
    item('Sunglasses', 'pcs', 'sunglasses'),
    item('Watch', 'pcs', 'watch'),
    item('Personal accessories', 'pcs', 'personal accessor'),
    item('Personal hygiene essentials', 'sets', 'hygiene'),
  ],
  outdoor: [
    item('Tent', 'pcs', 'tent'),
    item('Sleeping bag', 'pcs', 'sleeping bag'),
    item('Headlamp', 'pcs', 'headlamp', 'torch'),
    item('Trekking poles', 'pairs', 'trekking pole'),
  ],
  photography: [
    item('Camera', 'pcs', 'camera'),
    item('Spare batteries', 'pcs', 'spare batter', 'camera batter'),
    item('Memory cards', 'pcs', 'memory card', 'sd card'),
    item('Tripod', 'pcs', 'tripod'),
  ],
  food: [
    item('Snacks', 'packs', 'snack'),
    item('Water bottle', 'bottles', 'water bottle'),
  ],
  misc: [
    item('Books', 'pcs', 'book'),
    item('Laundry bag', 'pcs', 'laundry bag'),
  ],
};

export function catalogueFor(key: CategoryKey | null): readonly CatalogueItem[] {
  return key ? PACKING_CATALOGUE[key] : [];
}
