import type { Lot } from './types.js';
import { LotManager } from './lotManager.js';
import type { ParsedLot } from './csvParser.js';
import { generateRandomReadableColor } from './utils.js';

/** Result of import execution - tracks success and truncation */
export interface ImportResult {
    lotsAdded: number;
    lotsTruncated: number;  // How many were skipped due to MAX_LOTS limit
}

/**
 * Strategy object for import operations. Labels / descriptions are provided
 * by `data-i18n="importStrategy.<id>.…"` keys in the locale files.
 */
export interface ImportStrategy {
    id: 'replace' | 'merge';
    execute: (parsedLots: ParsedLot[], lotManager: LotManager) => ImportResult;
}

/** Replace strategy - clears existing lots and imports new ones */
export const REPLACE_STRATEGY: ImportStrategy = {
    id: 'replace',
    execute: (parsedLots, lotManager): ImportResult => {
        lotManager.clearAll();
        
        let lotsAdded = 0;
        let lotsTruncated = 0;
        
        for (const parsedLot of parsedLots) {
            // Check if adding this lot would exceed MAX_LOTS
            if (lotManager.getTotalCount() >= LotManager.MAX_LOTS) {
                lotsTruncated++;
                continue;
            }
            
            const color = generateRandomReadableColor();
            const result = lotManager.addLot(parsedLot.name, parsedLot.amount, color);
            
            if (result.success) {
                lotsAdded++;
            }
        }
        
        return { lotsAdded, lotsTruncated };
    }
};

/** Merge strategy - combines existing and new lots */
export const MERGE_STRATEGY: ImportStrategy = {
    id: 'merge',
    execute: (parsedLots, lotManager): ImportResult => {
        let lotsAdded = 0;
        let lotsTruncated = 0;
        
        for (const parsedLot of parsedLots) {
            // Check if adding this lot would exceed MAX_LOTS
            if (lotManager.getTotalCount() >= LotManager.MAX_LOTS) {
                lotsTruncated++;
                continue;
            }
            
            const matchingLot = lotManager.getAllLots().find(
                (l: Lot) => l.name.toLowerCase() === parsedLot.name.toLowerCase()
            );
            
            if (matchingLot) {
                // Update existing lot - doesn't count toward new additions
                lotManager.updateLot(matchingLot.id, { amount: parsedLot.amount });
            } else {
                const color = generateRandomReadableColor();
                const result = lotManager.addLot(parsedLot.name, parsedLot.amount, color);
                
                if (result.success) {
                    lotsAdded++;
                }
            }
        }
        
        return { lotsAdded, lotsTruncated };
    }
};

/** Available import strategies */
export const IMPORT_STRATEGIES = [REPLACE_STRATEGY, MERGE_STRATEGY];
