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
import {
    collectHp,
    computeChanged,
    computeEliminated,
    materializeParticipants,
    participantHp,
    resolveSurvivors
} from './hpElimination.js';
import type { HpParticipantState } from './hpElimination.js';

/**
 * Crown Defense — Half Damage.
 *
 * Two rules define the mode:
 *  1. a lot's HP IS its raw `amount` (no normalization, no minimum floor);
 *  2. instead of a fixed damage, every non-rolled active participant takes
 *     `ceil(HP of the rolled lot / 2)` damage, rounded up to 0.01.
 *
 * Selection, elimination, winner and presentation are the standard ones.
 * Because the rolled lot is never damaged and the damage is always > 0, the
 * game always terminates.
 *
 * The turn pipeline (steps 1, 4–7 of `processRoll`) is shared with the other
 * HP-elimination modes in `hpElimination.ts`; only the damage rule below is local.
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

/** This variant's HP source: a lot's raw `amount` (no normalization, no floor). */
function initialHpOf(lot: Lot): number {
    return lot.amount;
}

/**
 * Crown Defense — Half Damage.
 *
 * Rules (one spin):
 *  - every active participant has an equal chance to be rolled
 *    (`xValue = 1` — HP is NOT used for selection);
 *  - the rolled participant takes NO damage;
 *  - every other active participant takes `ceil(hp(rolled) / 2)`, rounded up to
 *    0.01; HP clamps at 0;
 *  - participants at 0 HP are eliminated;
 *  - if one participant remains, it wins; if more than one remains, the game
 *    continues; no survivors is handled defensively (highest HP wins).
 *
 * Presentation:
 *  - `yValue = current HP` (= amount) — the visualization draws HP as size;
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
        const participant: HpParticipantState = { hp: null };
        return participant;
    }

    onParticipantsChanged(state: GameModeState): GameModeState {
        // No lot-derived state to recompute: HP is derived from `amount`.
        return state;
    }

    calculateSelectionWeight(_lot: Lot, _state: GameModeState): number {
        // Equal probability for every active participant, regardless of HP.
        return 1;
    }

    getParticipantMagnitude(
        lot: Lot,
        participant: GameParticipantState,
        _state: GameModeState
    ): number {
        return participantHp(lot, participant, initialHpOf);
    }

    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        // 1. HP before this turn's damage (this mode's HP source: the amount).
        const hpBefore = collectHp(
            participants,
            lotById,
            (lot, p) => participantHp(lot, p, initialHpOf)
        );

        // 2. This variant's rule: half the rolled lot's current HP, rounded up
        //    to 0.01. The rolled lot itself never takes damage, so reading its
        //    pre-damage HP here is safe.
        const damage = roundDamage((hpBefore.get(rolledLot.id) ?? 0) / 2);

        // 3. Apply the damage to every ACTIVE participant except the rolled
        //    one; clamp at 0.
        const hpAfter = new Map<string, number>(hpBefore);
        for (const p of participants) {
            if (p.active && p.lotId !== rolledLot.id) {
                hpAfter.set(p.lotId, Math.max(0, (hpBefore.get(p.lotId) ?? 0) - damage));
            }
        }

        // 4–7. Shared pipeline (elimination, materialization, changed, winner).
        const eliminated = computeEliminated(participants, hpAfter);
        const nextParticipants = materializeParticipants(participants, hpAfter, new Set(eliminated));
        const changed = computeChanged(participants, hpBefore, hpAfter, { includeEliminated: true });
        const { winners, finished } = resolveSurvivors(nextParticipants, hpAfter);

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
        lotById: ReadonlyMap<string, Lot>
    ): ReadonlyMap<string, ModePresentationData> {
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            let value = '—';
            if (p.active && lot) {
                const hp = participantHp(lot, p, initialHpOf);
                value = hp < MIN_HP ? `♥ ${BELOW_MINIMUM_HP}` : `♥ ${Math.round(hp)}`;
            }
            result.set(p.lotId, { ext: { value } });
        }
        return result;
    }
}
