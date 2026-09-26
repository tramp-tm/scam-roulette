import type { GameMode, GameState, Lot, Mode } from './types.js';
import { getMode } from './modes.js';

/**
 * Represents the current game session: the active game mode paired with a
 * derived view of the game state (all lots + active lots).
 *
 * Layer position (Stage 2 of the refactor plan):
 *
 *     App ──► GameSession ──► GameMode
 *               │
 *               └──► LotManager (via lots accessor)
 *
 * Responsibilities (Stage 2):
 *   - own the current GameMode (the rules that govern this session);
 *   - derive the current GameState (all lots + active lots) from the global
 *     lot list supplied by `LotManager`, so it can never go stale;
 *   - expose a single authoritative point of mode change via `setMode()`.
 *
 * Non-responsibilities (kept where they belong per the plan):
 *   - game rules            → GameMode (NormalMode / SurvivalMode)
 *   - roulette mechanics    → RouletteEngine
 *   - lot CRUD / storage    → LotManager
 *   - UI / Canvas / animation
 *
 * Design note (Stage 2, §2 / §4 / §6 / §7 of the plan):
 *
 *   The Stage 1 implementation cached `allLots` and `activeLots` as two
 *   independent snapshots and required App to call `recreate()` after every
 *   lot-list mutation — correctness depended on remembering each call site,
 *   and `activeLots` (produced by a `filter()`) could silently diverge from
 *   the shared `Lot` objects whenever `lot.active` was mutated outside the
 *   `recreate()` path.
 *
 *   Stage 2 removes that hazard entirely. The session keeps an *accessor*
 *   for the global lot list (a thin closure, typically
 *   `() => lotManager.getAllLots()`), and `allLots` / `activeLots` /
 *   `activeCount` / `state` are all computed on read:
 *
 *     - because `Lot` objects are shared by reference with `LotManager`,
 *       mutations to `lot.active` (deactivations at the end of a spin,
 *       `resetAll()` on reset) are observed immediately;
 *     - structural changes to the list (add / delete / clear / import) are
 *       picked up automatically, because the accessor always returns the
 *       current contents of the manager's list;
 *     - no `syncGameSession()`-style bookkeeping is needed in `App`, and
 *       there is no cached snapshot that can go stale.
 *
 *   The only piece of state this class truly *owns* is the current mode.
 */
export class GameSession {
    private currentMode: GameMode;
    private readonly getLots: () => readonly Lot[];

    /**
     * @param modeId  The initial mode governing this session.
     * @param getLots Accessor for the current global lot list (typically
     *                `() => lotManager.getAllLots()`). Invoked on every read
     *                of `allLots` / `activeLots` / `activeCount` / `state`,
     *                so any mutation to the underlying list is reflected
     *                without an explicit sync.
     */
    constructor(modeId: Mode, getLots: () => readonly Lot[]) {
        this.currentMode = getMode(modeId);
        this.getLots = getLots;
    }

    /** The mode currently governing this session. */
    get mode(): GameMode {
        return this.currentMode;
    }

    /**
     * All lots in the current session, as a fresh snapshot of the global
     * lot list. Backed by the accessor, so it always reflects the latest
     * contents of `LotManager`.
     */
    get allLots(): readonly Lot[] {
        return this.getLots();
    }

    /**
     * Lots currently participating in the session.
     * Derived on read, so `lot.active` mutations are seen immediately.
     */
    get activeLots(): Lot[] {
        return this.getLots().filter(lot => lot.active);
    }

    /** Number of active lots in the current session. */
    get activeCount(): number {
        return this.activeLots.length;
    }

    /**
     * Snapshot of the current game state (all lots + active lots), passed
     * to a mode's roll-processing logic (`GameMode.processRoll`).
     *
     * Both fields are taken from a single read of the accessor, so the two
     * lists are always mutually consistent.
     */
    get state(): GameState {
        const all: Lot[] = [...this.getLots()];
        return {
            allLots: all,
            activeLots: all.filter(lot => lot.active)
        };
    }

    /**
     * Switches the mode governing this session.
     *
     * This is the single, authoritative point of mode change (§2 / §3 of the
     * plan). `App` never assigns `settings.modeId` to drive the session — it
     * calls `setMode()` here and mirrors the value into `settings.modeId`
     * purely as a UI / persistence record.
     *
     * Mode switches deliberately preserve the current `lot.active` flags:
     * the new rules apply to the current participation state rather than
     * resetting it. (The Stage 1 comment promising "no carry-over" was
     * misleading — `Lot.active` was, and still is, carried over.)
     */
    setMode(modeId: Mode): void {
        this.currentMode = getMode(modeId);
    }
}
