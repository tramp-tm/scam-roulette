# i18next Translation Keys Tracker

This file tracks all translation keys identified during iterative analysis.

---

## Status: IN PROGRESS

Last updated: [DATE]

---

## Completed Files Analysis

| File | Status | Strings Found | Date Analyzed |
|------|--------|---------------|---------------|
| `errorDialog.ts` | ✅ Complete | 2 | - |
| `types.ts` (Mode Config) | ✅ Complete | 4 | - |
| `app.ts` | ✅ Complete | 15+ | [TODAY] |

---

## Pending Files for Analysis

| Priority | File | Notes |
|----------|------|-------|
| 1 | `importDialog.ts` | Import dialog strings |
| 2 | `importConflictDialog.ts` | Conflict resolution strings |

---

## Translation Keys Registry

### From errorDialog.ts
```typescript
errorDialog.title = "⚠️ Error" → "⚠️ Ошибка"
errorDialog.okButton = "OK" → "OK"
```

### From types.ts (Mode Config)
```typescript
mode.normal.name = "Normal Mode" → "Обычный режим"
mode.normal.description = "Standard weighted random selection" → "Стандартный взвешенный случайный выбор"
mode.survival.name = "Survival Mode" → "Режим выживания"
mode.survival.description = "Winner is eliminated after each roll until one remains" → "Победитель выбывает после каждого броска, пока не останется один"
```

### From app.ts
```typescript
// Sort buttons
sort.buttons.name = "🅰️ Name" → "🅰️ Имя"
sort.buttons.amount = "💵 Amount" → "💵 Сумма"

// Alerts
ui.alert.noLotsToSpin = "Add at least one lot to spin!" → "Добавьте хотя бы один лот для вращения!"
ui.alert.noLotsToClear = "No lots to clear!" → "Нет лотов для очистки!"

// Confirmations
ui.confirm.deleteLot = "Are you sure you want to delete this lot?" → "Вы уверены, что хотите удалить этот лот?"
ui.confirm.clearAll = "Are you sure you want to clear all {{count}} lot(s)?\n\nThis action cannot be undone." → "Вы уверены, что хотите очистить все {{count}} лот(а/ов)?\n\nЭто действие нельзя отменить."

// Settings toggle (icons - same in both languages)
settings.toggle.collapsed = "⁝" → "⁝"
settings.toggle.expanded = "✕" → "✕"

// Delete button character
ui.deleteButton.char = "×" → "×"

// Import summary messages
ui.importSummary.title = "ℹ️ Import Summary" → "ℹ️ Итоги импорта"
ui.importComplete = "📊 Import Complete" → "📊 Импорт завершен"
ui.lotsAdded = "✅ {{count}} lot(s) added" → "✅ Добавлено {{count}} лот(а/ов)"
ui.lotsTruncated = "⚠️ {{count}} lot(s) truncated (exceeded MAX_LOTS limit of {{maxLots}})" → "⚠️ {{count}} лот(а/ов) обрезано (превышен лимит MAX_LOTS: {{maxLots}})"
ui.totalLotsInSystem = "Total lots in system: {{total}}" → "Всего лотов в системе: {{total}}"

// Debug console logs (optional)
debug.eliminated = "Eliminated" → "Выбывший"
debug.winning = "Winning" → "Победный"
```

---

## Next File to Analyze: `importDialog.ts`

This file contains the import dialog UI with:
- Dialog title and placeholder text
- Separator selection labels (Comma/Tab)
- Button labels (Preview, Import, Cancel)
- Error messages for invalid format
