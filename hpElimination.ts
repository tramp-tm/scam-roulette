import type { GameModeState, GameParticipantState, Lot } from './types.js';

/**
 * Shared pipeline for the HP-elimination modes (`crown-defense-half-test`,
 * `weakest-link`, `king-of-the-hill-amount`): every active participant has HP;
 * a turn deals damage; HP 0 ⇒ elimination; the last one standing wins.
 *
 * Each mode's `processRoll` runs the same seven steps — only the damage rule and
 * the choice of target (and, in king of the hill, which lot is "the king") are
 * mode-specific. Those seven steps live here so a change to a shared step is
 * made once; the mode keeps only its delta.
 *
 * Pure and deterministic: no DOM, no i18n, no `Math.random()` — randomness
 * (which lot is king / which weakest lot is destroyed) stays in the modes.
 */

/**
 * The per-participant state shape every HP mode stores: the participant's
 * current HP, `null` until first materialized (the initial value is derived
 * lazily from the mode's own HP source).
 */
export interface HpParticipantState {
    hp: number | null;
}

/**
 * Narrows the opaque `GameModeState` to a mode's own state type. The core stores
 * it opaquely, so only the owning mode can name its shape — this is the single
 * cast helper every stateful mode uses.
 */
export function castState<T>(state: GameModeState): T {
    return state as T;
}

/**
 * Current HP of one participant, deriving the initial value on first read (the
 * lazy idiom shared by all three modes).
 *
 * `initialHpOf` is the mode's HP source and the ONLY thing that differs between
 * them: the raw `amount` (`crown-defense-half-test`), the min–max normalized map
 * (`weakest-link`), `ceil(amount)` (`king-of-the-hill-amount`).
 */
export function participantHp(
    lot: Lot,
    participant: GameParticipantState,
    initialHpOf: (lot: Lot) => number
): number {
    const ps = participant.modeState as HpParticipantState;
    if (typeof ps.hp === 'number') return ps.hp;
    return initialHpOf(lot);
}

/**
 * Step 1 of a turn: the HP of every participant BEFORE this turn's damage,
 * keyed by lot id. Computed up front so no participant's damage depends on
 * another's outcome. A participant whose lot is missing counts as 0 HP.
 */
export function collectHp(
    participants: readonly GameParticipantState[],
    lotById: ReadonlyMap<string, Lot>,
    readHp: (lot: Lot, participant: GameParticipantState) => number
): Map<string, number> {
    const hp = new Map<string, number>();
    for (const p of participants) {
        const lot = lotById.get(p.lotId);
        hp.set(p.lotId, lot ? readHp(lot, p) : 0);
    }
    return hp;
}

/**
 * Step 4 of a turn: the ids of ACTIVE participants whose HP reached 0 (≤ 0), in
 * participant order.
 */
export function computeEliminated(
    participants: readonly GameParticipantState[],
    hpAfter: ReadonlyMap<string, number>
): string[] {
    const eliminated: string[] = [];
    for (const p of participants) {
        if (p.active && (hpAfter.get(p.lotId) ?? 0) <= 0) eliminated.push(p.lotId);
    }
    return eliminated;
}

/**
 * Step 6 of a turn: the ids of active participants whose HP actually changed.
 *
 * The two behaviours below are BOTH intentional — do not unify them:
 *  - `includeEliminated: true` — `crown-defense-half-test` and `weakest-link`
 *    report a participant damaged down to 0 as "changed" (the elimination is
 *    part of the turn's visible effect);
 *  - `includeEliminated: false` — `king-of-the-hill-amount` reports only the
 *    surviving actors (its eliminated lots are carried by `outcome.eliminated`
 *    instead and must not also appear as changed).
 */
export function computeChanged(
    participants: readonly GameParticipantState[],
    hpBefore: ReadonlyMap<string, number>,
    hpAfter: ReadonlyMap<string, number>,
    options: { includeEliminated: boolean }
): string[] {
    const changed: string[] = [];
    for (const p of participants) {
        if (!p.active) continue;
        const before = hpBefore.get(p.lotId) ?? 0;
        const after = hpAfter.get(p.lotId) ?? 0;
        if (!options.includeEliminated && after <= 0) continue;
        if (after !== before) changed.push(p.lotId);
    }
    return changed;
}

/**
 * Step 5 of a turn: new participant records with the HP materialized (from
 * `hpAfter`) and eliminations applied to `active`.
 */
export function materializeParticipants(
    participants: readonly GameParticipantState[],
    hpAfter: ReadonlyMap<string, number>,
    eliminatedSet: ReadonlySet<string>
): GameParticipantState[] {
    return participants.map(p => {
        const next: HpParticipantState = { hp: hpAfter.get(p.lotId) ?? 0 };
        return {
            lotId: p.lotId,
            active: p.active && !eliminatedSet.has(p.lotId),
            modeState: next
        };
    });
}

/**
 * Deterministic winner of the defensive no-survivors case: the participant with
 * the highest HP after the turn; ties broken by participant order.
 */
function highestHpId(
    participants: readonly GameParticipantState[],
    hpAfter: ReadonlyMap<string, number>
): string {
    let bestId = participants[0].lotId;
    let bestHp = -Infinity;
    for (const p of participants) {
        const hp = hpAfter.get(p.lotId) ?? 0;
        if (hp > bestHp) {
            bestHp = hp;
            bestId = p.lotId;
        }
    }
    return bestId;
}

/**
 * Step 7 of a turn: the winner and whether the game is over.
 *
 *  - exactly one active participant left → it is the winner, `finished`;
 *  - more than one → the game continues (`winners` empty);
 *  - NONE left — the defensive "no survivors" case. Reachable only in
 *    `weakest-link` (a single active lot is rolled, takes its own HP as damage
 *    and is eliminated); kept total and deterministic for the other two modes —
 *    the participant with the highest HP after the turn wins, ties broken by
 *    participant order (see `highestHpId`).
 *
 * Pass the MATERIALIZED participant list (`materializeParticipants` output): the
 * scan reads only `lotId` and the shared `hpAfter` map, so its order matches the
 * pre-turn `participants` order.
 */
export function resolveSurvivors(
    participants: readonly GameParticipantState[],
    hpAfter: ReadonlyMap<string, number>
): { winners: string[]; finished: boolean } {
    const remaining = participants.filter(p => p.active);
    if (remaining.length === 1) return { winners: [remaining[0].lotId], finished: true };
    if (remaining.length > 1) return { winners: [], finished: false };
    return { winners: [highestHpId(participants, hpAfter)], finished: true };
}
