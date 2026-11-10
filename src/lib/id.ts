import { randomUUID } from 'expo-crypto';

/**
 * Creates a random RFC 4122 v4 identifier. UUIDs (rather than autoincrement
 * integers) keep records globally unique, which matters once cloud sync lands.
 */
export function createId(): string {
  return randomUUID();
}

export type IdFactory = () => string;
