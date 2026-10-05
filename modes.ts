import type { Mode, GameMode } from './types.js';
import { NormalMode } from './normalMode.js';
import { SurvivalMode } from './survivalMode.js';
import { CrownDefenseMode } from './crownDefenseMode.js';

export const MODES: Record<Mode, GameMode> = {
    normal: new NormalMode(),
    survival: new SurvivalMode(),
    'crown-defense': new CrownDefenseMode()
};

export function getMode(modeId: Mode): GameMode {
    return MODES[modeId];
}
