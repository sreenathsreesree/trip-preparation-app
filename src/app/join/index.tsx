import { JoinScreen } from '@/features/sharing/JoinScreen';

/** Join a trip by typing or pasting an invitation code or link. */
export default function JoinWithCodeRoute() {
  return <JoinScreen token={undefined} manual />;
}
