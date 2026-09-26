import type { GameMode, GameState, Lot, Mode } from './types.js';
import { getMode } from './modes.js';

/**
 * Represents the current game session: the active game mode paired with a
 * snapshot of the game state (all lots + active lots).
 *
 * Layer position (Stage 1 of the refactor plan):
 *
 *     App ──► GameSession ──► GameState
 *               │
 *               └──► GameMode
 *
 * Responsibilities (Stage 1):
 *   - hold the current GameMode (the rules that govern this session);
 *   - hold the current GameState (a snapshot of the lot list at (re)creation time);
 *   - be re-creatable from the latest global lot list.
 *
 * Non-responsibilities (kept where they belong per the plan):
 *   - game rules            → GameMode (NormalMode / SurvivalMode)
 *   - roulette mechanics    → RouletteEngine
 *   - lot CRUD / storage    → LotManager
 *   - UI / Canvas / animation
 *
 * The `Lot` objects inside `GameState` are shared references with the ones
 * owned by `LotManager`: flag mutations (`lot.active = …`) that LotManager
 * performs are visible here without a rebuild. Structural changes to the
 * list (add / delete / clear / import) require App to call `recreate()` so
 * the snapshot stays in sync with the underlying lot list.
 */
export class GameSession {
    private currentMode: GameMode;
    private currentState: GameState;

    constructor(modeId: Mode, allLots: readonly Lot[]) {
        this.currentMode = getMode(modeId);
        this.currentState = GameSession.buildState(allLots);
    }

    /** The mode currently governing this session. */
    get mode(): GameMode {
        return this.currentMode;
    }

    /** Snapshot of the current game state (all lots + active lots). */
    get state(): GameState {
        return this.currentState;
    }

    /** Lots currently participating in the session. */
    get activeLots(): Lot[] {
        return this.currentState.activeLots;
    }

    /**
     * Re-creates the session with the given mode and lot list.
     * App calls this after a mode switch, after any structural change to
     * the lot list (add / delete / clear / import / reset), and after
     * deactivating lots at the end of a spin, so `state` never diverges
     * from the current lot list in `LotManager`.
     */
    recreate(modeId: Mode, allLots: readonly Lot[]): void {
        this.currentMode = getMode(modeId);
        this.currentState = GameSession.buildState(allLots);
    }

    private static buildState(allLots: readonly Lot[]): GameState {
        const all: Lot[] = [...allLots];
        return {
            allLots: all,
            activeLots: all.filter(lot => lot.active)
        };
    }
}
