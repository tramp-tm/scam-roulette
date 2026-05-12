import { Lot, ImportStrategy } from './types.js';
import { LotManager } from './lotManager.js';
import { generateRandomReadableColor } from './utils.js';

/** Replace strategy - clears existing lots and imports new ones */
export const REPLACE_STRATEGY: ImportStrategy = {
    id: 'replace',
    label: '🔄 Replace',
    description: 'Remove all existing lots and import new ones',
    execute: (parsedLots, lotManager) => {
        lotManager.clearAll();
        
        for (const parsedLot of parsedLots) {
            const color = generateRandomReadableColor();
            lotManager.addLot(parsedLot.name, parsedLot.amount, color);
        }
    }
};

/** Merge strategy - combines existing and new lots */
export const MERGE_STRATEGY: ImportStrategy = {
    id: 'merge',
    label: '🔗 Merge',
    description: 'Keep existing lots and add new ones',
    execute: (parsedLots, lotManager) => {
        for (const parsedLot of parsedLots) {
            const matchingLot = lotManager.getAllLots().find(
                (l: Lot) => l.name.toLowerCase() === parsedLot.name.toLowerCase()
            );
            
            if (matchingLot) {
                lotManager.updateLot(matchingLot.id, { amount: parsedLot.amount });
            } else {
                const color = generateRandomReadableColor();
                lotManager.addLot(parsedLot.name, parsedLot.amount, color);
            }
        }
    }
};

/** Available import strategies */
export const IMPORT_STRATEGIES = [REPLACE_STRATEGY, MERGE_STRATEGY];
