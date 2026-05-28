/**
 * Calendar route — wires the screen to live data. The feed comes from
 * useFamilyEvents(familyId) (the only query the rules allow); create/delete are
 * the calendarService actions bound to the real Firestore. Event CRUD is
 * parent-only: the screen renders the + FAB and edit/delete affordances only for
 * a parent, and firestore.rules is the authoritative boundary.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import type { EventTag } from '../../lib/types';
import { useFamily } from '../../hooks/useFamily';
import { CalendarScreen } from './CalendarScreen';
import { useFamilyEvents } from './useFamilyEvents';
import { createEvent, deleteEvent, type CreateEventInput } from './calendarService';

export default function CalendarRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyEvents(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Calendar" />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
  };

  // The reference "today" derived from the real clock (the screen takes it as a
  // prop so its grid/highlight stay deterministic under test).
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

  // Firebase config is imported lazily (mirrors useFamily / BoardRoute) so the
  // shell module stays SDK-free at the top level.
  const handleDelete = async (eventId: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    await deleteEvent({ db }, eventId);
  };
  const handleCreate = async (value: {
    title: string;
    description: string;
    date: string;
    tag: EventTag;
  }): Promise<void> => {
    const { db } = await import('../../firebase/config');
    const input: CreateEventInput = {
      ...value,
      familyId,
      createdBy: viewer.uid,
    };
    await createEvent({ db }, input);
  };

  return (
    <CalendarScreen
      familyId={familyId}
      viewer={viewer}
      members={members}
      feed={feed}
      today={today}
      onDeleteEvent={handleDelete}
      onCreateEvent={handleCreate}
    />
  );
}
