import type {
    GameMode,
    GameModeState,
    GameParticipantState,
    Lot,
    MessageDescriptor,
    Mode,
    ModePresentationData,
    ParticipantModeState,
    TurnOutcome
} from './types.js';
import { t } from './i18n.js';

/**
 * Weakest Link: HP = amount.
 *
 * A copy of `WeakestLinkMode` with ONE rule changed — where HP comes from:
 *  - a lot's initial HP is its `amount` directly, with NO normalization,
 *    rounded UP to a whole number (`ceil(amount)`); amounts are validated as
 *    positive (≥ 0.01), so every lot starts at HP ≥ 1;
 *  - everything else is identical to `WeakestLinkMode`: equal chances for every
 *    active participant (`selectionWeight = 1`), only the rolled lot takes
 *    damage, and the damage is derived from the lots that are no stronger than
 *    it:
 *      L = active lots other than the rolled one with HP ≤ HP(rolled);
 *      D = HP(rolled)            when L is empty (the rolled is the weakest),
 *      D = ceil(mean(HP over L)) otherwise — always a whole number;
 *  - HP clamps at 0; participants at 0 HP are eliminated; the last one standing
 *    wins.
 *
 * Because every HP is a whole number ≥ 1, the damage is ≥ 1 in both branches,
 * so the game always makes progress and terminates.
 *
 * Presentation:
 *  - `yValue = current HP` — the visualization draws HP as size (it
 *    normalizes magnitudes itself, so unnormalized amounts are fine);
 *  - `modeData.ext = "♥ HP"` — HP is a whole number ≥ 1 here, so no
 *    below-minimum marker is needed;
 *  - `modeData.accent = info` **in the lots list only** for the lot that took
 *    damage in the last round, and only while it is still in play (an
 *    eliminated lot keeps the outcome's `bad`).
 *
 * Stateless/shared: the initial HP and the last damaged lot live in the game
 * state, the current HP in each participant's mode state.
 */

/**
 * Game-level state: initial HP per lot id. Fixed for one game and rebuilt when
 * the participant set changes (only possible before the first spin).
 */
interface WeakestLinkAmountGameState {
    initialHp: ReadonlyMap<string, number>;
    /**
     * Lot that took damage in the LAST round (in this mode always the rolled
     * lot), or `null` before the first round / after the participant set
     * changed. Drives the mode's `info` accent and is replaced wholesale by the
     * next round, so it never needs explicit clearing.
     */
    lastHitId: string | null;
}

/**
 * Per-participant state: the participant's current HP (`null` until first
 * materialized; derived from the game state's initial-HP map by `effectiveHp`).
 */
interface WeakestLinkAmountParticipantState {
    hp: number | null;
}

function asGameState(state: GameModeState): WeakestLinkAmountGameState {
    return state as WeakestLinkAmountGameState;
}

function asParticipantState(participant: GameParticipantState): WeakestLinkAmountParticipantState {
    return participant.modeState as WeakestLinkAmountParticipantState;
}

/** HP derived from a lot's amount: the amount itself, rounded UP to a whole number. */
function hpFromAmount(lot: Lot): number {
    return Math.ceil(lot.amount);
}

/**
 * Initial HP for a set of lots: each lot's `amount` rounded UP to a whole
 * number, with no normalization — amounts are independent of each other.
 */
function buildInitialHp(lots: readonly Lot[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const lot of lots) {
        map.set(lot.id, hpFromAmount(lot));
    }
    return map;
}

/** Current HP of a participant, deriving the initial value on first read. */
function effectiveHp(
    lot: Lot,
    participant: GameParticipantState,
    state: WeakestLinkAmountGameState
): number {
    const ps = asParticipantState(participant);
    if (typeof ps.hp === 'number') return ps.hp;
    return state.initialHp.get(lot.id) ?? hpFromAmount(lot);
}

/**
 * Deterministic winner for the (defensive) no-survivors case: the participant
 * with the highest HP after damage; ties broken by participant order.
 */
function highestHpAfterDamage(
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

export class WeakestLinkAmountMode implements GameMode {
    readonly id: Mode = 'weakest-link-amount';

    get name(): string { return t('mode.weakest-link-amount.name'); }
    get description(): string { return t('mode.weakest-link-amount.description'); }

    createGameState(lots: readonly Lot[]): GameModeState {
        const state: WeakestLinkAmountGameState = { initialHp: buildInitialHp(lots), lastHitId: null };
        return state;
    }

    createParticipantState(_lot: Lot): ParticipantModeState {
        const participant: WeakestLinkAmountParticipantState = { hp: null };
        return participant;
    }

    onParticipantsChanged(
        _state: GameModeState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): GameModeState {
        // Recompute the initial-HP map so a lot added before the first spin is
        // included. HP does not depend on the rest of the set here, but the map
        // must still cover every current participant. Once a spin has locked the
        // session, participant changes are rejected.
        const byId = new Map(lots.map(l => [l.id, l]));
        const currentLots: Lot[] = [];
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            if (lot) currentLots.push(lot);
        }
        return { initialHp: buildInitialHp(currentLots), lastHitId: null };
    }

    calculateSelectionWeight(): number {
        // Equal probability for every active participant, regardless of HP.
        return 1;
    }

    getParticipantMagnitude(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number {
        return effectiveHp(lot, participant, asGameState(state));
    }

    processRoll(
        rolledLot: Lot,
        _rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const gs = asGameState(state);
        const lotById = new Map(lots.map(l => [l.id, l]));

        // 1. HP before this turn's damage, for every participant. Computed up
        //    front so no participant's damage depends on another's outcome.
        const hpBefore = new Map<string, number>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            hpBefore.set(p.lotId, lot ? effectiveHp(lot, p, gs) : 0);
        }

        // 2. This mode's rule: only the ROLLED lot takes damage, and the damage
        //    is derived from the lots that are no stronger than it:
        //      L = active lots (other than the rolled) with HP <= HP(rolled);
        //      D = HP(rolled)            when L is empty (the rolled is weakest),
        //      D = ceil(mean(HP over L)) otherwise.
        const rolledHp = hpBefore.get(rolledLot.id) ?? 0;
        let sum = 0;
        let count = 0;
        for (const p of participants) {
            if (!p.active || p.lotId === rolledLot.id) continue;
            const hp = hpBefore.get(p.lotId) ?? 0;
            if (hp <= rolledHp) {
                sum += hp;
                count++;
            }
        }
        const damage = count === 0 ? rolledHp : Math.ceil(sum / count);

        // 3. Apply the damage to the rolled lot only; clamp at 0.
        const hpAfter = new Map<string, number>(hpBefore);
        hpAfter.set(rolledLot.id, Math.max(0, rolledHp - damage));

        // 4. Eliminated = active participants whose HP reached 0.
        const eliminated: string[] = [];
        for (const p of participants) {
            if (p.active && (hpAfter.get(p.lotId) ?? 0) <= 0) eliminated.push(p.lotId);
        }
        const eliminatedSet = new Set(eliminated);

        // 5. New participant records: HP materialized, eliminations applied.
        const nextParticipants: GameParticipantState[] = participants.map(p => {
            const next: WeakestLinkAmountParticipantState = { hp: hpAfter.get(p.lotId) ?? 0 };
            return {
                lotId: p.lotId,
                active: p.active && !eliminatedSet.has(p.lotId),
                modeState: next
            };
        });

        // 6. Participants whose HP actually changed (only the rolled lot's HP
        //    changes).
        const changed = participants
            .filter(p => p.active && (hpAfter.get(p.lotId) ?? 0) !== (hpBefore.get(p.lotId) ?? 0))
            .map(p => p.lotId);

        // 7. Winner / completion.
        const remaining = nextParticipants.filter(p => p.active);
        let winners: string[] = [];
        let finished: boolean;

        if (remaining.length === 1) {
            finished = true;
            winners = [remaining[0].lotId];
        } else if (remaining.length > 1) {
            finished = false;
        } else {
            // Defensive: no survivors — impossible while the rolled lot is
            // never damaged, but kept total and deterministic.
            finished = true;
            winners = [highestHpAfterDamage(participants, hpAfter)];
        }

        const winnerLot = winners.length > 0 ? lotById.get(winners[0]) : undefined;

        const result: MessageDescriptor = {
            key: 'mode.weakest-link-amount.result',
            params: { name: rolledLot.name, damage }
        };

        const outcome: TurnOutcome = {
            rolledLotId: rolledLot.id,
            winners,
            eliminated,
            changed,
            finished,
            result
        };
        if (finished && winnerLot) {
            outcome.message = {
                key: 'mode.weakest-link-amount.completionMessage',
                params: { name: winnerLot.name }
            };
        }

        // The rolled lot is the one that took damage: remember it as the
        // presentation accent subject (replaced by the next round).
        const nextState: WeakestLinkAmountGameState = { initialHp: gs.initialHp, lastHitId: rolledLot.id };
        return { state: nextState, participants: nextParticipants, outcome };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData> {
        const gs = asGameState(state);
        const byId = new Map(lots.map(l => [l.id, l]));
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            if (!p.active || !lot) {
                result.set(p.lotId, { ext: { value: '—' } });
                continue;
            }
            const data: ModePresentationData = {
                ext: { value: `♥ ${Math.round(effectiveHp(lot, p, gs))}` }
            };
            // The lot that just took damage is flagged for exactly one round —
            // in the LOTS LIST only. An eliminated lot is not accented, so it
            // keeps the outcome's `bad`.
            if (p.lotId === gs.lastHitId) {
                data.accent = { kind: 'info', targets: ['list'] };
            }
            result.set(p.lotId, data);
        }
        return result;
    }
}
