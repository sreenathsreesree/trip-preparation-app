import { invitePathFor } from '@/features/sharing/inviteLinks';

/**
 * Normalises incoming links before routing: https invitation links, the
 * custom scheme (including the malformed `tripprep:///join/…` older builds
 * sent) and encoded tokens all land on the join screen. Everything else is
 * routed unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return invitePathFor(path) ?? path;
  } catch {
    return path;
  }
}
