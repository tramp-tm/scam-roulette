import type { GameMode, GameState, Lot, Mode } from './types.js';
import { getMode } from './modes.js';

/**
 * Represents the current game session: the active game mode paired with the
 * session-owned participation state for the current game.
 *
 * Layer position (after the Stage 3 refactor):
 *
 *     App ──► GameSession ──► GameMode
 *               │
 *               └──► LotManager (read-only accessor for the global lot list)
 *
 * Responsibilities:
 *   - own the current GameMode (the rules that govern this session);
 *   - own the participation state of the current game (which lots take part
 *     in the current session);
 *   - expose a single authoritative point of mode change via `setMode()`;
 *   - expose explicit mutation operations (`addLot`, `removeLot`,
 *     `deactivateMany`, `clearLots`, `reset`, `reconcileAfterBulkChange`) so
 *     that changes to the *global* lot list and changes to the *current game*
 *     are two clearly separated concerns (see refac3.md §6).
 *
 * Non-responsibilities (kept where they belong per the plan):
 *   - game rules            → GameMode (NormalMode / SurvivalMode)
 *   - roulette mechanics    → RouletteEngine
 *   - lot CRUD / storage    → LotManager
 *   - UI / Canvas / animation
 *
 * Ownership & invariants (Stage 3, §2–§7 of the plan):
 *
 *   The Stage 2 implementation derived `activeLots` on every read by
 *   filtering the global lot list on `Lot.active`. That made `LotManager`
 *   (which owned the `active` flag) the de-facto owner of the current game
 *   state, and it introduced a second source of truth for participation
 *   (`Lot.active` on the shared object alongside anything else that wanted
 *   to reason about actives).
 *
 *   Stage 3 moves ownership of participation into this class:
 *
 *     - the session keeps its own `activeLotIds: Set<string>`;
 *     - every read of `activeLots` / `activeCount` / `state` is a
 *       projection of the *current* global lot list through that owned
 *       set, so the invariant
 *           "every lot present in the session's state also exists globally"
 *       holds by construction — a stale id can never leak into a view;
 *     - `Lot.active` is no longer read or written by game logic; it is
 *       retained on the interface during migration as an inert field.
 *
 *   Because participation lives here, mutations to the current game are
 *   expressed as explicit operations on this object rather than as side
 *   effects of mutating `Lot.active`. That removes the "remember to sync"
 *   hazard without reintroducing a `syncGameSession()`-style call: `App`
 *   orchestrates the two independent operations (global lot mutation via
 *   `LotManager`, participation mutation via `GameSession`) at each call
 *   site, and the session never caches a snapshot of the global list.
 */
export class GameSession {
    private currentMode: GameMode;
    private readonly getLots: () => readonly Lot[];

    /**
     * Participation state of the current game: the ids of the lots taking
     * part in this session. Owned solely by this class (Stage 3 §2 / §4).
     */
    private activeLotIds: Set<string>;

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
        // A freshly created session starts with every existing lot
        // participating. (In the running app the session is constructed
        // before any lot exists, so this is effectively an empty set.)
        this.activeLotIds = new Set(getLots().map(lot => lot.id));
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
     *
     * Derived on every read by projecting the *current* global list through
     * the session-owned `activeLotIds`, which guarantees that the returned
     * lots always exist in `LotManager` (Stage 3 §7 invariant).
     */
    get activeLots(): Lot[] {
        return this.getLots().filter(lot => this.activeLotIds.has(lot.id));
    }

    /** Number of lots currently participating in this session. */
    get activeCount(): number {
        return this.activeLots.length;
    }

    /**
     * Snapshot of the current game state (all lots + active lots), passed
     * to a mode's roll-processing logic (`GameMode.processRoll`).
     *
     * Both fields are taken from a single read of the accessor so the two
     * lists are always mutually consistent.
     */
    get state(): GameState {
        const all: Lot[] = [...this.getLots()];
        return {
            allLots: all,
            activeLots: all.filter(lot => this.activeLotIds.has(lot.id))
        };
    }

    // ---------------------------------------------------------------
    // Participation queries
    // ---------------------------------------------------------------

    /**
     * Whether the given lot currently participates in this session.
     * UI code uses this to render the participation state, since `Lot.active`
     * is no longer authoritative (Stage 3 §12).
     */
    isActive(lotId: string): boolean {
        return this.activeLotIds.has(lotId);
    }

    // ---------------------------------------------------------------
    // Participation mutations (explicit — never implicit getters)
    // ---------------------------------------------------------------

    /**
     * Registers a newly created lot as participating in this session.
     * Called by `App` right after a successful `LotManager.addLot`.
     */
    addLot(lot: Lot): void {
        this.activeLotIds.add(lot.id);
    }

    /**
     * Removes a lot from this session's participation set.
     * Called by `App` right after a successful `LotManager.deleteLot`, so
     * the session never holds a reference to a globally absent lot
     * (Stage 3 §7).
     */
    removeLot(lotId: string): void {
        this.activeLotIds.delete(lotId);
    }

    /**
     * Deactivates several lots in this session (e.g. the eliminations
     * produced by `GameMode.processRoll`).
     */
    deactivateMany(ids: readonly string[]): void {
        for (const id of ids) {
            this.activeLotIds.delete(id);
        }
    }

    /**
     * Empties the session's participation set.
     * Called by `App` right after `LotManager.clearAll`, keeping the
     * session consistent with the (now empty) global lot list.
     */
    clearLots(): void {
        this.activeLotIds.clear();
    }

    /**
     * Resets the *current game* (Stage 3 §14): every lot currently present
     * in the global list becomes an active participant again.
     *
     * Note: this is distinct from any global-lot reset performed on
     * `LotManager`. `App` orchestrates both when the UI "Reset" button is
     * pressed; the two operations are not merged into a single method here.
     */
    reset(): void {
        this.activeLotIds = new Set(this.getLots().map(lot => lot.id));
    }

    /**
     * Reconciles the session's participation set with the global lot list
     * after a *bulk* mutation (currently: import — Stage 3 §6).
     *
     * Rules:
     *   - a lot that existed before the mutation AND still exists keeps its
     *     previous participation state (this preserves the "deactivated lots
     *     stay deactivated" behaviour of `MERGE_STRATEGY`);
     *   - a lot that exists only *after* the mutation (i.e. was created by
     *     it) becomes an active participant (`REPLACE_STRATEGY` recreates
     *     every lot with a new id, so after a replace all lots are active;
     *     `MERGE_STRATEGY`'s new entries likewise join as active);
     *   - a lot that no longer exists globally is dropped from the set.
     *
     * @param previousIds Snapshot of the global lot ids taken immediately
     *                    *before* the bulk mutation. The diff against the
     *                    current list is what drives the rules above.
     */
    reconcileAfterBulkChange(previousIds: ReadonlySet<string>): void {
        const currentIds = new Set(this.getLots().map(lot => lot.id));

        // Drop stale entries whose lots no longer exist globally.
        for (const id of Array.from(this.activeLotIds)) {
            if (!currentIds.has(id)) {
                this.activeLotIds.delete(id);
            }
        }

        // Activate lots that were created by the bulk mutation.
        for (const id of currentIds) {
            if (!previousIds.has(id)) {
                this.activeLotIds.add(id);
            }
        }
    }

    // ---------------------------------------------------------------
    // Mode
    // ---------------------------------------------------------------

    /**
     * Switches the mode governing this session.
     *
     * This is the single, authoritative point of mode change (§2 / §3 of the
     * plan). `App` never assigns `settings.modeId` to drive the session — it
     * calls `setMode()` here and mirrors the value into `settings.modeId`
     * purely as a UI / persistence record.
     *
     * Mode switches deliberately preserve the current participation set:
     * the new rules apply to the current participants rather than resetting
     * them (matches the behaviour shipped in Stage 1/2 — §13 of the plan
     * explicitly preserves this behaviour).
     */
    setMode(modeId: Mode): void {
        this.currentMode = getMode(modeId);
    }
}
