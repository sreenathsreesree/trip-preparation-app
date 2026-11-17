/** A checklist section's arrangement: group order and every task in display order with its group. */
export interface SectionLayout {
  groupIds: string[];
  /** Every task of the section, in display order, with its group (null = not in a group). */
  tasks: { id: string; groupId: string | null }[];
}

/** The layout after moving one task to `groupId` at `index` (among that group's other tasks). */
export function placeTask(layout: SectionLayout, taskId: string, groupId: string | null, index: number): SectionLayout {
  const rest = layout.tasks.filter((t) => t.id !== taskId);
  const inTarget = rest.filter((t) => t.groupId === groupId);
  const clamped = Math.max(0, Math.min(index, inTarget.length));
  // Insert before the task now at that index of the target group, or after the group's last task
  // (or at the end when the group is empty): the overall order only matters inside each group.
  const anchor = inTarget[clamped];
  const at = anchor ? rest.indexOf(anchor) : inTarget.length ? rest.indexOf(inTarget[inTarget.length - 1]!) + 1 : rest.length;
  const tasks = [...rest];
  tasks.splice(at, 0, { id: taskId, groupId });
  return { groupIds: layout.groupIds, tasks };
}

/** The layout after moving one group to `index` among the groups. */
export function placeGroup(layout: SectionLayout, groupId: string, index: number): SectionLayout {
  const rest = layout.groupIds.filter((id) => id !== groupId);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, groupId);
  return { groupIds: rest, tasks: layout.tasks };
}

