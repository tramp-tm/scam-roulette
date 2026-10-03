# Scam Roulette — техническое описание и бизнес-логика

Документ описывает структуру и реализацию приложения «Scam Roulette» (рулетка/розыгрыш
призов со взвешенной вероятностью): назначение модулей, модель данных, бизнес-правила,
жизненные циклы и потоки выполнения. Основано исключительно на исходном коде проекта
(`*.ts`, `index.html`, `locales/*`).

---

## 1. Обзор приложения

Одностраничное веб-приложение (SPA) на чистом TypeScript без UI-фреймворка. Позволяет:

- вести список «лотов» (участников/призов) — имя, сумма, цвет;
- импортировать лоты из CSV-текста или из Google Sheets по ссылке;
- выбирать один из двух игровых режимов (**Normal** / **Survival**);
- выбирать одну из трёх визуализаций (**Wheel** / **Strip** / **Counting Rhyme**);
- запускать «спин» — анимацию, которая заканчивается уже заранее определённым победителем
  (взвешенный случайный выбор);
- настраивать длительность анимации, функцию сглаживания (easing), язык и тему.

Ключевой принцип: **победитель вычисляется до начала анимации**. Анимация лишь отображает
уже принятое решение и никогда на него не влияет.

---

## 2. Технологический стек и сборка

| Компонент | Значение |
|---|---|
| Язык | TypeScript (strict), компилируется в ES-модули (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`) |
| Целевая платформа | Браузер (DOM + Canvas 2D) |
| Рантайм-зависимости | `i18next` (локализация), `papaparse` (разбор CSV) |
| Dev-зависимости | `typescript`, типы `@types/node`, `@types/i18next`, `@types/papaparse` |
| Сборка | `build.sh`: `tsc` в контейнере `node:25-slim`, затем копирование статики в `dist/` |

Сборка (`build.sh`):

```
tsc                                  # компиляция .ts -> dist/*.js (+ .js.map)
cp index.html styles.css favicon.ico locales dist/
cp node_modules/i18next/dist/esm/i18next.js dist/
cp node_modules/papaparse/papaparse.min.js dist/
```

`tsconfig.json`: `rootDir: ./`, `outDir: ./dist`, `include: ["**/*.ts"]`, `exclude: [node_modules, dist]`.
Тестов в проекте нет (`npm test` возвращает ошибку-заглушку).

Загрузка в браузере (`index.html`):
- `papaparse.min.js` — обычным скриптом (глобальный `Papa`);
- `i18next.js` — ES-модуль, импортируется из `i18n.ts`;
- `./app.js` — точка входа приложения (`type="module"`).

---

## 3. Архитектура и слои

Приложение разделено на слабо связанные слои; зависимости направлены «сверху вниз»,
снизу вверх приложение о себе не знает (обратные связи — только через колбэки).

```
                      ┌────────────────────────────────────────────┐
   Presentation ──▶   │ app.ts (App) — оркестратор/контроллер       │
                      └───┬───────────┬───────────┬────────────┬───┘
                          │           │           │            │
                ┌─────────┘   ┌───────┘   ┌───────┘      ┌─────┘
                ▼             ▼           ▼              ▼
         LotListView   Visualization  GameSession     ImportDialogs /
         (view-only)    Driver         (state+lifecycle) ModalDialog /
                        │                             ErrorDialog
                        ▼
                 Renderers (Wheel/Strip/CountingRhyme) ──▶ BaseRenderer

   Domain/логика (не знает про DOM/App):
     RouletteEngine, GameMode (NormalMode/SurvivalMode), LotManager, ImportStrategy, csvParser
```

Правила зависимостей:
- `RouletteEngine`, `GameMode`, `LotManager`, `GameSession` — доменный слой; не импортируют
  `App`, `VisualizationDriver` или рендереры.
- `LotListView` — презентационный компонент, который не знает ни о `LotManager`, ни о
  `GameSession`, ни о рендерерах; свои действия возвращает через колбэки.
- `VisualizationDriver` — единственная точка, через которую `App` общается с рендерингом и
  анимацией.
- Диалоги (`ModalDialog` и наследники) — самодостаточные DOM-компоненты, управляемые
  `ModalManager`.

---

## 4. Карта модулей

| Файл | Роль |
|---|---|
| `app.ts` | Контроллер `App`: инициализация, обработка событий UI, оркестрация домена и визуализации |
| `types.ts` | Общие типы и интерфейсы (`Lot`, `GameMode`, `IRenderer`, `VisualizationPackage`, `Settings`, `RollResult`…) |
| `lotManager.ts` | Глобальная коллекция лотов (CRUD, валидация, лимит) |
| `gameSession.ts` | Состояние текущей игры: режим, участие, блокировки, спин-цикл |
| `modes.ts` | Реестр режимов (`MODES`, `getMode`) |
| `normalMode.ts` | Режим Normal: правила и вес |
| `survivalMode.ts` | Режим Survival: правила и вес |
| `rouletteEngine.ts` | Взвешенный выбор, расчёт сегментов и финальных позиций анимации |
| `animation.ts` | Easing-функции и `AnimationController` (requestAnimationFrame) |
| `visualizationDriver.ts` | Обёртка над рендерером + анимацией + canvas |
| `visualizationStrategy.ts` | Реестр `VisualizationPackage` (тип → рендерер + расчёт позиции) |
| `baseRenderer.ts` | Абстрактный базовый рендерер (High-DPI, сегменты, поворот, highlight) |
| `wheelRenderer.ts` | Рендерер «колесо» |
| `stripRenderer.ts` | Рендерер «лента» (бесконечная прокрутка) |
| `countingRhymeRenderer.ts` | Рендерер «считалочка» (круги с подсветкой) |
| `lotListView.ts` | Компонент списка лотов (сортировка, редактирование, блокировка) |
| `utils.ts` | Цвета, геометрия ленты, отображение длительности, случайные позиции |
| `i18n.ts` | Инициализация i18next, перевод DOM, синхронизация `lang`, хелпер `t` |
| `csvParser.ts` | Разбор CSV-текста в `ParsedLot[]` (через Papa Parse) |
| `importStrategies.ts` | Стратегии импорта `REPLACE` / `MERGE` |
| `importDialog.ts` | Диалог импорта с вкладками CSV / Link, превью |
| `csvTabContent.ts` | Вкладка «CSV»: textarea + выбор разделителя |
| `linkTabContent.ts` | Вкладка «Link»: загрузка Google Sheets по URL |
| `importConflictDialog.ts` | Диалог выбора стратегии при конфликте импорта |
| `modalDialog.ts` | Базовый класс модального окна |
| `modalManager.ts` | Синглтон-менеджер модалок (z-index, стек открытых) |
| `errorDialog.ts` | Модальное окно сообщения (ошибка / инфо) |
| `index.html` | Разметка UI и inline-скрипт применения темы до первой отрисовки |
| `styles.css` | Стили и CSS-переменные тем (`:root[data-theme="…"]`) |
| `locales/en.json`, `locales/ru.json` | Переводы (i18n) |
| `build.sh` | Скрипт сборки в `dist/` |

---

## 5. Модель данных

### 5.1 Основные сущности

```ts
interface Lot {                 // Лот (участник/приз)
  id: string;                   // уникальный id (генерируется LotManager)
  name: string;
  amount: number;               // «сумма»; смысл зависит от режима
  color: string;                // цвет сегмента (HSL/RGB)
}

interface Settings {            // Настройки приложения
  modeId: Mode;                 // 'normal' | 'survival'
  visualization: VisualizationType; // 'wheel' | 'strip' | 'counting-rhyme'
  animationDuration: number;    // мс
}

interface GameState {           // Снимок для правил режима
  allLots: Lot[];
  activeLots: Lot[];
}

interface RollResult {          // Результат обработки спина режимом
  finished: boolean;
  winner: Lot | null;
  deactivate: string[];         // id лотов, выбывающих из игры
  message?: string;
}

interface Segment {             // Сегмент для рендеринга
  lot: Lot;
  startAngle: number;           // радианы
  endAngle: number;
  weight: number;               // нормализованный вес (сумма всех = 1)
}
```

### 5.2 Contribution/вес

«Вес» лота вычисляется **режимом**, а не движком:

- `NormalMode.calculateWeight(lot) = lot.amount` — чем больше сумма, тем выше шанс;
- `SurvivalMode.calculateWeight(lot) = 1 / lot.amount` — чем больше сумма, тем **ниже** шанс
  выбывания (и наоборот).

`RouletteEngine.calculateSegments()` нормализует веса так, что их сумма равна 1, и переводит
их в углы `[0, 2π)`.

### 5.3 Интерфейсы подсистем

```ts
interface IRenderer {                       // любой рендерер
  updateSegments(lots: Lot[], mode: GameMode): void;
  setRotation(value: number): void;
  getCurrentRotation(): number;
  setHighlightedLot(id: string | null): void;
  render(): void;
  reset(): void;
}

interface VisualizationPackage {            // «пакет» визуализации
  id: VisualizationType;
  createRenderer: (canvas: HTMLCanvasElement) => IRenderer;
  computeFinalPosition: (
    lots, mode, targetLotId, currentPosition, animationDurationMs, canvasWidth?
  ) => number;
}

interface GameMode {                        // стратегия игрового режима
  readonly id: Mode;
  readonly name: string;
  readonly description: string;
  calculateWeight(lot: Lot, activeLots: Lot[]): number;
  getRollText(rolledLot: Lot): string;
  processRoll(rolledLot: Lot, state: GameState): RollResult;
}
```

Благодаря `VisualizationPackage` реестр `visualizationStrategy.ts` — **единственный источник
правды** о том, «какой рендерер + какая математика финальной позиции» соответствуют типу
визуализации. В коде нет `switch` по строковому типу визуализации.

### 5.4 Полный перечень типов (сводка)

| Тип | Форма / роль | Файл |
|---|---|---|
| `Lot` | `{ id, name, amount, color }` — атомарная единица | `types.ts` |
| `Mode` | `'normal' \| 'survival'` | `types.ts` |
| `VisualizationType` | `'wheel' \| 'strip' \| 'counting-rhyme'` | `types.ts` |
| `Settings` | `{ modeId, visualization, animationDuration }`; тема и язык намеренно не входят (см. §6.7) | `types.ts` |
| `Segment` | `{ lot, startAngle, endAngle, weight }`; `weight` нормализован (0–1) | `rouletteEngine.ts` |
| `GameState` | `{ allLots, activeLots }` — снимок для `processRoll` | `types.ts` |
| `RollResult` | `{ finished, winner: Lot \| null, deactivate: string[], message? }` | `types.ts` |
| `PrepareSpinFailureReason` | Четыре причины отказа: `'spinInProgress' \| 'gameFinished' \| 'noActiveLots' \| 'noValidWeights'` | `gameSession.ts` |
| `PrepareSpinResult` | Дискриминированный union: `{ ok: true, lot } \| { ok: false, reason }` | `gameSession.ts` |
| `PendingSpin` | `{ rolledLot: Lot, mode: GameMode }` — решение вместе с пинированным режимом (PlanB) | `gameSession.ts` |
| `GameMode` | `{ id, name, description, calculateWeight, getRollText, processRoll }` | `types.ts` |
| `IRenderer` | `updateSegments`, `setRotation`, `getCurrentRotation`, `setHighlightedLot`, `render()` (без аргументов), `reset` | `types.ts` |
| `VisualizationPackage` | `{ id, createRenderer, computeFinalPosition }` (необязательный `canvasWidth?`) | `types.ts` |
| `ParsedLot` / `ParseResult` | `{ name, amount }` / `{ validLots, errorCount }` | `csvParser.ts` |
| `SeparatorType` | `'comma' \| 'tab'` | `csvParser.ts` |
| `ImportResult` | `{ lotsAdded, lotsTruncated }` | `importStrategies.ts` |
| `ImportStrategy` | `{ id: 'replace' \| 'merge', execute(parsedLots, lotManager): ImportResult }` | `importStrategies.ts` |
| `AddLotResult` / `AddLotError` | `{ success: true, lot }` / `{ success: false, reason, message }`, где `reason`: `'invalid_name' \| 'invalid_amount' \| 'max_lots_reached'` | `lotManager.ts` |
| `SortField` / `SortDirection` | `'name' \| 'amount'` / `'asc' \| 'desc'` | `lotListView.ts` |
| `RenderableLot` | `{ name, amount, id?, color?, active? }` — вход `LotListView.render` | `lotListView.ts` |
| `LotListViewOptions` | Опции рендера списка: `showActions`, `highlightId`, `editableAmount`, `onAmountChange`, `onDelete` | `lotListView.ts` |
| `EasingFunction` / `EasingFunctionDefinition` | `(t: number) => number` / `{ fn, name }` | `animation.ts` |

Замечание: `Segment`, `PrepareSpin*`, `PendingSpin`, `ParsedLot`/`ParseResult`, `ImportResult`,
`SortField`/`SortDirection`, `RenderableLot` определены не в `types.ts`, а в модулях-владельцах. В
`types.ts` лежат общие контракты: `Lot`, `Mode`, `Settings`, `GameState`, `RollResult`, `GameMode`,
`IRenderer`, `VisualizationPackage`.

---

## 6. Бизнес-логика

### 6.1 Управление лотами — `LotManager`

`LotManager` владеет **глобальным** списком лотов и ничего не знает про режимы, игроков и
участие в игре.

Методы и правила:
- `addLot(name, amount, color)` — валидирует и создаёт лот, возвращая
  `AddLotResult | AddLotError`:
  - имя после `trim()` не пустое → иначе `invalid_name`;
  - `amount` — конечное число > 0 → иначе `invalid_amount`;
  - количество лотов < `MAX_LOTS` (3000) → иначе `max_lots_reached`;
  - валидная сумма нормализуется: `max(0.01, parseFloat(amount))`.
  - `id` = `lot_<timestamp>_<random>`.
- `updateLot(id, {name?, amount?, color?})` — частичное обновление; сумма клампится ≥ 0.01.
- `deleteLot(id)` / `getLotById(id)` / `clearAll()` / `getTotalCount()` / `getAllLots()` (возвращает копию).

Лимит `MAX_LOTS = 3000` используется и при импорте (лишние лоты отбрасываются — «truncated»).

### 6.2 Игровые режимы — `GameMode`

Реестр `modes.ts`:

```ts
export const MODES = { normal: new NormalMode(), survival: new SurvivalMode() };
export function getMode(modeId) { return MODES[modeId]; }
```

**NormalMode**
- вес = `amount` (больше сумма → выше шанс);
- `processRoll()` возвращает `finished: true`, победитель — сам разыгранный лот,
  никто не выбывает. Одна игра = один спин.

**SurvivalMode** (выбывание)
- вес = `1 / amount` (больше сумма → ниже шанс выбыть);
- `processRoll()` смотрит на состояние **после** удаления разыгранного лота:
  - если остаётся ровно один лот → он объявляется победителем, `finished: true`,
    `deactivate: [rolledLot.id]`, `message` = сообщение о завершении;
  - если не остаётся никого (спин по единственному активному лоту) → разыгранный лот
    объявляется победителем, `deactivate: []` (вырожденный случай, чтобы игра корректно
    завершилась, а не «зависла» без участников);
  - иначе игра продолжается: `finished: false`, `deactivate: [rolledLot.id]`.

Таким образом, отдельный «сыгранный» раунд Survival = выбывание одного лота; последний
оставшийся — победитель.

**Метаданные режима.** `name` и `description` — это ленивые геттеры, вызывающие `t(...)` при
каждом обращении (`get name() { return t('mode.<id>.name'); }`), а не строки, зафиксированные при
загрузке модуля. Благодаря этому смена языка немедленно отражается на названии и описании режима
(в селекте режима и в подсказке-тултипе).

### 6.3 Движок рулетки — `RouletteEngine` (статические методы)

- **`roll(lots, mode)`** — взвешенный случайный выбор методом кумулятивного распределения:
  1. веса `wᵢ = mode.calculateWeight(lotᵢ, lots)`;
  2. `totalWeight = Σ wᵢ`; если `≤ 0` → `null`;
  3. `r = Math.random() * totalWeight`;
  4. перебором вычитаем `wᵢ` из `r`, пока `r < wᵢ` — это и есть выбранный лот.
  Победитель определяется здесь и далее не меняется.

- **`calculateSegments(lots, mode)`** — нормализация весов (`wᵢ / totalWeight`) и раскладка
  по углам `[0, 2π)`. Используется и рендерерами, и математикой анимации — единый источник
  геометрии.

- **`computeFinalRotation(...)`** — финальный угол для «колеса». Указатель закреплён сверху
  (`-π/2`). Внутри целевого сегмента выбирается случайная точка (с отступом от краёв),
  вычисляется базовый поворот, затем добавляются полные обороты так, чтобы движение было
  только «вперёд» от текущего угла и визуально насыщенным (2–5 оборотов/сек в зависимости
  от длительности).

- **`computeFinalScrollOffset(...)`** — финальное смещение для «ленты». Позиция считается по
  ширине сегментов (`getSegmentWidth`, см. §6.6), лента бесконечная и повторяется циклами;
  добавляются полные циклы (2–5/сек) плюс случайный «довесок» для разнообразия.

- **`computeFinalCountingPosition(...)`** — финальная позиция для «считалочки». Позиция
  измеряется в **циклах** (1 цикл = полный обход кольца кругов). Цель —
  `targetMid = prefixᵢ + wᵢ/2`; возвращается значение, сравнимое с `targetMid` по модулю 1,
  строго больше текущего, плюс `max(2, round(durationSec * 2))` дополнительных циклов.
  Гарантия: последний кадр анимации подсвечивает именно разыгранный лот.

- **`canSpin(activeLots)`** — `activeLots.length >= 1`.

### 6.4 Сессия игры — `GameSession`

`GameSession` — центральный владелец состояния текущей игры и её жизненного цикла.

**Что им владеется:**
- текущий `GameMode` (правила сессии);
- множество участия `activeLotIds: Set<string>`;
- жизненный цикл спина и блокировки;
- единственная точка смены режима `setMode()`.

**Что берётся извне:** глобальный список лотов — через аксессор
`getLots: () => readonly Lot[]` (обычно `() => lotManager.getAllLots()`). Сессия **не кэширует**
снимок: `allLots`, `activeLots`, `activeCount`, `state` каждый раз проецируют текущий глобальный
список через `activeLotIds`. Поэтому устаревший id не может «протечь» в представление.

**Проекции:**
- `activeLots = getLots().filter(l => activeLotIds.has(l.id))`;
- `isActive(id)` — участвует ли лот в сессии.

**Мутации участия** (все отклоняются при `sessionLocked`):
- `addLot(lot)` — новый лот становится участником (вызывается после `LotManager.addLot`);
- `removeLot(id)` — лот убирается из участия (после `LotManager.deleteLot`);
- `clearLots()` — очистка участия (после `LotManager.clearAll`);
- `reconcileAfterBulkChange(previousIds)` — приватная и публичная примирение после массового
  изменения (импорт). Правила:
  - лот, существовавший **до** и оставшийся **после**, сохраняет прежний статус участия
    (выбывшие в Survival остаются выбывшими при MERGE);
  - лот, появившийся **только после** изменения, становится активным (REPLACE пересоздаёт лоты
    с новыми id → после replace все активны);
  - исчезнувший глобально лот удаляется из множества;
  - `deactivateMany(ids)` — **приватный**, вызывается только из `finishSpin()` (исключение из-под
    блокировки сессии).

**Жизненный цикл спина — три флага:**
- `sessionLocked` — поднимается при первом успешном `prepareSpin()`, снимается только `reset()`;
  блокирует изменения уровня сессии (участие, режим, импорт, очистку);
- `spinInProgress` — истинно только между `prepareSpin()` и `finishSpin()`;
- `gameFinished` — истинно после результата `finished: true`, снимается только `reset()`.

`App` читает эти флаги через геттеры `isSessionLocked` / `isSpinInProgress` / `isGameFinished` и
выводит из них `disabled`-состояния элементов, не храня своей копии.

**`prepareSpin()`** возвращает `{ok:true, lot}` или `{ok:false, reason}` с одним из **четырёх**
оснований:
1. `spinInProgress` — спин уже идёт;
2. `gameFinished` — игра завершена;
3. `noActiveLots` — нет активных участников (`canSpin` ложно);
4. `noValidWeights` — `roll()` вернул `null` (нулевая сумма весов).

При успехе: режим **пинится** (captured) в момент решения, вызывается `RouletteEngine.roll`,
сохраняется `pendingSpin = {rolledLot, mode}`, атомарно поднимаются оба флага
(`sessionLocked` и `spinInProgress`). При отказе флаги **не меняются** — попытка спина не
блокирует сессию.

**`finishSpin()`** — применяет отложенный результат:
- если `pendingSpin` нет → `null`;
- `pendingSpin` обнуляется **до** применения (защита от повторного применения);
- вызывается пинированный `mode.processRoll(rolledLot, this.state)`;
- применяются `result.deactivate` (через `deactivateMany`);
- при `result.finished` поднимается `gameFinished`;
- `spinInProgress` снимается в `finally` — даже если `processRoll()` бросает исключение;
  `sessionLocked` и `gameFinished` при этом не трогаются, а исключение пробрасывается наверх;
- возвращает `{rolledLot, result}`.

**`setMode(modeId)`** — единственная точка смены режима; отклоняется при `sessionLocked`.
Смена режима сохраняет текущее множество участия (новые правила применяются к текущим
участникам).

**`reset()`** — полный сброс текущей игры: очистка `pendingSpin`, сброс всех трёх флагов,
новое множество участия = все лоты глобального списка.

**Инварианты жизненного цикла.**

- `sessionLocked` — поднимается при первом успешном `prepareSpin()`, снимается только `reset()`.
  Замораживает любые мутации уровня сессии (участие, режим, массовое примирение); `finishSpin()`
  его никогда не снимает.
- `spinInProgress` — поднимается `prepareSpin()`, снимается парным `finishSpin()` (в `finally`).
  Замораживает только те контролы, что нельзя менять во время анимации (слайдер/поле длительности,
  селекты визуализации и easing, саму Spin). Между спинами незавершённой игры Survival снова
  отпускается.
- `gameFinished` — поднимается при применении `RollResult` с `finished === true`, снимается только
  `reset()`. Держит Spin выключенным после конца игры и через производный `spinTimeLocked` в `App`
  замораживает и спин-тайм конфигурацию уже после последнего `finishSpin()`.
- **Неявный инвариант:** `spinInProgress === true` всегда влечёт `sessionLocked === true` — оба
  флага поднимаются одним и тем же вызовом `prepareSpin()`, а `spinInProgress` снимается только
  `finishSpin()`, который `sessionLocked` не трогает. `App` опирается на это, упрощая свои guard-ы
  (§7.5).
- Любой лот, возвращённый `activeLots` / `state`, существует в `LotManager` — по построению, так
  как оба материализуются из живого аксессора (инвариант этапа 3).
- Отложенный разыгранный лот существует только между успешным `prepareSpin()` и парным
  `finishSpin()`. `finishSpin()` обнуляет контекст **до** вызова `processRoll`, а `reset()` — тоже,
  поэтому повторный или поздний вызов не может отыграть устаревший бросок.
- Неуспешный `prepareSpin()` (любой `{ ok: false, reason }`) не трогает ни один из трёх флагов и
  `pendingSpin`: пининг режима (`pendingSpin = { rolledLot, mode }`) происходит только на успешной
  ветке — после того, как все проверки уже вернули отказ.

### 6.5 Импорт

**Разбор CSV — `csvParser.ts`**
- `parseCSV(csvText, separator)` использует Papa Parse (`header:false`, `skipEmptyLines:true`,
  разделитель `,` или `\t`).
- Обязательны ≥ 2 колонок; имя (колонка 0) не пустое; сумма (колонка 1) — конечное число > 0.
- `normalizeAmount()` корректно различает десятичный разделитель: поддерживаются и
  «1,234.56» (en), и «1.234,56» (eu/ru). Десятичным считается последний разделитель, за
  которым идут 1–2 цифры; остальные трактуются как разделители разрядов и удаляются.
- Автоопределение строки-заголовка: строка с некорректной суммой молча пропускается,
  **только** если это самая первая строка и после неё есть ещё хотя бы одна строка.
- Возврат: `{validLots, errorCount}`.

**Стратегии импорта — `importStrategies.ts`**
- `REPLACE_STRATEGY`: `clearAll()` и заново добавляет все разобранные лоты (каждый лот
  получает новый id и новый случайный цвет). Существующие лоты «пересоздаются» → после
  replace все становятся активными участниками.
- `MERGE_STRATEGY`: для каждого лота ищет совпадение по имени (без регистра); при совпадении
  обновляет сумму существующего, иначе добавляет новый. Выбывшие лоты не «оживают».
- Обе стратегии уважают `MAX_LOTS`, считая `lotsTruncated` (пропущенные из-за лимита).

**Диалог импорта — `importDialog.ts`**
- Модальное окно с двумя вкладками: «CSV» (`csvTabContent.ts`) и «Link» (`linkTabContent.ts`),
  общей строкой статуса (`valid-count`, `error-count`), кнопками Preview/Import и превью.
- Единый источник `parsedLots` обновляется при вводе в активной вкладке
  (`updateSharedParsedLots`).
- Вкладка Link принимает ссылку на Google Sheets: извлекаются `id` таблицы и `gid`
  (из query или из `#gid=`, по умолчанию `0`), затем CSV загружается через
  `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&gid=<gid>` и парсится
  `parseCSV(text, 'comma')`.

**Разрешение конфликта — `importConflictDialog.ts`**
- Если глобальный список не пуст, `App` показывает диалог выбора стратегии (replace/merge/cancel).
- При пустом списке конфликта нет — сразу используется MERGE.

**Оркестрация импорта в `App`** (`executeImport`):
1. проверка `isSessionLocked` → при блокировке `ErrorDialog` и выход;
2. снимок id-множества **до** стратегии (`idsBefore`);
3. `strategy.execute(parsedLots, lotManager)`;
4. `gameSession.reconcileAfterBulkChange(idsBefore)` — восстановление участия;
5. `updateUI()` + `visualizationDriver.refresh(...)`;
6. закрытие диалога импорта и, при `lotsTruncated > 0`, показ информационного модала
   (`import.summaryWithTruncation`).

### 6.6 Вспомогательные вычисления — `utils.ts`

- `generateRandomReadableColor()` — HSL (насыщенность 60–100%, светлота 20–45%) для контраста
  с белым текстом.
- `brightenColor(color, percent)` — осветление hex #RGB/#RRGGBB (для подсветки сегментов),
  возвращает `rgb(...)`.
- Геометрия ленты: `MIN_SEGMENT_WIDTH = 60`, `SEGMENT_WIDTH_SCALE = 400`,
  `getSegmentWidth(weight) = max(60, weight * 400)` — **единый источник ширины сегмента** для
  `StripRenderer` и `computeFinalScrollOffset`, чтобы отрисовка и математика не расходились.
- Отображение длительности: позиции слайдера 1–60 секунд отображаются напрямую; свыше 60 —
  по таблице `DURATION_MAP` до 300 с. Функции `sliderToDuration` / `durationToSlider`
  (обратное преобразование находит ближайшую допустимую позицию).
- `getRandomPositionInRange(span, edgeMarginPercent, maxEdgeMargin)` — случайная точка внутри
  сегмента с отступом от краёв (используется при выборе позиции «попадания»).

### 6.7 Настройки времени, языка и темы

- **Длительность анимации**: слайдер (нелинейная шкала 1–300 с, см. §6.6) и числовое поле.
  Внутри хранится в миллисекундах (`settings.animationDuration`). Числовое поле валидируется
  по `change`: некорректное значение приводится к `MIN_DURATION_SEC`/`MAX_DURATION_SEC`,
  слайдер синхронизируется.
- **Easing**: `EasingFunctions` — реестр кривых (`linear`, `easeOutCubic/Quart/Quint/Expo`,
  кастомный `rouletteEaseOut` — блендинг кубической и квинтической). Выбранная функция
  хранится в `App.easingFunction` и передаётся в анимацию при спине.
- **Язык (i18n)**: `i18n.ts` грузит `locales/en.json` и `locales/ru.json` параллельно,
  инициализирует i18next (язык по `navigator.language`, fallback `en`). Перевод выполняется по
  атрибутам разметки: `data-i18n` (текст), `data-i18n-placeholder`, `data-i18n-title`.
  Дополнительно синхронизируется атрибут `<html lang>`.
- **Тема**: применяется через атрибут `data-theme` на `<html>`; значения — CSS-переменные в
  `styles.css`. Тема сохраняется в `localStorage('theme')`. Inline-скрипт в `<head>`
  `index.html` применяет сохранённую (или системную) тему **до первой отрисовки**, чтобы
  избежать «мигания». Список тем: dark, light, emerald, eucalyptus, nordic, monochrome, nebula.

---

## 7. Презентационный слой

### 7.1 `App` — контроллер (`app.ts`)

Создаётся после `initI18n()` (в `startApp()`), находит DOM-элементы, конструирует
`LotManager`, `GameSession`, `VisualizationDriver`, `LotListView`, навешивает обработчики.

Ссылки на ключевые подсистемы:
- `lotManager` — глобальные лоты;
- `gameSession` — текущая игра (режим, участие, жизненный цикл);
- `visualizationDriver` — рендеринг + анимация;
- `lotListView` — список лотов;
- `settings` и `easingFunction` — пользовательские настройки;
- `highlightedLotId` — id подсвеченного лота (принадлежит `App`).

Основные операции:
- `addLot()` — guard по `isSessionLocked`; `LotManager.addLot` (при ошибке — `ErrorDialog`);
  при успехе `gameSession.addLot(lot)`, сброс формы, `updateUI()` + `refresh()`.
- `spin()` — `gameSession.prepareSpin()`; при отказе — `alert` с переведённым сообщением
  (`prepareSpinFailureKey`); при успехе — `updateControlsState()` и
  `visualizationDriver.spinTo({ ..., onComplete: () => this.finishSpin() })`.
- `finishSpin()` — вызывает `gameSession.finishSpin()` (в `try/catch`, при исключении —
  `ErrorDialog('error.spinProcessingFailed')`); выставляет `highlightedLotId` и текст результата
  (`mode.getRollText`), при `finished` может подсветить иного победителя (`result.winner`) и
  показать `result.message`; затем `updateUI()` + `refresh(...)`.
- `reset()` — обнуляет highlight, вызывает `gameSession.reset()`,
  `visualizationDriver.reset(...)`, обновляет текст и UI (синхронно).
- `deleteLot(id)` / `handleClearLots()` — guard по блокировке, подтверждение через `confirm`,
  затем согласованные операции над `LotManager` и `GameSession`.
- `handleAmountChange(id, amount)` — guard, `updateLot`, `refresh` (изменение суммы не меняет
  участие).
- `openImportDialog()` / `handleImportConflict()` / `executeImport()` — оркестрация импорта (§6.5).
- `updateUI()` — пересобирает список (`LotListView.render` с `RenderableLot[]`), обновляет
  статистику (total из `LotManager`, active из `GameSession`) и вызывает `updateControlsState()`.
- `updateControlsState()` — переносит блокировки сессии в `disabled` элементов (см. §7.5).

Замечание: `App` никогда сам не мутирует игровое состояние — все переходы выполняет
`GameSession`.

### 7.2 `LotListView` — список лотов (`lotListView.ts`)

Чисто презентационный компонент. Владеет DOM списка, сортировкой (поле `name`/`amount`,
направление `asc`/`desc`) и `disabled`-состоянием своих контролов. Не импортирует `LotManager`,
`GameSession`, `App`, рендереры и даже хелпер `t` (тексты приходят из `data-i18n`).

- `render(lots, options)` — полная перерисовка, сортировка на копии массива; строки получают
  классы `inactive` / `highlighted`; для каждого лота — индикатор цвета, имя, поле суммы
  (`editableAmount`), кнопка удаления (кроме подсвеченного).
- Пользовательские действия возвращаются через колбэки `onAmountChange`, `onDelete`.
- `setLocked(boolean)` — блокирует поля сумм и кнопки удаления.

### 7.3 `VisualizationDriver` — граница визуализации

Владеет canvas, текущим `IRenderer`, типом визуализации и `AnimationController`. `App` видит
только пять методов:
- `setVisualization(type, lots, mode)` — построить новый рендерер, засеять сегменты, отрисовать;
- `refresh(lots, mode)` — пересчитать сегменты и перерисовать;
- `render()` — перерисовать без пересчёта (например, при смене темы);
- `spinTo({lots, mode, targetLotId, durationMs, easing, onComplete})` — рассчитать финальную
  позицию через пакет визуализации и запустить анимацию; на каждом кадре — `setRotation` +
  `render()`;
- `reset(lots, mode)` — остановить анимацию, сбросить рендерер, засеять сегменты, отрисовать.

### 7.4 Рендереры (Canvas 2D)

`BaseRenderer` владеет общим состоянием: canvas/ctx, `segments`, `currentRotation`,
`highlightedLotId`, настраивает High-DPI (`devicePixelRatio`), задаёт логический размер с
fallback 600×500 и умеет `updateSegments` (через `RouletteEngine.calculateSegments`),
`setRotation`/`getCurrentRotation`, `setHighlightedLot`, `reset`.

- **`WheelRenderer`** — круг с сегментами (пропорциональны весам). Геометрия задана модульными
  константами: `WHEEL_MARGIN = 30` (радиус = `min(centerX, centerY) − 30`),
  `SEGMENT_STROKE_WIDTH = 2` (белая обводка), `HIGHLIGHT_BRIGHTNESS = 30` (подсветка —
  `brightenColor(color, 30)`). Подписи рисуются на `LABEL_RADIUS_RATIO = 0.7` радиуса, повёрнуты
  на середину дуги и **только если угловой размах сегмента > `LABEL_MIN_ARC = 0.1` рад**; имена
  длиннее 12 символов усекаются до 10 + «..». Указатель — золотой треугольник вверху с тенью
  `shadowBlur = 15`. Декоративные кольца: внешнее на `radius + 10` (4 px, `rgba(255,255,255,0.3)`)
  и внутреннее на `radius − 5` (2 px, `rgba(255,255,255,0.1)`).
- **`StripRenderer`** — бесконечная горизонтальная лента. `updateSegments()` после
  `super.updateSegments` суммирует `getSegmentWidth(s.weight)` по всем сегментам и кэширует
  результат в `totalCycleWidth` (пересчёт только при смене лотов/режима, не в кадре анимации);
  `reset()` кэш очищает. `render()` переводит накопленное смещение в визуальное по модулю одного
  цикла (`getVisualOffset`), вычисляет число копий цикла на вьюпорт (`getCyclesNeeded`) и рисует
  несколько `renderOneCycle` для бесшовности. Высота ленты `BAND_HEIGHT = 160`; подписи повёрнуты
  на `−π/2`, усекаются (>15 → 13 + «..»); подсветка — `brightenColor(color, 40)` с золотым свечением
  (`rgba(255,215,0,0.8)`, blur 15); центральный маркер — золотая пунктирная вертикаль (`[10, 5]`) с
  стрелками; рамка `rgba(255,255,255,0.3)`, 4 px. Ширина сегментов — `getSegmentWidth`.
- **`CountingRhymeRenderer`** — каждый лот — круг в сетке. Радиус пропорционален весу
  **относительно самого тяжёлого активного** (`wᵢ / max(w)`, диапазон `MIN_CIRCLE_RADIUS = 14` …
  `MAX_CIRCLE_RADIUS = 250`), а подсветка/«такт» — по нормализованному весу (dwell пропорционален
  вероятности). Подсветка **вычисляется внутри `render()` из `currentRotation` и кэшированных
  префиксных сумм** `prefixSums` (не из `highlightedLotId`, который для этого рендерера не
  выставляется) и сглаживается кроссфейдом на окне `TRANSITION_FRACTION = 0.2` от **текущего**
  сегмента, что сохраняет пропорциональность dwell. Раскладка по сетке детерминирована: и
  перестановка ячеек, и джиттер берутся из одного LCG, засеянного FNV-1a-хешем id лотов, поэтому
  одинаковый набор лотов даёт одинаковую раскладку (Survival не перетасовывает сетку между
  выбываниями), а `Math.random()` в раскладке не используется. Позиция анимации измеряется в циклах
  (см. §6.3).

### 7.5 Правила блокировки UI

`updateControlsState()` выводит `disabled` из трёх флагов `GameSession`:

| Контрол | Разблокирован когда |
|---|---|
| Spin | не идёт спин и игра не завершена |
| Reset | всегда |
| Mode / Import / Clear | сессия не заблокирована (`!sessionLocked`) |
| Add-row (имя/сумма/кнопка) | `!sessionLocked` |
| Поля сумм и удаление в списке | `!sessionLocked` |
| Duration / Visualization / Easing | не идёт спин и игра не завершена |
| Сортировка | всегда |

Обработчики, помимо атрибута `disabled`, дополнительно проверяют состояние на уровне `App`
(guard-и) — блокировка не завязана только на DOM. Для селектов при отклонённом изменении
восстанавливается предыдущее значение.

### 7.6 Модальные окна

- `ModalManager` — синглтон, выдаёт возрастающие `z-index`, ведёт стек открытых модалок,
  определяет «верхнюю» (`isTopmost`) и умеет повторно переводить открытые модалки.
- `ModalDialog` — базовый класс: создаёт overlay+content, кнопку закрытия, закрытие по клику
  вне содержимого и по `Escape` — но только для **верхней** модалки; поддерживает
  `open`/`close`/`destroy` и хуки `onOpen`/`onClose`.
- `ErrorDialog` — заголовок + сообщение + кнопка OK; используется и как информационный модал
  (например, сводка импорта с усечением).
- `ImportConflictDialog` — кнопки стратегий (replace/merge/cancel) формируются из
  `IMPORT_STRATEGIES`; выбор передаётся в колбэк (или `null` при отмене).

### 7.7 Обработка сбоев и порядок инициализации

**Пути сбоев, видимые пользователю.**

- **Неуспешный `prepareSpin()`** — `App.spin()` отображает причину через
  `prepareSpinFailureKey(reason)`: `spinInProgress → validation.spinInProgress`,
  `gameFinished → validation.gameFinished`, `noActiveLots → validation.noLotsToSpin`,
  `noValidWeights → validation.noValidWeights`. Показ — нативный `alert()`.
- **Исключение в `processRoll()`** — `App.finishSpin()` вызывает `gameSession.finishSpin()` в
  `try/catch`, логирует ошибку, открывает `ErrorDialog('error.spinProcessingFailed')`, обновляет
  состояние контролов и возвращается, **не** обновляя текст результата, подсветку и рендерер. Сбой
  обработки никогда не подаётся как обычное завершение спина.
- **Гонка блокировки при импорте** — если диалог конфликта был открыт до блокировки сессии, а его
  колбэк сработал уже после, `App.executeImport()` показывает
  `ErrorDialog('import.sessionLocked')`, а не молча выходит.

`App` никогда не вызывает `processRoll()`, `RouletteEngine.roll()` или `deactivateMany()` — это
живёт внутри `GameSession`.

**Порядок инициализации (`App`).**

1. Создаются `LotManager` и `GameSession` (сессия читает глобальный список через аксессор).
2. Резолвится canvas, создаётся `VisualizationDriver` (конструктор строит начальный рендерер по
   реестру и `AnimationController`).
3. Кэшируются DOM-хендлы, включая `LotListView` (список + отдельный `#sort-controls`).
4. `updateUI()`.
5. Слайдер и числовое поле длительности выставляются на дефолт 3 с.
6. Новому индикатору цвета лота выдаётся случайный цвет.
7. Тема резолвится из `localStorage` → системной настройки (`prefers-color-scheme`) → `'light'`,
   применяется через `applyTheme`, селект темы синхронизируется.
8. Текст результата выставляется в имя режима; заполняются тултипы режима и easing.
9. `setupEventListeners()`.

Точка входа: `DOMContentLoaded → startApp()` (внутри — `await initI18n()` и только затем
`new App()`); параллельно вызывается `translateDOM()`. Inline-скрипт в `<head>` уже применил тему
до первой отрисовки.

---

## 8. Ключевые потоки выполнения

### 8.1 Запуск

```
DOMContentLoaded
  └─ startApp()
       ├─ await initI18n()            // загрузка locales/{en,ru}.json, i18n.init
       ├─ new App()                   // построение LotManager/GameSession/Driver/View, навешивание событий
       └─ languageSelect.value = i18n.language
     translateDOM()                   // применение переводов к разметке
```

При этом inline-скрипт в `<head>` уже применил тему до первой отрисовки.

### 8.2 Спин

```
spin()
  ├─ gameSession.prepareSpin()
  │     ├─ отказ? (spinInProgress / gameFinished / noActiveLots / noValidWeights) → alert, выход
  │     └─ успех: roll(active, mode), pendingSpin={lot,mode}, sessionLocked=true, spinInProgress=true
  ├─ updateControlsState()            // отражаем блокировки в DOM
  └─ visualizationDriver.spinTo(...)
        ├─ computeFinalPosition(...)  // через VisualizationPackage
        ├─ AnimationController.configure(...).start()
        └─ на каждом кадре: renderer.setRotation(value); renderer.render()
             └─ onComplete → finishSpin()
                    └─ gameSession.finishSpin()   // processRoll, deactivate, gameFinished; finally spinInProgress=false
                         ├─ подсветка победителя, текст результата
                         ├─ updateUI() + refresh()
```

Детализированный псевдокод обеих границ жизненного цикла:

```
GameSession.prepareSpin()
  ├─ if spinInProgress → { ok: false, reason: 'spinInProgress' }
  ├─ if gameFinished   → { ok: false, reason: 'gameFinished' }
  ├─ if !canSpin(activeLots) → { ok: false, reason: 'noActiveLots' }
  ├─ modeAtDecision = currentMode                 // пин ОДИН раз, до броска (PlanB)
  ├─ rolledLot = RouletteEngine.roll(activeLots, modeAtDecision)   // РЕШЕНИЕ ЗДЕСЬ
  ├─ if !rolledLot → { ok: false, reason: 'noValidWeights' }
  ├─ pendingSpin = { rolledLot, mode: modeAtDecision }
  ├─ sessionLocked = true                          // живёт до reset()
  ├─ spinInProgress = true                         // снимается finishSpin()
  └─ { ok: true, lot: rolledLot }

App.finishSpin()
  ├─ try { outcome = gameSession.finishSpin() }
  │    catch → лог; ErrorDialog('error.spinProcessingFailed'); updateControlsState(); return
  ├─ if !outcome → updateControlsState(); return    // поздний onComplete после reset()
  ├─ { rolledLot, result } = outcome
  ├─ highlightedLotId = rolledLot.id; resultText = mode.getRollText(rolledLot)
  ├─ if result.finished: winner → highlightedLotId = winner.id; message → alert через 500 мс
  ├─ updateUI()                                      // путь рендера переприменяет блокировки
  └─ visualizationDriver.refresh(activeLots, mode)

GameSession.finishSpin()
  ├─ pending = pendingSpin; if !pending → return null
  ├─ pendingSpin = null                              // обнуляем ДО обработки
  ├─ { rolledLot, mode } = pending
  ├─ try:
  │     result = mode.processRoll(rolledLot, state)  // ПИНИРОВАННЫЙ режим — правила здесь
  │     if result.deactivate.length → deactivateMany(result.deactivate)
  │     if result.finished → gameFinished = true
  │     return { rolledLot, result }
  └─ finally: spinInProgress = false                 // снимается ВСЕГДА
```

### 8.3 Добавление лота

```
addLot()
  ├─ guard: sessionLocked? → выход
  ├─ lotManager.addLot(name, amount, color)
  │     └─ ошибка → ErrorDialog, форма сохраняется
  ├─ gameSession.addLot(lot)           // участие
  ├─ сброс формы, новый случайный цвет, фокус на имя
  └─ updateUI() + visualizationDriver.refresh(...)
```

### 8.4 Импорт

```
openImportDialog()
  └─ ImportDialog(parsedLots)          // CSV / Link, общий статус, превью
        └─ handleImport() → importCallback(parsedLots)
             └─ App.handleImportConflict(parsedLots)
                   ├─ existingCount == 0 → executeImport(MERGE)
                   └─ иначе ImportConflictDialog → strategy (или cancel)
                        └─ executeImport(parsedLots, strategy)
                              ├─ snapshot idsBefore
                              ├─ strategy.execute(parsedLots, lotManager)
                              ├─ gameSession.reconcileAfterBulkChange(idsBefore)
                              ├─ updateUI() + refresh()
                              └─ закрытие диалога (+ модал при усечении)
```

### 8.5 Разобранный пример: Survival с тремя лотами

Пусть активны A = 1302, B = 150, C = 148.5:

```
спин #1 → prepareSpin бросает B → finishSpin: deactivate B → активны {A, C}
        → finished = false → спин-тайм лок снят → следующий спин разрешён
спин #2 → prepareSpin бросает C → finishSpin: remaining = {A} → победитель A,
        finished = true → gameFinished = true → Spin выключен до Reset
```

Третьего спина не происходит. В режиме Normal один спин сразу даёт `finished = true` с разыгранным
лотом в роли победителя.

---

## 9. Инварианты и правила (сводка)

1. Победитель определяется в `prepareSpin()` **до** анимации; анимация на результат не влияет.
2. Режим пинится на время конкретного спина — применение (`finishSpin`) не может «уехать» от
   решения.
3. `GameSession.activeLotIds` — единственное состояние участия; `activeLots`/`state` всегда
   проецируются из актуального глобального списка (без кэша-снимка).
4. Глобальные лоты (`LotManager`) и участие в игре (`GameSession`) — два независимых
   состояния, синхронизируемые `App` при add/delete/clear/import.
5. `sessionLocked` — на всю сессию (до `reset()`); `spinInProgress` — на время спина;
   `gameFinished` — до `reset()`. `App` не хранит собственных копий этих флагов.
6. `spinInProgress` снимается в `finally` — исключение в `processRoll()` не «застревает»
   сессию в состоянии «крутится».
7. Отказ спина не меняет флаги жизненного цикла.
8. Единые источники правды: реестр визуализаций (`VisualizationPackage`) — для рендерера и
   математики позиции; `getSegmentWidth` — для ширины сегмента ленты; режимы — для веса и
   правил; локали — для текстов.
9. Раскладка «считалочки» детерминирована относительно набора id лотов (без `Math.random()`).
10. Тема применяется до первой отрисовки inline-скриптом, синхронно с логикой `App.applyTheme`.
11. **`render()` самодостаточен.** Каждый рендерер знает свой canvas; `IRenderer.render()` не
    принимает размеров, и `App` никогда не передаёт рендереру измерения canvas.
12. **Сессионная блокировка переживает сбой обработки.** После исключения в `processRoll()`
    `sessionLocked` остаётся `true`, а `gameFinished` — `false`; единственный выход — `reset()`.

---

## 10. Замечания и особенности реализации

- **Неиспользуемая разметка длительности**: `App` ищет элемент `#duration-value-number`, тогда
  как в `index.html` присутствует `#duration-value-unit`. В результате `durationValue` остаётся
  `null`, и промежуточное числовое значение длительности на экран не выводится (значение всё
  равно доступно в поле ввода и на слайдере).
- **Ключи локалей без реализации**: в `locales/*.json` есть ключи `settings.soundEffects`,
  `settings.soundOn/Off`, `importDialog.corsError`, `importDialog.fetching`,
  `importDialog.noValidLots` и часть `linkPlaceholder`/`linkTextareaPlaceholder`, которые в
  текущем коде не используются.
- **Смещение путей рендереров**: расчёт финальной позиции (угол/смещение/цикл) выполняется
  `RouletteEngine`, а отрисовка — конкретным `IRenderer`; они обязаны использовать общую
  геометрию сегментов, что и обеспечивается через `calculateSegments`/`getSegmentWidth`.
- **`importDialog` в `App`** уничтожается при закрытии (`destroy()`), чтобы не накапливать
  DOM-узлы и обработчики при повторном открытии.
- **Файл `technical-descriptiom.md`** (с опечаткой в имени) — устаревшая редакция описания. В
  настоящий документ из него перенесены только те сведения, что остаются верными для текущего кода
  (полный перечень типов, детали инвариантов жизненного цикла и констант рендереров, разобранный
  пример); расхождения (в частности, список тем и отсутствие `VisualizationDriver`/`LotListView`)
  сознательно не переносились.

**Технический долг / кандидаты на доработку.**

| # | Наблюдение | Влияние |
|---|---|---|
| 1 | `App.spin()` показывает отказ `prepareSpin()` нативным `alert()`, тогда как `executeImport()` и путь исключения в `finishSpin()` используют `ErrorDialog` | Два UX-паттерна для пользовательских ошибок; унификация была бы последовательнее |
| 2 | Guard-ы обработчиков смены режима и визуализации фактически недостижимы: селекты `disabled` ровно при тех же условиях, при которых сработал бы guard | Оставлены как защита в глубину; кандидаты на удаление при чистке |
| 3 | `updateControlsState()` вызывается императивно — из `updateUI()`, из `spin()` и из ветки `!outcome` в `finishSpin()` | Новый путь перерисовки, минующий `updateUI()`, не обновит состояние контролов; радикальное решение — уведомление о смене состояния из `GameSession` |
| 4 | При отклонении смены режим восстанавливается из `gameSession.mode.id`, а визуализация — из `settings.visualization` | Семантически верно (режим — состояние сессии, визуализация — UI), но стоит унифицировать в именовании |

---

## 11. Сборка и запуск

```bash
# Сборка (компиляция TS + копирование статики в dist/)
./build.sh

# Результат: dist/ содержит index.html, styles.css, favicon.ico, locales/,
# а также i18next.js, papaparse.min.js и скомпилированные *.js
```

Приложение открывается из `dist/index.html` (ES-модули требуют раздачи по HTTP, а не
`file://`). Автотесты в проекте отсутствуют.
