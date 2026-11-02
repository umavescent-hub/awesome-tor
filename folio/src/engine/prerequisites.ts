import type { ID, LibraryState, Material } from '@/domain/types';

export interface PrerequisiteStatus {
  total: number;
  completed: number;
  /** Prerequisite ids not yet completed (unknown ids are ignored, not counted). */
  missing: ID[];
}

/** Distinct prerequisite ids that exist in the library, in declared order. */
export function knownPrerequisites(materials: Record<ID, Material>, materialId: ID): ID[] {
  const declared = materials[materialId]?.prerequisites ?? [];
  return [...new Set(declared)].filter((id) => materials[id] !== undefined);
}

export function prerequisiteStatus(state: LibraryState, materialId: ID): PrerequisiteStatus {
  const known = knownPrerequisites(state.materials, materialId);
  const missing = known.filter((id) => state.progress[id]?.status !== 'completed');
  return { total: known.length, completed: known.length - missing.length, missing };
}

export function wouldCreateCycle(
  materials: Record<ID, Material>,
  materialId: ID,
  prerequisites: ID[],
): boolean {
  const edgesOf = (id: ID): readonly ID[] =>
    id === materialId ? prerequisites : (materials[id]?.prerequisites ?? []);
  // Walk everything the proposed prerequisites depend on; meeting materialId closes a loop.
  const stack = [...prerequisites];
  const visited = new Set<ID>();
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === materialId) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    stack.push(...edgesOf(id));
  }
  return false;
}

/** Reverse prerequisite graph: prerequisite id → ids of materials that list it. */
export function dependentsIndex(materials: Record<ID, Material>): ReadonlyMap<ID, readonly ID[]> {
  const index = new Map<ID, ID[]>();
  for (const id of Object.keys(materials).sort()) {
    for (const prerequisite of knownPrerequisites(materials, id)) {
      const dependents = index.get(prerequisite) ?? [];
      dependents.push(id);
      index.set(prerequisite, dependents);
    }
  }
  return index;
}

/** Materials depending on `materialId` directly or through a chain; cycle-safe, never itself. */
export function transitiveDependents(
  index: ReadonlyMap<ID, readonly ID[]>,
  materialId: ID,
): ReadonlySet<ID> {
  const found = new Set<ID>();
  const queue = [...(index.get(materialId) ?? [])];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (id === materialId || found.has(id)) continue;
    found.add(id);
    queue.push(...(index.get(id) ?? []));
  }
  return found;
}
