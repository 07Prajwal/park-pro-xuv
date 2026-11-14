/**
 * Settings and progress in localStorage (versioned keys, tolerant of missing or
 * corrupt data, and of storage being unavailable e.g. in private mode).
 */

import type { Difficulty } from '../levels/types';

export type MirrorMode = 'off' | 'cabin' | 'all';

export interface Settings {
  difficulty: Difficulty;
  allLevelsOpen: boolean;
  /** Ideal-path line, stop markers and step hints. */
  guides: boolean;
  /** Predicted path of the car's corners for the current steering, in the main view. */
  predictedPath: boolean;
  /** Show the rear camera automatically when R is selected. */
  autoRearCamera: boolean;
  mirrors: MirrorMode;
  eonOutline: boolean;
  camera: string;
}

export interface BestScore {
  stars: number;
  points: number;
  timeS: number;
}

export type Progress = Record<string, BestScore>;

const SETTINGS_KEY = 'parkpro.settings.v1';
const PROGRESS_KEY = 'parkpro.progress.v1';

export function defaultSettings(highQuality: boolean): Settings {
  return {
    difficulty: 'normal',
    allLevelsOpen: false,
    guides: true,
    predictedPath: false,
    autoRearCamera: true,
    mirrors: highQuality ? 'cabin' : 'off',
    eonOutline: false,
    camera: 'chase',
  };
}

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage full or unavailable: settings just won't persist.
  }
}

export function loadSettings(highQuality: boolean): Settings {
  const d = defaultSettings(highQuality);
  const s = read<Settings>(SETTINGS_KEY);
  if (!s) return d;
  const pick = <K extends keyof Settings>(k: K, ok: (v: unknown) => boolean): Settings[K] => (ok(s[k]) ? (s[k] as Settings[K]) : d[k]);
  const isBool = (v: unknown) => typeof v === 'boolean';
  return {
    difficulty: pick('difficulty', (v) => v === 'beginner' || v === 'normal' || v === 'hard'),
    allLevelsOpen: pick('allLevelsOpen', isBool),
    guides: pick('guides', isBool),
    predictedPath: pick('predictedPath', isBool),
    autoRearCamera: pick('autoRearCamera', isBool),
    mirrors: pick('mirrors', (v) => v === 'off' || v === 'cabin' || v === 'all'),
    eonOutline: pick('eonOutline', isBool),
    camera: pick('camera', (v) => typeof v === 'string'),
  };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export const scoreKey = (levelId: number, d: Difficulty): string => `${levelId}:${d}`;

export function loadProgress(): Progress {
  const p = read<Progress>(PROGRESS_KEY) ?? {};
  const out: Progress = {};
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v.stars === 'number' && typeof v.points === 'number' && typeof v.timeS === 'number') out[k] = v;
  }
  return out;
}

/** Record a result; returns true if it is a new best (more points, or same points faster). */
export function recordScore(progress: Progress, key: string, s: BestScore): boolean {
  const old = progress[key];
  if (old && (old.points > s.points || (old.points === s.points && old.timeS <= s.timeS))) return false;
  progress[key] = s;
  write(PROGRESS_KEY, progress);
  return true;
}

/** Levels 1 and 2 are always open; each further level opens when the previous one has been completed. */
export function isUnlocked(levelId: number, progress: Progress, allOpen: boolean): boolean {
  if (allOpen || levelId <= 2) return true;
  return Object.keys(progress).some((k) => k.startsWith(`${levelId - 1}:`) && progress[k].stars > 0);
}
