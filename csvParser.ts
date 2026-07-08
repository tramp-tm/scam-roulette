import { SeparatorType, ParsedLot, ParseResult } from './types.js';
import { t } from './i18n.js';

declare const Papa: {
    parse(
        csv: string,
        config: {
            delimiter?: string;
            skipEmptyLines?: boolean;
            header?: boolean;
        }
    ): {
        data: unknown[][];
    };
};

/**
 * Parses CSV text into lots.
 * 
 * @param csvText - The raw CSV input string
 * @param separator - Either 'comma' or 'tab' for column separation
 * @returns ParseResult containing valid lots and error count
 */
export function parseCSV(csvText: string, separator: SeparatorType): ParseResult {
    const result: ParseResult = {
        validLots: [],
        errorCount: 0
    };

    if (!csvText || !csvText.trim()) {
        return result;
    }

    // Use Papa Parse to properly handle CSV with quoted fields and various separators
    const parsed = Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        delimiter: separator === 'comma' ? ',' : '\t'
    });

    for (let rowIndex = 0; rowIndex < parsed.data.length; rowIndex++) {
        // Type assertion to handle Papa Parse's data structure properly
        const row = parsed.data[rowIndex] as any[];
        
        // Validate: at least 2 columns required
        if (!row || row.length < 2) {
            result.errorCount++;
            continue;
        }

        // Extract and trim values (Papa Parse already handles quoted fields properly)
        const name = String(row[0]).trim();
        const amountStr = String(row[1]).trim();

        // Validate: non-empty name required
        if (!name) {
            result.errorCount++;
            continue;
        }

        // Parse amount as number (handle European decimal separator)
        let cleanAmountStr = amountStr;
        
        // Handle comma as decimal separator - replace the first comma with dot
        if (cleanAmountStr.includes(',')) {
            const lastCommaIndex = cleanAmountStr.lastIndexOf(',');
            if (lastCommaIndex !== -1) {
                // Replace only the last comma with a dot to handle European format like "241,5"
                cleanAmountStr = 
                    cleanAmountStr.substring(0, lastCommaIndex) + 
                    '.' + 
                    cleanAmountStr.substring(lastCommaIndex + 1);
            }
        }
        
        let amount = parseFloat(cleanAmountStr);

        // Validate: valid numeric amount required (must be positive and finite)
        if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
            // Check for header row auto-detection on first data row only
            if (rowIndex === 0) {
                // If second column is not a valid number, treat as header and skip this row
                continue;
            }
            
            result.errorCount++;
            continue;
        }

        // Additional check to ensure we're getting actual numeric values
        if (amount === 0 && cleanAmountStr !== '0' && cleanAmountStr !== '0.0') {
            result.errorCount++;
            continue;
        }

        // Valid lot - add to results
        result.validLots.push({
            name: name,
            amount: amount
        });
    }

    return result;
}
