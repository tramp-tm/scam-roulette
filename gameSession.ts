import type {
    GameMode,
    GameModeState,
    GameParticipantState,
    GameViewState,
    Lot,
    Mode,
    RenderableParticipant,
    SelectionCandidate,
    TurnOutcome,
    VisualizationTransition
} from './types.js';
import { getMode } from './modes.js';
import { RouletteEngine } from './rouletteEngine.js';

/**
 * Reasons `GameSession.prepareSpin()` can refuse a spin. Exactly the four
 * current failure branches — no hypothetical states.
 */
export type PrepareSpinFailureReason =
    | 'spinInProgress'
    | 'gameFinished'
    | 'noActiveLots'
    | 'noValidWeights';

/**
 * Result of `GameSession.prepareSpin()`. The failure reason lets the caller
 * surface an accurate message.
 */
export type PrepareSpinResult =
    | { ok: true; lot: Lot }
    | { ok: false; reason: PrepareSpinFailureReason };

/**
 * Context of the in-progress spin: the decided lot, the pinned mode, and the
 * full "before" snapshot needed to build the state transition once the spin
 * animation reaches its target.
 */
interface PendingSpin {
    rolledLot: Lot;
    rolledParticipant: GameParticipantState;
    mode: GameMode;
    participantsBefore: GameParticipantState[];
    stateBefore: GameModeState;
    viewBefore: GameViewState;
}

/** What `finishSpin()` hands back to the caller (App). */
export interface FinishSpinResult {
    rolledLot: Lot;
    outcome: TurnOutcome;
    /** before/after views + outcome, for the visualization layer. */
    transition: VisualizationTransition;
    /** The stable post-turn view state. */
    after: GameViewState;
}

/**
 * Session state for the current game.
 *
 * Responsibilities
 *  - own the current GameMode (the rules that govern this session);
 *  - own the participant set (`GameParticipantState[]`: lotId + active +
 *    mode-owned state) and the game-level mode state;
 *  - own the spin lifecycle — decide in `prepareSpin()`, apply the mode's
 *    pure transition in `finishSpin()`;
 *  - own the session- and spin-time lifecycle locks;
 *  - expose a single authoritative point of mode change (`setMode()`);
 *  - expose explicit participation mutations (`addLot`, `removeLot`,
 *    `clearLots`, `reconcileAfterBulkChange`, `reset`).
 *
 * Non-responsibilities
 *  - game rules / mode state semantics → GameMode
 *  - roulette mechanics                   → RouletteEngine
 *  - lot CRUD / storage                   → LotManager
 *  - UI / Canvas / animation              → App + VisualizationDriver
 *
 * The session stores `modeState` / per-participant `modeState` opaquely and
 * only ever touches them through the owning GameMode.
 */
export class GameSession {
    private currentMode: GameMode;
    private readonly getLots: () => readonly Lot[];

    /** Participation + per-participant mode state, keyed implicitly by lot id. */
    private participants: GameParticipantState[];

    /** Game-level state, owned by `currentMode`. */
    private modeState: GameModeState;

    private pendingSpin: PendingSpin | null = null;

    /** True from the first successful `prepareSpin()` until `reset()`. */
    private sessionLocked = false;

    /** True only between a successful `prepareSpin()` and its matching `finishSpin()`. */
    private spinInProgress = false;

    /** True after an outcome with `finished === true`, until `reset()`. */
    private gameFinished = false;

    constructor(modeId: Mode, getLots: () => readonly Lot[]) {
        this.currentMode = getMode(modeId);
        this.getLots = getLots;
        this.participants = this.getLots().map(lot => this.newParticipant(lot));
        this.modeState = this.currentMode.createGameState(this.getLots());
    }

    // ---------------------------------------------------------------
    // Read-only projections
    // ---------------------------------------------------------------

    /** The mode currently governing this session. */
    get mode(): GameMode {
        return this.currentMode;
    }

    get isSessionLocked(): boolean { return this.sessionLocked; }
    get isSpinInProgress(): boolean { return this.spinInProgress; }
    get isGameFinished(): boolean { return this.gameFinished; }

    /** All lots in the global list. */
    get allLots(): readonly Lot[] {
        return this.getLots();
    }

    /** Lots currently participating in the session. */
    get activeLots(): Lot[] {
        const byId = this.lotIndex();
        const result: Lot[] = [];
        for (const p of this.participants) {
            if (!p.active) continue;
            const lot = byId.get(p.lotId);
            if (lot) result.push(lot);
        }
        return result;
    }

    /** Number of lots currently participating in this session. */
    get activeCount(): number {
        let n = 0;
        for (const p of this.participants) if (p.active) n++;
        return n;
    }

    /** Whether the given lot currently participates in this session. */
    isActive(lotId: string): boolean {
        const p = this.participants.find(x => x.lotId === lotId);
        return p ? p.active : false;
    }

    /**
     * Immutable presentation snapshot of the current stable state. Selection
     * weights and per-participant presentation values/data are computed by the
     * mode; the core never interprets them.
     */
    get viewState(): GameViewState {
        return this.buildViewState(this.participants, this.modeState);
    }

    // ---------------------------------------------------------------
    // Participation mutations (explicit — never implicit getters)
    // ---------------------------------------------------------------

    /** Registers a newly created lot as a participant. Rejected while locked. */
    addLot(lot: Lot): void {
        if (this.sessionLocked) return;
        this.participants = [...this.participants, this.newParticipant(lot)];
        this.modeState = this.currentMode.onParticipantsChanged(this.modeState, this.participants, this.getLots());
    }

    /** Removes a lot from participation. Rejected while locked. */
    removeLot(lotId: string): void {
        if (this.sessionLocked) return;
        this.participants = this.participants.filter(p => p.lotId !== lotId);
        this.modeState = this.currentMode.onParticipantsChanged(this.modeState, this.participants, this.getLots());
    }

    /** Empties participation. Rejected while locked. */
    clearLots(): void {
        if (this.sessionLocked) return;
        this.participants = [];
        this.modeState = this.currentMode.onParticipantsChanged(this.modeState, this.participants, this.getLots());
    }

    /**
     * Reconciles participation with the global list after a bulk mutation
     * (import): kept ids preserve prior participation, new ids join active,
     * stale ids are dropped. Rejected while locked.
     */
    reconcileAfterBulkChange(previousIds: ReadonlySet<string>): void {
        if (this.sessionLocked) return;

        const previousActive = new Map(this.participants.map(p => [p.lotId, p.active]));
        const previousModeState = new Map(this.participants.map(p => [p.lotId, p.modeState]));

        this.participants = this.getLots().map(lot => {
            const existedBefore = previousIds.has(lot.id);
            const active = existedBefore ? (previousActive.get(lot.id) ?? true) : true;
            const modeState = previousModeState.get(lot.id) ?? this.currentMode.createParticipantState(lot);
            return { lotId: lot.id, active, modeState };
        });

        this.modeState = this.currentMode.onParticipantsChanged(this.modeState, this.participants, this.getLots());
    }

    /**
     * Resets the current game: every lot currently in the global list becomes
     * an active participant again, pending spin context is cleared, mode state
     * is recreated, and every lifecycle lock is released.
     */
    reset(): void {
        this.pendingSpin = null;
        this.spinInProgress = false;
        this.sessionLocked = false;
        this.gameFinished = false;
        this.participants = this.getLots().map(lot => this.newParticipant(lot));
        this.modeState = this.currentMode.createGameState(this.getLots());
    }

    /**
     * Switches the mode governing this session. Single authoritative point of
     * mode change. Participation is preserved; the new mode gets freshly
     * created state for the current participants. Rejected while locked.
     */
    setMode(modeId: Mode): void {
        if (this.sessionLocked) return;

        this.currentMode = getMode(modeId);

        const byId = this.lotIndex();
        this.participants = this.participants.map(p => {
            const lot = byId.get(p.lotId);
            return {
                lotId: p.lotId,
                active: p.active,
                modeState: lot ? this.currentMode.createParticipantState(lot) : p.modeState
            };
        });
        this.modeState = this.currentMode.createGameState(this.getLots());
        this.modeState = this.currentMode.onParticipantsChanged(this.modeState, this.participants, this.getLots());
    }

    // ---------------------------------------------------------------
    // Spin lifecycle
    // ---------------------------------------------------------------

    /**
     * Validates, rolls the winning lot with the current mode, stores the
     * pinned pending context + "before" snapshot, atomically establishes both
     * lifecycle locks, and returns the lot for the animation.
     *
     * Returning `{ ok: false, reason }` leaves **all** lifecycle flags and the
     * pending context untouched.
     */
    prepareSpin(): PrepareSpinResult {
        if (this.spinInProgress) return { ok: false, reason: 'spinInProgress' };
        if (this.gameFinished) return { ok: false, reason: 'gameFinished' };

        const activeParticipants = this.participants.filter(p => p.active);
        if (!RouletteEngine.canSpin(activeParticipants.length)) {
            return { ok: false, reason: 'noActiveLots' };
        }

        const byId = this.lotIndex();
        const candidates: { participant: GameParticipantState; lot: Lot; selectionWeight: number }[] = [];
        for (const p of activeParticipants) {
            const lot = byId.get(p.lotId);
            if (!lot) continue;
            candidates.push({
                participant: p,
                lot,
                selectionWeight: this.currentMode.calculateSelectionWeight(lot, p, this.modeState)
            });
        }

        const entries: SelectionCandidate[] = candidates.map(c => ({
            lot: c.lot,
            selectionWeight: c.selectionWeight
        }));
        const rolled = RouletteEngine.rollWeighted(entries);
        if (!rolled) return { ok: false, reason: 'noValidWeights' };

        const chosen = candidates.find(c => c.lot.id === rolled.lot.id)!;
        const modeAtDecision = this.currentMode;

        // Pin the mode + full "before" snapshot at decision time.
        this.pendingSpin = {
            rolledLot: chosen.lot,
            rolledParticipant: chosen.participant,
            mode: modeAtDecision,
            participantsBefore: [...this.participants],
            stateBefore: this.modeState,
            viewBefore: this.buildViewState(this.participants, this.modeState)
        };

        this.sessionLocked = true;
        this.spinInProgress = true;
        return { ok: true, lot: chosen.lot };
    }

    /**
     * Finishes the in-progress spin: applies the pinned mode's pure transition
     * to the pinned "before" state, stores the new state, and returns the
     * outcome plus the before/after transition for the visualization. Returns
     * `null` when there is no pending spin.
     *
     * Exception safety: the spin-time lock is released in `finally`; the
     * session lock and `gameFinished` are left untouched on the exception path
     * (only `reset()` can unlock). The exception propagates to the caller.
     */
    finishSpin(): FinishSpinResult | null {
        const pending = this.pendingSpin;
        if (!pending) return null;

        // Null the context *before* applying the transition so a re-entrant
        // call cannot process the same roll twice.
        this.pendingSpin = null;

        const { rolledLot, rolledParticipant, mode, participantsBefore, stateBefore, viewBefore } = pending;

        try {
            const { state, participants, outcome } = mode.processRoll(
                rolledLot,
                rolledParticipant,
                participantsBefore,
                this.getLots(),
                stateBefore
            );

            this.modeState = state;
            this.participants = participants;
            if (outcome.finished) this.gameFinished = true;

            const after = this.buildViewState(this.participants, this.modeState);

            return {
                rolledLot,
                outcome,
                transition: { before: viewBefore, after, outcome, rolledLotId: rolledLot.id },
                after
            };
        } finally {
            this.spinInProgress = false;
        }
    }

    // ---------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------

    private newParticipant(lot: Lot): GameParticipantState {
        return { lotId: lot.id, active: true, modeState: this.currentMode.createParticipantState(lot) };
    }

    private lotIndex(): Map<string, Lot> {
        const map = new Map<string, Lot>();
        for (const lot of this.getLots()) map.set(lot.id, lot);
        return map;
    }

    private buildViewState(
        participants: readonly GameParticipantState[],
        state: GameModeState
    ): GameViewState {
        const byId = this.lotIndex();
        const lots = this.getLots();
        const presentation = this.currentMode.getPresentationData(participants, lots, state);
        const renderables: RenderableParticipant[] = [];

        for (const p of participants) {
            const lot = byId.get(p.lotId);
            if (!lot) continue;

            const selectionWeight = p.active
                ? this.currentMode.calculateSelectionWeight(lot, p, state)
                : 0;
            renderables.push({
                lot,
                active: p.active,
                selectionWeight,
                visualValue: this.currentMode.getParticipantVisualValue(lot, p, state),
                presence: p.active ? 1 : 0,
                modeData: presentation.get(p.lotId)
            });
        }

        return { modeId: this.currentMode.id, participants: renderables };
    }
}
