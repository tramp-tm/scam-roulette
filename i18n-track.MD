# i18next Translation Keys Tracker

This file tracks all translation keys identified during iterative analysis.

---

## Status: IN PROGRESS

Last updated: [DATE]

---

## Completed Files Analysis

| File | Status | Date Analyzed |
|------|--------|---------------|
| `errorDialog.ts` | ✅ Complete | - |
| `types.ts` (Mode Config) | ✅ Complete | - |

---

## Pending Files for Analysis

| Priority | File | Notes |
|----------|------|-------|
| 1 | `app.ts` | Main UI strings, buttons, labels |
| 2 | `importDialog.ts` | Import dialog strings |
| 3 | `importConflictDialog.ts` | Conflict resolution strings |

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

---

## Next File to Analyze: `app.ts`
