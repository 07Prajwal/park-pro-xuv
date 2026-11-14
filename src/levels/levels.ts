/**
 * All training levels, in order. Each level lives in `defs/levelNN.ts` and
 * builds its layout for a difficulty; parking levels derive their ideal
 * manoeuvre (guide line, hints, ghost replay) from the layout, so changing a
 * gap or bay size keeps the demonstration exact.
 *
 * Bay sizes follow Indian practice (about 2.5 x 5 m bays, 6-7.5 m aisles).
 * Kerbside parking is on the LEFT, as in India.
 */

import { level01 } from './defs/level01';
import { level02 } from './defs/level02';
import { level03 } from './defs/level03';
import { level04 } from './defs/level04';
import { level05 } from './defs/level05';
import { level06 } from './defs/level06';
import { level07 } from './defs/level07';
import { level08 } from './defs/level08';
import { level09 } from './defs/level09';
import { level10 } from './defs/level10';
import { level11 } from './defs/level11';
import { level12 } from './defs/level12';
import { level13 } from './defs/level13';
import type { LevelDef } from './types';

export const LEVELS: LevelDef[] = [level01, level02, level03, level04, level05, level06, level07, level08, level09, level10, level11, level12, level13];
