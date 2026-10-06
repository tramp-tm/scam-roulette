import type { Mode, GameMode } from './types.js';
import { NormalMode } from './normalMode.js';
import { SurvivalMode } from './survivalMode.js';
import { CrownDefenseHalfTestMode } from './crownDefenseHalfTestMode.js';
import { WeakestLinkMode } from './weakestLinkMode.js';
import { WeakestLinkAmountMode } from './weakestLinkAmountMode.js';
import { KingOfTheHillMode } from './kingOfTheHillMode.js';
import { KingOfTheHillAmountMode } from './kingOfTheHillAmountMode.js';

export const MODES: Record<Mode, GameMode> = {
    normal: new NormalMode(),
    survival: new SurvivalMode(),
    'crown-defense-half-test': new CrownDefenseHalfTestMode(),
    'weakest-link': new WeakestLinkMode(),
    'weakest-link-amount': new WeakestLinkAmountMode(),
    'king-of-the-hill': new KingOfTheHillMode(),
    'king-of-the-hill-amount': new KingOfTheHillAmountMode()
};

export function getMode(modeId: Mode): GameMode {
    return MODES[modeId];
}
