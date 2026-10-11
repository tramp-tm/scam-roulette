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
import { indexLots, normalizeToRange } from './utils.js';
import {
    castState,
    collectHp,
    computeChanged,
    computeEliminated,
    materializeParticipants,
    participantHp,
    resolveSurvivors
} from './hpElimination.js';
import type { HpParticipantState } from './hpElimination.js';

/**
 * Weakest Link.
 *
 * Rules (one spin):
 *  - every active participant has an equal chance to be rolled
 *    (`xValue = 1` — HP is NOT used for selection);
 *  - a lot's initial HP is its `amount` min–max normalized onto
 *    `[MIN_HP, MAX_HP]`, rounded UP to whole HP (smallest amount → `MIN_HP`,
 *    largest → `MAX_HP`);
 *  - the rolled lot — and ONLY it — takes damage. The damage is derived from
 *    the lots that are no stronger than it:
 *      L = active lots other than the rolled one with HP ≤ HP(rolled);
 *      D = HP(rolled)            when L is empty (the rolled is the weakest),
 *      D = ceil(mean(HP over L)) otherwise;
 *  - HP clamps at 0; participants at 0 HP are eliminated; the last one standing
 *    wins.
 *
 * Presentation:
 *  - `yValue = current HP` — the visualization draws HP as size;
 *  - `modeData.ext = "♥ HP"` — HP is always a positive integer here, so no
 *    below-minimum marker is needed;
 *  - `modeData.accent = info` **in the lots list only** for the lot that took
 *    damage in the last round, and only while it is still in play (an
 *    eliminated lot keeps the outcome's `bad`).
 *
 * Stateless/shared: the initial HP and the last damaged lot live in the game
 * state, the current HP in each participant's mode state. The turn pipeline
 * (steps 1, 4–7 of `processRoll`) is shared with the other HP-elimination modes
 * in `hpElimination.ts`; only the damage rule below is local.
 */

/** HP of the participant with the smallest `amount` (lower normalization bound). */
const MIN_HP = 1;

/** HP of the participant with the largest `amount` (upper normalization bound). */
const MAX_HP = 100;

/**
 * Game-level state: initial HP per lot id. Fixed for one game and rebuilt when
 * the participant set changes (only possible before the first spin), so every
 * participant of one game is normalized against the same amount set.
 */
interface WeakestLinkGameState {
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
 * Initial HP for a set of lots: amounts min–max normalized onto
 * `[MIN_HP, MAX_HP]` and rounded UP to whole HP. The smallest amount maps to
 * `MIN_HP`, the largest to `MAX_HP`; when every amount is equal the degenerate
 * normalization gives `MIN_HP` for all.
 */
function buildInitialHp(lots: readonly Lot[]): Map<string, number> {
    const normalized = normalizeToRange(lots.map(l => l.amount), MIN_HP, MAX_HP);
    const map = new Map<string, number>();
    for (let i = 0; i < lots.length; i++) {
        map.set(lots[i].id, Math.ceil(normalized[i]));
    }
    return map;
}

export class WeakestLinkMode implements GameMode {
    readonly id: Mode = 'weakest-link';

    get name(): string { return t('mode.weakest-link.name'); }
    get description(): string { return t('mode.weakest-link.description'); }

    createGameState(lots: readonly Lot[]): GameModeState {
        const state: WeakestLinkGameState = { initialHp: buildInitialHp(lots), lastHitId: null };
        return state;
    }

    createParticipantState(_lot: Lot): ParticipantModeState {
        const participant: HpParticipantState = { hp: null };
        return participant;
    }

    onParticipantsChanged(
        _state: GameModeState,
        participants: readonly GameParticipantState[],
        lots: readonly Lot[]
    ): GameModeState {
        // Recompute the normalization set so a lot added before the first spin
        // rescales everyone's (lazily derived) initial HP. Once a spin has
        // locked the session, participant changes are rejected.
        const byId = indexLots(lots);
        const currentLots: Lot[] = [];
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            if (lot) currentLots.push(lot);
        }
        return { initialHp: buildInitialHp(currentLots), lastHitId: null };
    }

    calculateSelectionWeight(_lot: Lot, _state: GameModeState): number {
        // Equal probability for every active participant, regardless of HP.
        return 1;
    }

    getParticipantMagnitude(
        lot: Lot,
        participant: GameParticipantState,
        state: GameModeState
    ): number {
        const gs = castState<WeakestLinkGameState>(state);
        return participantHp(lot, participant, l => gs.initialHp.get(l.id) ?? MIN_HP);
    }

    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const gs = castState<WeakestLinkGameState>(state);
        // This mode's HP source: the normalized initial-HP map.
        const initialHp = (lot: Lot): number => gs.initialHp.get(lot.id) ?? MIN_HP;

        // 1. HP before this turn's damage, for every participant.
        const hpBefore = collectHp(
            participants,
            lotById,
            (lot, p) => participantHp(lot, p, initialHp)
        );

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

        // 4–7. Shared pipeline (elimination, materialization, changed, winner).
        const eliminated = computeEliminated(participants, hpAfter);
        const nextParticipants = materializeParticipants(participants, hpAfter, new Set(eliminated));
        const changed = computeChanged(participants, hpBefore, hpAfter, { includeEliminated: true });
        const { winners, finished } = resolveSurvivors(nextParticipants, hpAfter);

        const winnerLot = winners.length > 0 ? lotById.get(winners[0]) : undefined;

        const result: MessageDescriptor = {
            key: 'mode.weakest-link.result',
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
                key: 'mode.weakest-link.completionMessage',
                params: { name: winnerLot.name }
            };
        }

        // The rolled lot is the one that took damage: remember it as the
        // presentation accent subject (replaced by the next round).
        const nextState: WeakestLinkGameState = { initialHp: gs.initialHp, lastHitId: rolledLot.id };
        return { state: nextState, participants: nextParticipants, outcome };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData> {
        const gs = castState<WeakestLinkGameState>(state);
        const initialHp = (lot: Lot): number => gs.initialHp.get(lot.id) ?? MIN_HP;
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            if (!p.active || !lot) {
                result.set(p.lotId, { ext: { value: '—' } });
                continue;
            }
            const data: ModePresentationData = {
                ext: { value: `♥ ${Math.round(participantHp(lot, p, initialHp))}` }
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
