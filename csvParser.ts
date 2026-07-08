import { SeparatorType, ParsedLot, ParseResult } from './types.js';
import { t } from './i18n.js';

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

    // Split into rows, handling both \n and \r\n line endings
    const rows = csvText.split(/\r?\n/);

    // Determine the separator character
    const sepChar = separator === 'comma' ? ',' : '\t';

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        
        // Skip empty rows
        if (!row.trim()) {
            continue;
        }

        // Split columns based on separator
        const columns = row.split(sepChar);

        // Validate: at least 2 columns required
        if (columns.length < 2) {
            result.errorCount++;
            continue;
        }

        // Extract and trim values
        const name = columns[0].trim();
        const amountStr = columns[1].trim();

        // Validate: non-empty name required
        if (!name) {
            result.errorCount++;
            continue;
        }

        // Parse amount as number (handle European decimal separator)
        const cleanAmountStr = amountStr.replace(',', '.');
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
        // This prevents cases where parsing might return 0 incorrectly
        if (amount === 0 && cleanAmountStr !== '0' && cleanAmountStr !== '0.0' && cleanAmountStr !== '0,0') {
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
