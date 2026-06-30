import { Lot, ImportStrategy, ImportResult } from './types.js';
import { LotManager } from './lotManager.js';
import { generateRandomReadableColor } from './utils.js';
import i18n from './i18n.js';

import i18n from './i18n.js';


/** Replace strategy - clears existing lots and imports new ones */
export const REPLACE_STRATEGY: ImportStrategy = {
    id: 'replace',
    label: i18n.t('importStrategy.replace.label'),
    description: i18n.t('importStrategy.replace.description'),
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
    label: i18n.t('importStrategy.merge.label'),
    description: 'Keep existing lots and add new ones',
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
