import type { Mode, GameMode } from './types.js';
import { NormalMode } from './normalMode.js';
import { SurvivalMode } from './survivalMode.js';
import { CrownDefenseHalfTestMode } from './crownDefenseHalfTestMode.js';
import { WeakestLinkMode } from './weakestLinkMode.js';
import { KingOfTheHillAmountMode } from './kingOfTheHillAmountMode.js';
import { TournamentMode } from './tournamentMode.js';

export const MODES: Record<Mode, GameMode> = {
    normal: new NormalMode(),
    survival: new SurvivalMode(),
    'crown-defense-half-test': new CrownDefenseHalfTestMode(),
    'weakest-link': new WeakestLinkMode(),
    'king-of-the-hill-amount': new KingOfTheHillAmountMode(),
    tournament: new TournamentMode()
};

export function getMode(modeId: Mode): GameMode {
    return MODES[modeId];
}
