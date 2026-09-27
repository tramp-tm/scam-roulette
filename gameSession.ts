import type { GameMode, GameState, Lot, Mode, PendingSpin, PrepareSpinResult, RollResult } from './types.js';
import { getMode } from './modes.js';
import { RouletteEngine } from './rouletteEngine.js';

/**
 * Represents the current game session: the active game mode paired with the
 * session-owned participation state for the current game.
 *
 * Layer position (after the Stage 3–4 refactor):
 *
 *     App ──► GameSession ──► GameMode
 *               │
 *               └──► LotManager (read-only accessor for the global lot list)
 *
 * Responsibilities:
 *   - own the current GameMode (the rules that govern this session);
 *   - own the participation state of the current game (which lots take part
 *     in the current session);
 *   - own the spin lifecycle (Stage 4): prepare the roll, decide the result
 *     before animation, apply the mode's state transitions on completion;
 *   - own the *session* and *spin-time* lifecycle locks (Sub-stage A): the
 *     session becomes locked on the first successful `prepareSpin()` and
 *     stays locked until `reset()`; a separate spin-time lock is held only
 *     while the animation/turn is in flight;
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
 *     - Stage 5 removed the transitional `Lot.active` field entirely;
 *       `activeLotIds` is the only participation state.
 *
 *   Because participation lives here, mutations to the current game are
 *   expressed as explicit operations on this object rather than as side
 *   effects of mutating `Lot.active`. That removes the "remember to sync"
 *   hazard without reintroducing a `syncGameSession()`-style call: `App`
 *   orchestrates the two independent operations (global lot mutation via
 *   `LotManager`, participation mutation via `GameSession`) at each call
 *   site, and the session never caches a snapshot of the global list.
 *
 * Spin lifecycle (Stage 4, refac4.md):
 *
 *   Stage 3 left the turn lifecycle in `App`: `App` called
 *   `RouletteEngine.roll(...)`, then `GameMode.processRoll(...)`, then
 *   interpreted the `RollResult` and applied `GameSession.deactivateMany(...)`.
 *   That meant `App` still knew the shape of the rules.
 *
 *   Stage 4 moves the lifecycle here:
 *
 *     - `prepareSpin()` validates, rolls (via `RouletteEngine.roll`) and
 *       stores the pending rolled lot — the winner is decided *before* the
 *       animation (§3–§5 of the plan);
 *     - `finishSpin()` re-reads that stored lot, asks the current mode to
 *       `processRoll`, applies the resulting eliminations internally and
 *       returns the outcome for UI. `App` never mutates game state itself
 *       (§6, §11). `GameMode` stays the sole owner of the rules (§7).
 *
 * Decision-time mode pinning (planB, planB_exec.md):
 *
 *   The pending context carries both the rolled lot *and* the `GameMode`
 *   instance that produced it. `prepareSpin()` captures `this.currentMode`
 *   once, before the roll, and stores it on `pendingSpin.mode`;
 *   `finishSpin()` consumes that pinned mode — never `this.currentMode` —
 *   so a turn's outcome cannot drift if the session mode ever changed
 *   between the two calls. `modes.ts` holds one stateless singleton per
 *   `Mode`, so the pinned instance is stable and identity-comparable.
 *
 * Lifecycle locks (Sub-stage A, planA.md):
 *
 *   Two distinct concepts are tracked here, never conflated into one
 *   ambiguous flag:
 *
 *     - the **session lock** — set on the first successful `prepareSpin()`,
 *       cleared only by `reset()`. While it is held, session-level
 *       mutations (participation, mode, bulk reconciliation) are rejected
 *       at the state boundary, not merely hidden in the UI.
 *     - the **spin-time lock** — set by the same `prepareSpin()` and
 *       cleared by the matching `finishSpin()`. It is held only while the
 *       animation/turn is in flight; between spins of an unfinished
 *       Survival game it is released, which is what keeps duration and
 *       sorting editable while the round-trip is idle.
 *
 *   `App` derives its DOM `disabled` states from these two read-only
 *   properties; it never stores its own copy.
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
     * Context of the in-progress spin (Stage 4 §5, planB): the decided lot
     * plus the `GameMode` instance that produced it, as captured by
     * `prepareSpin()` and awaited by `finishSpin()`. Cleared by
     * `finishSpin()` and by `reset()` so a stale pending spin context can
     * never be replayed (Stage 4 §12 / §17).
     */
    private pendingSpin: PendingSpin | null = null;

    /**
     * True from the first successful `prepareSpin()` until `reset()`.
     * While set, session-level mutations are rejected at the state
     * boundary (planA.md §2–§4). Never cleared by `finishSpin()`.
     */
    private sessionLocked = false;

    /**
     * True only between a successful `prepareSpin()` and its matching
     * `finishSpin()`. This is the spin-time lock (planA.md §5): duration
     * and sorting are precisely the things it is meant to freeze.
     *
     * Invariant (planA.md A1 §2): `spinInProgress === true` implies
     * `sessionLocked === true` — both are raised by the same successful
     * `prepareSpin()` and only `finishSpin()` releases the spin-time one.
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
     * Session lock state (planA.md §2): true from the first successful
     * `prepareSpin()` until `reset()`. Read-only mirror for the UI.
     */
    get isSessionLocked(): boolean {
        return this.sessionLocked;
    }

    /**
     * Spin-time lock state (planA.md §5): true only while a prepared roll
     * is awaiting its `finishSpin()`. Read-only mirror for the UI.
     */
    get isSpinInProgress(): boolean {
        return this.spinInProgress;
    }

    /**
     * True after a finished `RollResult` until `reset()` (planA.md §5).
     * Read-only mirror for the UI's finished-game lock.
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
     * was removed in Stage 5.
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
     * Rejected while the session lock is held (planA.md §3): once the first
     * spin has started, the participant pool is frozen.
     */
    addLot(lot: Lot): void {
        if (this.sessionLocked) return;
        this.activeLotIds.add(lot.id);
    }

    /**
     * Removes a lot from this session's participation set.
     * Called by `App` right after a successful `LotManager.deleteLot`, so
     * the session never holds a reference to a globally absent lot
     * (Stage 3 §7).
     *
     * Rejected while the session lock is held (planA.md §3).
     */
    removeLot(lotId: string): void {
        if (this.sessionLocked) return;
        this.activeLotIds.delete(lotId);
    }

    /**
     * Deactivates several lots in this session (e.g. the eliminations
     * produced by `GameMode.processRoll`).
     *
     * Deliberately NOT guarded by the session lock: it is invoked from
     * `finishSpin()` while the session is already locked — see planA.md §3.
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
     *
     * Rejected while the session lock is held (planA.md §3).
     */
    clearLots(): void {
        if (this.sessionLocked) return;
        this.activeLotIds.clear();
    }

    /**
     * Resets the *current game* (Stage 3 §14, Sub-stage A §9): every lot
     * currently present in the global list becomes an active participant
     * again, and every lifecycle lock is released.
     *
     * Note: this is distinct from any global-lot reset performed on
     * `LotManager`. `App` orchestrates both when the UI "Reset" button is
     * pressed; the two operations are not merged into a single method here.
     */
    reset(): void {
        // Clear any in-flight spin context so an aborted animation cannot
        // leave a stale pending spin behind (Stage 4 §17).
        this.pendingSpin = null;
        // Release both lifecycle locks and the finished-game state so the
        // next session starts unlocked (planA.md §9).
        this.spinInProgress = false;
        this.sessionLocked = false;
        this.gameFinished = false;
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
     * Rejected while the session lock is held (planA.md §3): import is a
     * session-level configuration operation and must not be able to mutate
     * a started session.
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
    // Spin lifecycle (Stage 4, Sub-stage A §7–§8)
    // ---------------------------------------------------------------

    /**
     * Prepares a spin (Stage 4 §3–§4, Sub-stage A §7): validates, rolls the
     * winning lot with the current mode, stores it as the pending spin
     * context, atomically establishes the session + spin-time locks, and
     * returns the lot so `App` can drive the animation.
     *
     * Returning `{ ok: false, reason }` means the spin cannot proceed
     * (no active lots, a degenerate zero-weight pool, a spin already in
     * flight, or a finished game). On failure, **none** of the lifecycle
     * flags change — the session must not become locked merely because a
     * spin was attempted (planA.md §7; A2 §2).
     *
     * The winner is decided here, *before* any animation starts; the
     * animation only represents the already-decided result (§4).
     *
     * planB: the current mode is captured *once*, before the roll, and
     * stored on the pending context alongside the rolled lot, so the later
     * application in `finishSpin()` cannot drift from the decision.
     */
    prepareSpin(): PrepareSpinResult {
        // A second spin cannot start while one is in flight, nor after the
        // game has finished (planA.md §7 / §8).
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

        // Pin the mode at decision time (planB). Any later change to
        // this.currentMode (there is none today — setMode() rejects while
        // sessionLocked) cannot affect how this turn is applied in
        // finishSpin().
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
     * Finishes the in-progress spin (Stage 4 §6 / §11, Sub-stage A §8):
     * processes the stored rolled lot through the mode pinned by
     * `prepareSpin()` (planB), applies the resulting state transitions
     * (eliminations) to this session, and returns the outcome plus the
     * rolled lot so `App` can update the UI.
     *
     * Guarantees that `activeLots` / `activeCount` / `state` are fully
     * up-to-date upon return — no follow-up sync call from `App` is needed
     * (§11).
     *
     * Returns `null` if there is no pending spin (e.g. a late `onComplete`
     * after `reset()`); the caller treats that as a no-op for UI (§12).
     *
     * The session lock is deliberately kept; only the spin-time lock is
     * released here so a subsequent Survival spin can be prepared and the
     * between-spins settings (duration, sorting) become editable again.
     *
     * Exception safety (A1): the spin-time lock is released in a `finally`
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
        // re-entrant call cannot process the same roll twice (§12).
        this.pendingSpin = null;

        const { rolledLot, mode } = pending;

        // Release the spin-time lock in `finally` so a throwing
        // `processRoll()` cannot leave the session stuck "spinning". The
        // session lock is deliberately preserved: the session has been
        // started and only Reset can unlock it. Any exception propagates
        // to `App.finishSpin()` — it is NOT swallowed here.
        try {
            // planB: the pinned mode governs this turn — the same instance
            // that produced the roll in prepareSpin().
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
     *
     * Rejected while the session lock is held (planA.md §14): the mode is
     * immutable after the session has started.
     */
    setMode(modeId: Mode): void {
        if (this.sessionLocked) return;
        this.currentMode = getMode(modeId);
    }
}
