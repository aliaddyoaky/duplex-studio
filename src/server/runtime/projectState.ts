import {
  ProjectPhaseSchema,
  ProjectStateSchema,
  type IntentPatch,
  type ProjectPhase,
  type ProjectState,
} from '../../shared/schemas.js';

export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(expected: number, received: number) {
    super(`Intent patch targets version ${received}; current version is ${expected}`);
    this.name = 'VersionConflictError';
  }
}

export interface PatchCommitResult {
  previous: ProjectState;
  current: ProjectState;
  changedFields: string[];
}

export function createInitialState(brief: ProjectState['brief']): ProjectState {
  return ProjectStateSchema.parse({
    projectId: 'project_local',
    version: 1,
    phase: 'BRIEFING',
    brief,
    creative: {
      sellingPoint: '',
      style: '',
      tone: '',
      hook: '',
      rationale: '',
    },
    scenes: [],
    assets: [],
    generatedClips: [],
  });
}

const allowedTransitions: Record<ProjectPhase, ProjectPhase[]> = {
  ASSET_PREP: ['BRIEFING', 'FAILED'],
  BRIEFING: ['SCRIPT_REVIEW', 'FAILED'],
  SCRIPT_REVIEW: ['BRIEFING', 'PRODUCING', 'FAILED'],
  PRODUCING: ['MIXING', 'SCRIPT_REVIEW', 'FAILED'],
  MIXING: ['COMPLETED', 'SCRIPT_REVIEW', 'FAILED'],
  COMPLETED: ['SCRIPT_REVIEW', 'FAILED'],
  FAILED: ['SCRIPT_REVIEW', 'PRODUCING', 'FAILED'],
};

export function transitionProjectPhase(state: ProjectState, nextPhase: ProjectPhase): ProjectState {
  const currentPhase = ProjectPhaseSchema.parse(state.phase);
  if (currentPhase === nextPhase) return structuredClone(state);
  if (!allowedTransitions[currentPhase].includes(nextPhase)) {
    throw new Error(`Cannot transition project from ${currentPhase} to ${nextPhase}; script review confirmation is required`);
  }
  return ProjectStateSchema.parse({ ...state, phase: nextPhase });
}

function arrayIndex(array: unknown[], key: string): number {
  if (/^\d+$/.test(key)) return Number(key);
  return array.findIndex(
    (item) => typeof item === 'object' && item !== null && (item as { id?: unknown }).id === key,
  );
}

function readPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (Array.isArray(current)) {
      const index = arrayIndex(current, key);
      return index >= 0 ? current[index] : undefined;
    }
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, target);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor: unknown = target;
  for (const key of keys.slice(0, -1)) {
    if (Array.isArray(cursor)) {
      const index = arrayIndex(cursor, key);
      if (index < 0) throw new Error(`Unknown array item '${key}' in patch path '${path}'`);
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== 'object' || cursor === null) {
      throw new Error(`Cannot traverse patch path '${path}'`);
    }
    const record = cursor as Record<string, unknown>;
    const next = record[key];
    if (typeof next !== 'object' || next === null) record[key] = {};
    cursor = record[key];
  }
  const finalKey = keys.at(-1)!;
  if (Array.isArray(cursor)) {
    const index = arrayIndex(cursor, finalKey);
    if (index < 0) throw new Error(`Unknown array item '${finalKey}' in patch path '${path}'`);
    cursor[index] = value;
    return;
  }
  if (typeof cursor !== 'object' || cursor === null) throw new Error(`Cannot write patch path '${path}'`);
  (cursor as Record<string, unknown>)[finalKey] = value;
}

export function commitIntentPatch(
  current: ProjectState,
  patch: IntentPatch,
): PatchCommitResult {
  if (patch.baseVersion !== current.version) {
    throw new VersionConflictError(current.version, patch.baseVersion);
  }

  const previous = structuredClone(current);
  const next = structuredClone(current) as unknown as Record<string, unknown>;
  const changedFields: string[] = [];

  for (const [path, value] of Object.entries(patch.changes)) {
    if (!/^(brief|creative|script|scenes)\./.test(path) || path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) {
      throw new Error(`Editing runtime field '${path}' is not allowed; confirm the script separately`);
    }
    if (!Object.is(readPath(previous, path), value)) {
      writePath(next, path, value);
      changedFields.push(path);
    }
  }

  next.version = current.version + 1;
  return {
    previous,
    current: ProjectStateSchema.parse(next),
    changedFields,
  };
}
