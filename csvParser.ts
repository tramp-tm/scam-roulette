import { SeparatorType, ParseResult } from './types.js';

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
 * Normalises a user-supplied amount string into a form `parseFloat` can read.
 *
 * Handles both decimal conventions:
 *   - en / US : "1,234.56"  (comma = thousands, dot = decimal)
 *   - eu / RU : "1.234,56"  (dot = thousands, comma = decimal)
 *
 * Rule: the decimal separator is the separator that appears last AND is
 * followed by one or two digits. Any other separator is treated as a grouping
 * (thousands) separator and stripped. If no separator qualifies as a decimal
 * point, every separator is stripped (e.g. "1,234" -> "1234").
 */
function normalizeAmount(raw: string): string {
    const s = raw.trim().replace(/\s/g, '');
    if (!s) return s;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma === -1 && lastDot === -1) {
        return s;
    }

    const commaIsDecimal =
        lastComma !== -1 && /^\d{1,2}$/.test(s.slice(lastComma + 1));
    const dotIsDecimal =
        lastDot !== -1 && /^\d{1,2}$/.test(s.slice(lastDot + 1));

    let decimalIndex = -1;
    if (commaIsDecimal && dotIsDecimal) {
        // Both separators are candidates - the rightmost one is the decimal point.
        decimalIndex = lastComma > lastDot ? lastComma : lastDot;
    } else if (commaIsDecimal) {
        decimalIndex = lastComma;
    } else if (dotIsDecimal) {
        decimalIndex = lastDot;
    }

    if (decimalIndex === -1) {
        // No decimal separator detected - treat every separator as grouping.
        return s.replace(/[,\.]/g, '');
    }

    const intPart = s.slice(0, decimalIndex).replace(/[,\.]/g, '');
    const fracPart = s.slice(decimalIndex + 1).replace(/[,\.]/g, '');
    return `${intPart}.${fracPart}`;
}

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

        const amount = parseFloat(normalizeAmount(amountStr));

        // Validate: valid numeric amount required (must be positive and finite)
        if (isNaN(amount) || !isFinite(amount) || amount <= 0) {
            // Header auto-detection: only the very first row may be a header,
            // and only when there is at least one further row of actual data.
            // Requiring a second row prevents a single malformed line from
            // being silently discarded - it is reported as an error instead.
            if (rowIndex === 0 && parsed.data.length > 1) {
                continue;
            }

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
