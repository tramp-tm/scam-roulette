# i18n Translation Tracking Document

This document tracks the iterative translate of UI strings for multi-language support using i18next.

-
## Translation storage
 - i18n.ts


## Files Status Tracker

| File | Status | Notes |
|------|--------|-------|
| `animation.ts` | analyzed | No UI strings found - pure logic file |
| `csvParser.ts` | pending | CSV parsing utilities |
| `app.ts` | analyzed | Contains validation messages and sort controls but no direct UI elements displayed by this component |
| `errorDialog.ts` | translated | Uses existing i18n keys (dialog.errorTitle, button.ok) - no new strings found |
| `importConflictDialog.ts` | translated | Import conflict resolution dialog with translation keys added |
| `importDialog.ts` | pending | Import dialog with preview |
| `importStrategies.ts` | translated | Import strategy definitions with labels and descriptions properly translated |
| `index.html` | pending | Main HTML template |
| `lotManager.ts` | translated | 3 error messages replaced with i18n keys (error.invalidName, error.invalidAmount, error.maxLotsReached) - all translations verified in both EN/RU |
| `modalDialog.ts` | analyzed | No UI strings found - base structural class, all content passed as parameters to renderHeader/renderContent/renderFooter methods |
| `modalManager.ts` | analyzed | No UI strings found - pure utility/singleton class for modal stacking and z-index management, no user-facing text |
| `rendererFactory.ts` | analyzed | No UI strings found - pure factory/utility function that delegates renderer creation to visualization packages, no user-facing text |
| `rouletteEngine.ts` | pending | Roulette calculation engine |
| `stripRenderer.ts` | pending | Strip visualization renderer |
| `types.ts` | pending | Type definitions and interfaces |

-
