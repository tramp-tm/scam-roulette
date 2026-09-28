import type { GameMode, GameState, Lot, Mode, PendingSpin, PrepareSpinResult, RollResult } from './types.js';
import { getMode } from './modes.js';
import { RouletteEngine } from './rouletteEngine.js';

/**
 * Represents the current game session: the active game mode plus the
 * session-owned participation state for the current game.
 *
 * Responsibilities
 * - own the current GameMode (the rules that govern this session);
 * - own the participation state (`activeLotIds`) of the current game;
 * - own the spin lifecycle — decide the result in `prepareSpin()`, apply
 *   the mode's transitions in `finishSpin()`;
 * - own the session- and spin-time lifecycle locks;
 * - expose a single authoritative point of mode change (`setMode()`);
 * - expose explicit mutation operations (`addLot`, `removeLot`,
 *   `clearLots`, `reset`, `reconcileAfterBulkChange`).
 *
 * Non-responsibilities
 * - game rules            → GameMode (NormalMode / SurvivalMode)
 * - roulette mechanics    → RouletteEngine
 * - lot CRUD / storage    → LotManager
 * - UI / Canvas / animation
 *
 * Ownership invariants
 * - `activeLotIds` is the only participation state; every read of
 *   `activeLots` / `activeCount` / `state` is a projection of the current
 *   global list through that set, so a stale id can never leak into a view
 *   and the session never caches a snapshot.
 *
 * Spin lifecycle
 * - `prepareSpin()` validates, rolls via `RouletteEngine.roll`, stores the
 *   pending spin context (`rolledLot` + pinned `GameMode`), and atomically
 *   raises both lifecycle locks.
 * - `finishSpin()` consumes the pinned mode, applies eliminations, and
 *   returns the outcome for UI. `App` never mutates game state itself.
 *
 * Locks
 * - `sessionLocked` — set on the first successful `prepareSpin()`, cleared
 *   only by `reset()`; session-level mutations (participation, mode, bulk
 *   reconciliation) are rejected at the state boundary.
 * - `spinInProgress` — set/cleared by the spin pair; released between spins
 *   of an unfinished Survival game.
 * - `gameFinished` — set when a result is `finished`; cleared only by
 *   `reset()`.
 *
 * `App` derives its DOM `disabled` states from these three read-only
 * properties; it never stores its own copy.
 */
export class GameSession {
    private currentMode: GameMode;
    private readonly getLots: () => readonly Lot[];

    /**
     * Participation state of the current game: the ids of the lots taking
     * part in this session. Owned solely by this class.
     */
    private activeLotIds: Set<string>;

    /**
     * Context of the in-progress spin — the decided lot plus the `GameMode`
     * instance that produced it. Cleared by `finishSpin()` and by `reset()`.
     */
    private pendingSpin: PendingSpin | null = null;

    /**
     * True from the first successful `prepareSpin()` until `reset()`. While
     * set, session-level mutations are rejected at the state boundary.
     */
    private sessionLocked = false;

    /**
     * True only between a successful `prepareSpin()` and its matching
     * `finishSpin()`. Implies `sessionLocked === true`.
     */
    private spinInProgress = false;

    /**
     * True after a `RollResult` with `finished === true` has been applied,
     * until `reset()`. Drives the finished-game UI lock; the winner is
     * frozen and only Reset can start a new session.
     */
    private gameFinished = false;

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
     * Session lock state: true from the first successful `prepareSpin()`
     * until `reset()`. Read-only mirror for the UI.
     */
    get isSessionLocked(): boolean {
        return this.sessionLocked;
    }

    /**
     * Spin-time lock state: true only while a prepared roll is awaiting its
     * `finishSpin()`. Read-only mirror for the UI.
     */
    get isSpinInProgress(): boolean {
        return this.spinInProgress;
    }

    /**
     * True after a finished `RollResult` until `reset()`.
     * Read-only mirror for the UI.
     */
    get isGameFinished(): boolean {
        return this.gameFinished;
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
     * Derived on every read by projecting the current global list through
     * `activeLotIds`, so the returned lots always exist in `LotManager`.
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
     * Whether the given lot currently participates in this session. Used by
     * the UI to render the participation state.
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
     *
     * Rejected while the session lock is held — once the first spin has
     * started, the participant pool is frozen.
     */
    addLot(lot: Lot): void {
        if (this.sessionLocked) return;
        this.activeLotIds.add(lot.id);
    }

    /**
     * Removes a lot from this session's participation set.
     * Called by `App` right after a successful `LotManager.deleteLot`, so
     * the session never holds a reference to a globally absent lot.
     *
     * Rejected while the session lock is held.
     */
    removeLot(lotId: string): void {
        if (this.sessionLocked) return;
        this.activeLotIds.delete(lotId);
    }

    /**
     * Deactivates several lots in this session (e.g. the eliminations produced
     * by `GameMode.processRoll`).
     *
     * Private: the only legal caller is `finishSpin()`, which runs inside the
     * session-lock lifetime and therefore must be able to mutate participation
     * while the session is locked. Keeping the method private preserves that
     * exception without exposing an unguarded way for outside code to bypass
     * the session lock.
     */
    private deactivateMany(ids: readonly string[]): void {
        for (const id of ids) {
            this.activeLotIds.delete(id);
        }
    }

    /**
     * Empties the session's participation set.
     * Called by `App` right after `LotManager.clearAll`, keeping the
     * session consistent with the (now empty) global lot list.
     *
     * Rejected while the session lock is held.
     */
    clearLots(): void {
        if (this.sessionLocked) return;
        this.activeLotIds.clear();
    }

    /**
     * Resets the current game: every lot currently in the global list becomes
     * an active participant again, the pending spin context is cleared, and
     * every lifecycle lock is released.
     *
     * Note: this is distinct from any global-lot reset performed on
     * `LotManager`. `App` orchestrates both when the UI "Reset" button is
     * pressed; the two operations are not merged into a single method here.
     */
    reset(): void {
        // Clear any in-flight spin context so an aborted animation cannot
        // leave a stale pending spin behind.
        this.pendingSpin = null;
        // Release both lifecycle locks and the finished-game state so the
        // next session starts unlocked.
        this.spinInProgress = false;
        this.sessionLocked = false;
        this.gameFinished = false;
        this.activeLotIds = new Set(this.getLots().map(lot => lot.id));
    }

    /**
     * Reconciles the session's participation set with the global lot list
     * after a *bulk* mutation (currently: import).
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
     * Rejected while the session lock is held: import is a session-level
     * configuration operation and must not be able to mutate a started
     * session.
     *
     * @param previousIds Snapshot of the global lot ids taken immediately
     *                    *before* the bulk mutation. The diff against the
     *                    current list is what drives the rules above.
     */
    reconcileAfterBulkChange(previousIds: ReadonlySet<string>): void {
        if (this.sessionLocked) return;

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
    // Spin lifecycle
    // ---------------------------------------------------------------

    /**
     * Validates, rolls the winning lot with the current mode, stores the
     * pinned pending context, atomically establishes both lifecycle locks,
     * and returns the lot for the animation.
     *
     * Returning `{ ok: false, reason }` means the spin cannot proceed
     * (no active lots, a degenerate zero-weight pool, a spin already in
     * flight, or a finished game). On failure **none** of the lifecycle
     * flags change — the session must not become locked merely because a
     * spin was attempted.
     *
     * The winner is decided here, *before* any animation starts; the
     * animation only represents the already-decided result. The current
     * mode is captured once, before the roll, and pinned on the pending
     * context so the later application in `finishSpin()` cannot drift from
     * the decision.
     */
    prepareSpin(): PrepareSpinResult {
        // A second spin cannot start while one is in flight, nor after the
        // game has finished.
        if (this.spinInProgress) {
            return { ok: false, reason: 'spinInProgress' };
        }
        if (this.gameFinished) {
            return { ok: false, reason: 'gameFinished' };
        }

        const active = this.activeLots;
        if (!RouletteEngine.canSpin(active)) {
            return { ok: false, reason: 'noActiveLots' };
        }

        // Pin the mode at decision time. Any later change to this.currentMode
        // (there is none today — setMode() rejects while sessionLocked) cannot
        // affect how this turn is applied in finishSpin().
        const modeAtDecision = this.currentMode;

        const rolledLot = RouletteEngine.roll(active, modeAtDecision);
        if (!rolledLot) {
            return { ok: false, reason: 'noValidWeights' };
        }

        // Success — establish both locks atomically from the caller's
        // point of view and store the pinned spin context.
        // `sessionLocked` persists until reset(); the spin-time lock is
        // released in finishSpin().
        this.pendingSpin = { rolledLot, mode: modeAtDecision };
        this.sessionLocked = true;
        this.spinInProgress = true;
        return { ok: true, lot: rolledLot };
    }

    /**
     * Finishes the in-progress spin: processes the stored rolled lot through
     * the pinned mode, applies eliminations to the session, returns the
     * outcome plus the rolled lot for UI. Returns `null` when there is no
     * pending spin.
     *
     * Guarantees that `activeLots` / `activeCount` / `state` are fully
     * up-to-date upon return — no follow-up sync call from `App` is needed.
     *
     * The session lock is deliberately kept; only the spin-time lock is
     * released here so a subsequent Survival spin can be prepared and the
     * between-spins settings (duration, sorting) become editable again.
     *
     * Exception safety: the spin-time lock is released in a `finally`
     * block, so a throwing `processRoll()` cannot leave the session stuck
     * "spinning". The session lock and `gameFinished` are left untouched on
     * the exception path — the session has been started and only `reset()`
     * can unlock it. The exception propagates to the caller (`App`), which
     * surfaces it to the user; it is not swallowed here.
     */
    finishSpin(): { rolledLot: Lot; result: RollResult } | null {
        const pending = this.pendingSpin;
        if (!pending) {
            return null;
        }

        // Null the pending context *before* applying the transition so a
        // re-entrant call cannot process the same roll twice.
        this.pendingSpin = null;

        const { rolledLot, mode } = pending;

        // Release the spin-time lock in `finally` so a throwing
        // `processRoll()` cannot leave the session stuck "spinning". The
        // session lock is deliberately preserved: the session has been
        // started and only Reset can unlock it. Any exception propagates
        // to `App.finishSpin()` — it is NOT swallowed here.
        try {
            // The pinned mode governs this turn — the same instance that
            // produced the roll in prepareSpin().
            const result = mode.processRoll(rolledLot, this.state);
            if (result.deactivate.length > 0) {
                this.deactivateMany(result.deactivate);
            }
            if (result.finished) {
                this.gameFinished = true;
            }
            return { rolledLot, result };
        } finally {
            this.spinInProgress = false;
        }
    }

    // ---------------------------------------------------------------
    // Mode
    // ---------------------------------------------------------------

    /**
     * Switches the mode governing this session. Single authoritative point
     * of mode change; `App` mirrors the value into `settings.modeId` for UI
     * only.
     *
     * Mode switches deliberately preserve the current participation set:
     * the new rules apply to the current participants rather than resetting
     * them.
     *
     * Rejected while the session lock is held — the mode is immutable after
     * the session has started.
     */
    setMode(modeId: Mode): void {
        if (this.sessionLocked) return;
        this.currentMode = getMode(modeId);
    }
}
