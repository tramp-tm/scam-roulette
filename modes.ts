import type { Mode, GameMode } from './types.js';
import { NormalMode } from './normalMode.js';
import { SurvivalMode } from './survivalMode.js';

export const MODES: Record<Mode, GameMode> = {
    normal: new NormalMode(),
    survival: new SurvivalMode()
};

export function getMode(modeId: Mode): GameMode {
    return MODES[modeId];
}
