# i18n Translation Tracking Document

This document tracks the iterative analysis of UI strings for multi-language support using i18next.

---

## Files Status Tracker

| File | Status | Notes |
|------|--------|-------|
| `animation.ts` | analyzed | No UI strings found - pure logic file |
| `app.ts` | pending | Main application logic |
| `csvParser.ts` | pending | CSV parsing utilities |
| `errorDialog.ts` | analyzed | Uses existing i18n keys (dialog.errorTitle, button.ok) - no new strings found |
| `importConflictDialog.ts` | pending | Import conflict resolution dialog |
| `importDialog.ts` | pending | Import dialog with preview |
| `importStrategies.ts` | pending | Import strategy definitions |
| `index.html` | pending | Main HTML template |
| `lotManager.ts` | pending | Lot management logic |
| `modalDialog.ts` | pending | Base modal dialog class |
| `modalManager.ts` | pending | Modal manager singleton |
| `rendererFactory.ts` | pending | Renderer factory function |
| `rouletteEngine.ts` | pending | Roulette calculation engine |
| `stripRenderer.ts` | pending | Strip visualization renderer |
| `types.ts` | pending | Type definitions and interfaces |

---

## Strings Inventory

### Format:
- **Key**: i18n key (e.g., `common.ok`, `error.invalidName`)
- **Source File**: Where the string is defined/used
- **Context**: Description of usage
- **Status**: pending / translated / replaced_with_key

| Key | Source File | Context | Status |
|-----|-------------|---------|--------|
| `validation.noLotsToSpin` | app.ts | Alert when no lots available to spin | translated |
| `sort.byName` | app.ts | Sort button label for name column | translated |
| `sort.byAmount` | app.ts | Sort button label for amount column | translated |
| `confirmation.deleteLot` | app.ts | Confirmation dialog before deleting a lot | translated |
| `validation.noLotsToClear` | app.ts | Alert when trying to clear empty list | translated |
| `confirmation.clearAllLots` | app.ts | Confirmation dialog with count placeholder | translated |
| `import.summaryWithTruncation` | app.ts | Import summary with truncation info | translated |
| `import.summaryTitle` | app.ts | Title for import summary dialog | translated |
| `dialog.errorTitle` | app.ts | Default error dialog title (hardcoded: '⚠️ Error') | pending |
| `button.ok` | app.ts | Close/OK button text (hardcoded: 'OK') | pending |

---

## Analysis Notes

### Completed Analyses:
- `animation.ts`: No user-facing strings found. Pure animation logic with easing functions and AnimationController class.
- `app.ts`: Main application controller. Found 8 already-translated strings using t() function, plus 2 hardcoded strings needing translation ('⚠️ Error' and 'OK').
- `errorDialog.ts`: Error dialog component. Already uses i18n keys (`dialog.errorTitle`, `button.ok`) via t() function. No new strings found - these keys were already tracked in app.ts analysis as pending translation.

### Pending Files (in order):
1. `importConflictDialog.ts` - Import conflict resolution dialog
2. `importDialog.ts` - Import dialog with preview
3. ... (remaining files)

---

## Next Steps

Provide the next file for analysis. I will:
1. Identify all user-facing strings
2. Suggest i18n keys following naming conventions
3. Update this tracking document
4. Provide code modification instructions
