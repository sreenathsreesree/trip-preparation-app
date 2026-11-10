import { useEffect, useMemo } from 'react';

import { useChecklist, useChecklistStore } from './checklistStore';
import { templateOwner, tripOwner, type ChecklistOwner } from './model';
import { useTemplatesStore } from './templatesStore';

/** Loads an owner's checklist on first use and returns it from the store. */
export function useOwnerChecklist(owner: ChecklistOwner | null) {
  const entry = useChecklist(owner);
  const load = useChecklistStore((state) => state.load);
  const type = owner?.type;
  const id = owner?.id;
  useEffect(() => {
    if (type && id && entry.status === 'idle') {
      void load(type === 'trip' ? tripOwner(id) : templateOwner(id));
    }
  }, [type, id, entry.status, load]);
  return entry;
}

/** Stable owner object for hook dependencies. */
export function useOwner(type: ChecklistOwner['type'], id: string | undefined): ChecklistOwner | null {
  return useMemo(() => (id ? (type === 'trip' ? tripOwner(id) : templateOwner(id)) : null), [type, id]);
}

export function useEnsureTemplatesLoaded() {
  const status = useTemplatesStore((state) => state.status);
  const load = useTemplatesStore((state) => state.load);
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);
}
