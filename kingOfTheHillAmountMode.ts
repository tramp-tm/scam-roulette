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
import { indexLots } from './utils.js';
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
 * King of the Hill: HP = amount.
 *
 * HP source (no normalization):
 *  - a lot's initial HP is its `amount` directly, rounded UP to a whole number
 *    (`ceil(amount)`); amounts are validated as positive (≥ 0.01), so every lot
 *    starts at HP ≥ 1 and all HP / all damage stay whole numbers.
 *
 * Rules:
 *  - "the king" is the active lot with the highest HP; ties are broken
 *    uniformly at random. The king is decided at the START of a round (stored in
 *    the game state, recomputed at the end of the previous round), so the
 *    mechanics and the ext marker always agree;
 *  - every active lot has an equal chance to be rolled (`xValue = 1`);
 *  - the rolled lot ALWAYS survives:
 *      · rolled lot is NOT the king → it damages the king by its own HP
 *        (HP clamps at 0; a king at 0 HP is eliminated);
 *      · rolled lot IS the king       → it destroys the weakest OTHER lot
 *        (uniformly at random among the lowest-HP lots, never itself) and
 *        absorbs that lot's HP (no upper cap — the king's HP may exceed any
 *        lot's starting HP);
 *  - then a new king is determined; on a tie at the top the crown goes to, in
 *    order of priority: the current king (if it kept the lead), the round's
 *    attacker, otherwise a uniformly random tied lot; the last lot standing
 *    wins. A finished game has NO king (the crown is only elected when another
 *    round follows), so the winner always reads as the outcome's `good`.
 *
 * Presentation:
 *  - `yValue = current HP` — the visualization draws HP as size (it
 *    normalizes magnitudes itself, so unnormalized amounts are fine);
 *  - `modeData.ext = "♥ HP"` for everyone, prefixed with `♔` for the king;
 *  - `modeData.accent = accent` for the current king (both surfaces), so the
 *    "main actor" is visible in the lots list and in the visualization.
 *
 * Stateless/shared: the initial HP and the current king live in the game state,
 * the current HP in each participant's mode state. Randomness is used only for
 * tie-breaks (which lot is king / which weakest lot is destroyed) — never for
 * the roulette selection, which stays in RouletteEngine. The turn pipeline
 * (steps 1, 4–7 of `processRoll`) is shared with the other HP-elimination modes
 * in `hpElimination.ts`; only the round resolution below is local.
 */

/** Marker prepended to the king's ext value. */
const KING_MARK = '♔';

/**
 * Game-level state: initial HP per lot id plus the current king. The king is
 * the lot that will act as "the king" in the NEXT round (determined at the end
 * of the previous one); it is stored rather than derived so the random
 * tie-break is consumed once and cannot disagree between mechanics and UI.
 */
interface KingOfTheHillAmountGameState {
    initialHp: ReadonlyMap<string, number>;
    kingId: string | null;
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

/**
 * Elect the king among `ids` — the lot(s) with the HIGHEST HP.
 *
 * When several lots tie at the top, the crown is resolved by PRIORITY: the
 * first entry of `preferredIds` that is itself among the highest-HP lots wins
 * outright. The round passes `[current king, attacker]`, so a king that keeps
 * its lead stays king, and only otherwise does the attacker take the crown.
 * If no preferred lot is a candidate, the crown is broken uniformly at random
 * among the tied lots (`null` when `ids` is empty).
 */
function electKing(
    ids: readonly string[],
    hpOf: (id: string) => number,
    preferredIds: readonly (string | null)[] = []
): string | null {
    if (ids.length === 0) return null;
    let best = -Infinity;
    for (const id of ids) {
        const hp = hpOf(id);
        if (hp > best) best = hp;
    }
    const tied = ids.filter(id => hpOf(id) === best);
    for (const preferred of preferredIds) {
        if (preferred !== null && tied.includes(preferred)) return preferred;
    }
    return tied[Math.floor(Math.random() * tied.length)];
}

/**
 * Uniformly random id among those tied at the LOWEST HP, excluding `exclude`
 * (the king never destroys itself). `null` when no other lot remains.
 */
function pickLowest(
    ids: readonly string[],
    hpOf: (id: string) => number,
    exclude: string
): string | null {
    const candidates = ids.filter(id => id !== exclude);
    if (candidates.length === 0) return null;
    let lowest = Infinity;
    for (const id of candidates) {
        const hp = hpOf(id);
        if (hp < lowest) lowest = hp;
    }
    const tied = candidates.filter(id => hpOf(id) === lowest);
    return tied[Math.floor(Math.random() * tied.length)];
}

export class KingOfTheHillAmountMode implements GameMode {
    readonly id: Mode = 'king-of-the-hill-amount';

    get name(): string { return t('mode.king-of-the-hill-amount.name'); }
    get description(): string { return t('mode.king-of-the-hill-amount.description'); }

    createGameState(lots: readonly Lot[]): GameModeState {
        const initialHp = buildInitialHp(lots);
        const ids = [...initialHp.keys()];
        const kingId = electKing(ids, id => initialHp.get(id) ?? 0);
        return { initialHp, kingId };
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
        // Rebuild the initial-HP map (and the king) so a lot added before the
        // first spin is included. HP does not depend on the rest of the set
        // here, but the map must cover every current participant. Once a spin
        // has locked the session, participant changes are rejected.
        const byId = indexLots(lots);
        const currentLots: Lot[] = [];
        for (const p of participants) {
            const lot = byId.get(p.lotId);
            if (lot) currentLots.push(lot);
        }
        const initialHp = buildInitialHp(currentLots);
        const ids = [...initialHp.keys()];
        return { initialHp, kingId: electKing(ids, id => initialHp.get(id) ?? 0) };
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
        const gs = castState<KingOfTheHillAmountGameState>(state);
        return participantHp(lot, participant, l => gs.initialHp.get(l.id) ?? hpFromAmount(l));
    }

    processRoll(
        rolledLot: Lot,
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): { state: GameModeState; participants: GameParticipantState[]; outcome: TurnOutcome } {
        const gs = castState<KingOfTheHillAmountGameState>(state);
        const activeIds = participants.filter(p => p.active).map(p => p.lotId);
        // This mode's HP source: the initial-HP map, falling back to `ceil(amount)`.
        const initialHp = (lot: Lot): number => gs.initialHp.get(lot.id) ?? hpFromAmount(lot);

        // 1. HP before this round, for every participant.
        const hpBefore = collectHp(
            participants,
            lotById,
            (lot, p) => participantHp(lot, p, initialHp)
        );
        const hpOf = (id: string): number => hpBefore.get(id) ?? 0;

        // 2. The king for this round (stored at the previous round's end;
        //    defensive fallback: re-elect if the stored king is gone).
        const kingId = gs.kingId && hpBefore.has(gs.kingId)
            ? gs.kingId
            : electKing(activeIds, hpOf);

        // 3. Resolve the round. The rolled lot is never damaged.
        const rolledId = rolledLot.id;
        const hpAfter = new Map<string, number>(hpBefore);
        const eliminated: string[] = [];
        let result: MessageDescriptor;

        if (kingId && rolledId === kingId) {
            // The king was rolled: it destroys the weakest OTHER lot and
            // absorbs that lot's HP (no cap).
            const victimId = pickLowest(activeIds, hpOf, kingId);
            if (victimId) {
                hpAfter.set(kingId, hpOf(kingId) + hpOf(victimId));
                hpAfter.set(victimId, 0);
                eliminated.push(victimId);
            }
            const victimLot = victimId ? lotById.get(victimId) : undefined;
            result = {
                key: 'mode.king-of-the-hill-amount.resultDestroy',
                params: { name: rolledLot.name, victim: victimLot ? victimLot.name : '' }
            };
        } else {
            // A challenger was rolled: it damages the king by its own HP
            // (a whole number, since HP is always a whole number here).
            const damage = hpOf(rolledId);
            if (kingId) {
                const kingHp = Math.max(0, hpOf(kingId) - damage);
                hpAfter.set(kingId, kingHp);
                if (kingHp <= 0) eliminated.push(kingId);
            }
            result = {
                key: 'mode.king-of-the-hill-amount.resultDamage',
                params: { name: rolledLot.name, damage }
            };
        }

        // 4–6. Shared pipeline (elimination, materialization, changed, winner).
        //      This mode excludes the eliminated lots from `changed`.
        const eliminatedSet = new Set(eliminated);
        const nextParticipants = materializeParticipants(participants, hpAfter, eliminatedSet);
        const changed = computeChanged(participants, hpBefore, hpAfter, { includeEliminated: false });
        const { winners, finished } = resolveSurvivors(nextParticipants, hpAfter);

        // 7. Elect the king for the NEXT round — and only if there IS a next
        //    round. A finished game has no king: the last lot standing is the
        //    outcome's winner, so the crown must not mask the base `good`
        //    accent (see `getPresentationData`).
        //    On a tie at the top the crown is resolved by priority: the current
        //    king first (unchanged king keeps the crown), then the round's
        //    attacker, then uniformly at random.
        const survivorIds = nextParticipants.filter(p => p.active).map(p => p.lotId);
        const survivorHp = (id: string): number => hpAfter.get(id) ?? 0;
        const nextKingId = finished
            ? null
            : electKing(survivorIds, survivorHp, [kingId, rolledId]);

        const winnerLot = winners.length > 0 ? lotById.get(winners[0]) : undefined;

        const outcome: TurnOutcome = {
            rolledLotId: rolledId,
            winners,
            eliminated,
            changed,
            finished,
            result
        };
        if (finished && winnerLot) {
            outcome.message = {
                key: 'mode.king-of-the-hill-amount.completionMessage',
                params: { name: winnerLot.name }
            };
        }

        const nextState: KingOfTheHillAmountGameState = { initialHp: gs.initialHp, kingId: nextKingId };
        return { state: nextState, participants: nextParticipants, outcome };
    }

    getPresentationData(
        participants: readonly GameParticipantState[],
        lotById: ReadonlyMap<string, Lot>,
        state: GameModeState
    ): ReadonlyMap<string, ModePresentationData> {
        const gs = castState<KingOfTheHillAmountGameState>(state);
        const initialHp = (lot: Lot): number => gs.initialHp.get(lot.id) ?? hpFromAmount(lot);
        const result = new Map<string, ModePresentationData>();
        for (const p of participants) {
            const lot = lotById.get(p.lotId);
            // Inactive lots are "not participating" — never stale HP.
            if (!p.active || !lot) {
                result.set(p.lotId, { ext: { value: '—' } });
                continue;
            }
            const isKing = p.lotId === gs.kingId;
            const hp = Math.round(participantHp(lot, p, initialHp));
            const data: ModePresentationData = {
                ext: { value: isKing ? `${KING_MARK} ♥ ${hp}` : `♥ ${hp}` }
            };
            // The current king is the mode's "main actor" — accent it so both
            // the list and the visualization point at it. `kingId` is null once
            // the game is finished, so the winner keeps the base `good`.
            if (isKing) data.accent = { kind: 'accent' };
            result.set(p.lotId, data);
        }
        return result;
    }
}
