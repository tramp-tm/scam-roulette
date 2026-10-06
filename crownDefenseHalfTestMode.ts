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
 * Crown Defense — Half Damage.
 *
 * A copy of the former `CrownDefenseMode` with two changes:
 *  1. a lot's HP IS its raw `amount` (no normalization, no minimum floor);
 *  2. instead of a fixed damage, every non-rolled active participant takes
 *     `ceil(HP of the rolled lot / 2)` damage, rounded up to 0.01.
 *
 * Everything else (equal selection, elimination, winner, presentation) is
 * standard, as in the original fixed-damage Crown Defense. Because the rolled
 * lot is never damaged and the damage is always > 0, the game always terminates.
 */

/** Damage precision: 1/100 = 0.01 (see `roundDamage`). */
const DAMAGE_FACTOR = 100;

/** Smallest HP value displayed as a whole number (else "< 1"). */
const MIN_HP = 1;

/** Shown instead of an HP value below the minimum. */
const BELOW_MINIMUM_HP = '< 1';

/**
 * Rounds damage UP to 0.01 (the mode's damage precision). Rounding up — rather
 * than to nearest — guarantees a positive damage for any positive HP, so the
 * game cannot stall with zero damage.
 */
function roundDamage(value: number): number {
    return Math.ceil(value * DAMAGE_FACTOR) / DAMAGE_FACTOR;
}

/**
 * Per-participant state: the participant's current HP (`null` until first
 * materialized; the initial value is simply the lot's `amount`).
 */
interface CrownDefenseHalfTestParticipantState {
    hp: number | null;
}

function asParticipantState(participant: GameParticipantState): CrownDefenseHalfTestParticipantState {
    return participant.modeState as CrownDefenseHalfTestParticipantState;
}

/** Current HP of a participant, deriving the initial value (= amount) on first read. */
function effectiveHp(lot: Lot, participant: GameParticipantState): number {
    const ps = asParticipantState(participant);
    if (typeof ps.hp === 'number') return ps.hp;
    return lot.amount;
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

/**
 * Crown Defense — Half Damage.
 *
 * Rules (one spin):
 *  - every active participant has an equal chance to be rolled
 *    (`selectionWeight = 1` — HP is NOT used for selection);
 *  - the rolled participant takes NO damage;
 *  - every other active participant takes `ceil(hp(rolled) / 2)`, rounded up to
 *    0.01; HP clamps at 0;
 *  - participants at 0 HP are eliminated;
 *  - if one participant remains, it wins; if more than one remains, the game
 *    continues; no survivors is handled defensively (highest HP wins).
 *
 * Presentation:
 *  - `visualValue = current HP` (= amount) — the visualization draws HP as size;
 *  - `modeData.ext = "♥ HP"` (or `"♥ < 1"` below the minimum).
 *
 * Stateless/shared: HP is derived straight from `amount`, so it needs no
 * game-level state.
 */
export class CrownDefenseHalfTestMode implements GameMode {
    readonly id: Mode = 'crown-defense-half-test';

    get name(): string { return t('mode.crown-defense-half-test.name'); }
    get description(): string { return t('mode.crown-defense-half-test.description'); }

    createGameState(_lots: readonly Lot[]): GameModeState { return {}; }

    createParticipantState(_lot: Lot): ParticipantModeState {
        const participant: CrownDefenseHalfTestParticipantState = { hp: null };
        return participant;
    }

    onParticipantsChanged(state: GameModeState): GameModeState {
        // No lot-derived state to recompute: HP is derived from `amount`.
        return state;
    }

    calculateSelectionWeight(): number {
        // Equal probability for every active participant, regardless of HP.
        return 1;
    }

    getParticipantVisualValue(
        lot: Lot,
        participant: GameParticipantState,
        _state: GameModeState
    ): number {
        return effectiveHp(lot, participant);
    }

    processRoll(
        rolledLot: Lot,
        _rolled: GameParticipantState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[],
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const lotById = new Map(lots.map(l => [l.id, l]));

        // 1. HP before this turn's damage, for every participant. Computed up
        //    front so no participant's damage depends on another's outcome.
        const hpBefore = new Map<string, number>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            hpBefore.set(p.lotId, lot ? effectiveHp(lot, p) : 0);
        }

        // 2. This variant's rule: half the rolled lot's current HP, rounded up
        //    to 0.01. The rolled lot itself never takes damage, so reading its
        //    pre-damage HP here is safe.
        const damage = roundDamage((hpBefore.get(rolledLot.id) ?? 0) / 2);

        // 3. Apply the damage to every ACTIVE participant except the rolled
        //    one; clamp at 0.
        const hpAfter = new Map<string, number>();
        for (const p of participants) {
            const before = hpBefore.get(p.lotId) ?? 0;
            if (p.active && p.lotId !== rolledLot.id) {
                hpAfter.set(p.lotId, Math.max(0, before - damage));
            } else {
                hpAfter.set(p.lotId, before);
            }
        }

        // 4. Eliminated = active participants whose HP reached 0.
        const eliminated: string[] = [];
        for (const p of participants) {
            if (p.active && (hpAfter.get(p.lotId) ?? 0) <= 0) eliminated.push(p.lotId);
        }
        const eliminatedSet = new Set(eliminated);

        // 5. New participant records: HP materialized, eliminations applied.
        const nextParticipants: GameParticipantState[] = participants.map(p => {
            const next: CrownDefenseHalfTestParticipantState = { hp: hpAfter.get(p.lotId) ?? 0 };
            return {
                lotId: p.lotId,
                active: p.active && !eliminatedSet.has(p.lotId),
                modeState: next
            };
        });

        // 6. Participants whose HP actually changed (the rolled one did not).
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
            key: 'mode.crown-defense-half-test.result',
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
                key: 'mode.crown-defense-half-test.completionMessage',
                params: { name: winnerLot.name }
            };
        }

        return { state, participants: nextParticipants, outcome };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): ReadonlyMap<string, ModePresentationData> {
        const byId = new Map(lots.map(l => [l.id, l]));
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            let value = '—';
            if (p.active && lot) {
                const hp = effectiveHp(lot, p);
                value = hp < MIN_HP ? `♥ ${BELOW_MINIMUM_HP}` : `♥ ${Math.round(hp)}`;
            }
            result.set(p.lotId, { ext: { value } });
        }
        return result;
    }
}
