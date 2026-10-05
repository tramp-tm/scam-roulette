# Scam Roulette — техническое описание и бизнес-логика

Документ описывает структуру и реализацию приложения «Scam Roulette» (рулетка/розыгрыш
призов со взвешенной вероятностью): назначение модулей, модель данных, бизнес-правила,
жизненные циклы и потоки выполнения. Основано исключительно на исходном коде проекта
(`*.ts`, `index.html`, `locales/*`).

> **Статус: архитектура расширяемости.** Выполнен рефакторинг, в котором игровой режим и
> визуализация стали **независимыми взаимозаменяемыми стратегиями**:
>  - `Lot` — только постоянные данные; вся игровая специфика живёт в состоянии сессии;
>  - `GameMode` владеет своим состоянием и правилами (чистые переходы);
>  - результат хода обобщён (`TurnOutcome`: winners/eliminated/changed/finished);
>  - введены presentation-модель (`GameViewState`) и переход состояния (before → after);
>  - контракт визуализации — жизненный цикл, а не «координата рулетки»;
>  - `selectionWeight` (вероятность выбора) и `visualValue` (визуальный размер) разделены;
>  - геометрия (углы/ширины/сетка) — внутренняя для каждой визуализации, общего `Segment` нет;
>  - подсветка разделена: game-набор задаётся игрой, cursor вычисляется самой визуализацией;
>  - hover из списка лотов — отдельный аддитивный канал подсветки (`setHover`, по stable `lot.id`);
>  - данные режима для UI обобщены (`modeData.ext`): список выводит готовый текст, а смысл и
>    формат задаёт режим (HP, вероятность финальной победы, …);
>  - добавлен режим **Crown Defense** (`selectionWeight = 1`, `visualValue = HP`) — первое
>    доказательство расширяемости: без правок core и визуализаций.
> Поведение `Normal` и `Survival` сохранено 1:1.

---

## 1. Обзор приложения

Одностраничное веб-приложение (SPA) на чистом TypeScript без UI-фреймворка. Позволяет:

- вести список «лотов» (участников/призов) — имя, сумма, цвет;
- импортировать лоты из CSV-текста или из Google Sheets по ссылке;
- выбирать один из трёх игровых режимов (**Normal** / **Survival** / **Crown Defense**);
- выбирать одну из трёх визуализаций (**Wheel** / **Strip** / **Counting Rhyme**);
- запускать «спин» — анимацию, которая заканчивается уже заранее определённым победителем
  (взвешенный случайный выбор), после чего проигрывается переход состояния (например,
  выбывание лота);
- настраивать длительность анимации, функцию сглаживания (easing), язык и тему.

Ключевой принцип: **решение о результате принимается до начала анимации**. Анимация лишь
отображает уже принятое решение/переход и никогда на него не влияет.

Центральное архитектурное требование: **ни игровой режим не знает о способе визуализации,
ни визуализация не знает правил режима**. Связующий контракт — состояние игры, результат
хода, переход и presentation-модель.

---

## 2. Технологический стек и сборка

| Компонент | Значение |
|---|---|
| Язык | TypeScript (strict), компилируется в ES-модули (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`) |
| Целевая платформа | Браузер (DOM + Canvas 2D) |
| Рантайм-зависимости | `i18next` (локализация), `papaparse` (разбор CSV) |
| Dev-зависимости | `typescript`, типы `@types/i18next`, `@types/papaparse` |
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

Зависимости направлены «сверху вниз»; общие компоненты не знают о конкретных режимах и
визуализациях.

```
   Presentation ──▶  App (оркестратор UI)
                     ├── GameSession        (жизненный цикл, участие, состояние режима, spin)
                     └── VisualizationDriver (жизненный цикл визуализации)
                            │
                            ▼
                     Renderer (Wheel / Strip / CountingRhyme)  ──▶ BaseRenderer

   GameSession ──▶ GameMode (Normal/Survival/CrownDefense)     — правила и их состояние
                ──▶ RouletteEngine (взвешенный выбор, геометрия) — mode-agnostic
                ──▶ LotManager (глобальные лоты)                 — mode-agnostic

   Общие контракты: types.ts (домен + контракты), presentation.ts (view/transition helpers)
```

Распределение ответственности после рефакторинга:

```
App
 ├── UI orchestration
 ├── GameSession
 └── VisualizationDriver

GameSession
 ├── lifecycle (locks)
 ├── participation (participant set)
 ├── current mode
 ├── mode state (opaque)
 └── pending decision / transition

GameMode
 ├── mode state
 ├── rules
 ├── selection semantics (selectionWeight)
 ├── presentation semantics (visualValue, modeData)
 └── turn transition (pure)

VisualizationDriver
 ├── visualization lifecycle
 ├── renderer
 ├── spin animation
 └── outcome transition

Renderer
 └── purely visual representation (spin math + cursor internal)
```

Правила зависимостей:
- `RouletteEngine`, `GameMode`, `LotManager`, `GameSession` — доменный слой; не импортируют
  `App`, `VisualizationDriver` или рендереры.
- `LotListView` — презентационный компонент, который не знает ни о `LotManager`, ни о
  `GameSession`, ни о рендерерах; свои действия возвращает через колбэки.
- `VisualizationDriver` — единственная точка, через которую `App` общается с рендерингом и
  анимацией.
- `App` не содержит проверок вида `if (mode === …)` или `if (visualization === …)` — только
  значения по умолчанию и обращения к реестрам.

---

## 4. Карта модулей

| Файл | Роль |
|---|---|
| `app.ts` | Контроллер `App`: инициализация, обработка событий UI, оркестрация домена и визуализации |
| `types.ts` | Общие типы и контракты домена, режима и визуализации |
| `presentation.ts` | Presentation-хелперы: интерполяция view-состояния, game-highlight, длительность перехода |
| `lotManager.ts` | Глобальная коллекция лотов (CRUD, валидация, лимит) |
| `gameSession.ts` | Состояние текущей игры: участие, состояние режима, блокировки, спин-цикл, переход |
| `modes.ts` | Реестр режимов (`MODES`, `getMode`) |
| `normalMode.ts` | Режим Normal: правила, состояние, presentation |
| `survivalMode.ts` | Режим Survival: правила, состояние, presentation |
| `crownDefenseMode.ts` | Режим Crown Defense: HP-состояние, фиксированный урон, равный selection |
| `rouletteEngine.ts` | Взвешенный выбор по selection-весам; спин-таргет по геометрии рендерера |
| `animation.ts` | Easing-функции и `AnimationController` (requestAnimationFrame) |
| `visualizationDriver.ts` | Жизненный цикл визуализации: view state, spin, outcome transition, reset, cursor |
| `visualizationStrategy.ts` | Реестр `VisualizationPackage` (тип → фабрика рендерера) |
| `baseRenderer.ts` | Абстрактный базовый рендерер (презентация, High-DPI, highlight, hover, presence) |
| `wheelRenderer.ts` | Рендерер «колесо» |
| `stripRenderer.ts` | Рендерер «лента» (бесконечная прокрутка) |
| `countingRhymeRenderer.ts` | Рендерер «считалочка» (круги с подсветкой) |
| `lotListView.ts` | Компонент списка лотов (сортировка, редактирование, блокировка, highlight-набор, hover, ext-колонка) |
| `utils.ts` | Цвета (генерация/осветление), геометрия ленты, длительность, формат процентов |
| `i18n.ts` | Инициализация i18next, перевод DOM, синхронизация `lang`, хелпер `t` |
| `csvParser.ts` | Разбор CSV-текста в `ParsedLot[]` (через Papa Parse) |
| `importStrategies.ts` | Стратегии импорта `REPLACE` / `MERGE` |
| `importDialog.ts` | Диалог импорта с вкладками CSV / Link, превью |
| `csvTabContent.ts` | Вкладка «CSV»: textarea + выбор разделителя |
| `linkTabContent.ts` | Вкладка «Link»: загрузка Google Sheets по URL |
| `importConflictDialog.ts` | Диалог выбора стратегии при конфликте импорта |
| `modalDialog.ts` / `modalManager.ts` / `errorDialog.ts` | Модальные окна |
| `index.html` / `styles.css` | Разметка, inline-тема до первой отрисовки, стили и CSS-переменные тем |
| `locales/en.json`, `locales/ru.json` | Переводы (i18n) |
| `build.sh` | Скрипт сборки в `dist/` |

---

## 5. Модель данных

### 5.1 Глобальный лот и настройки

```ts
interface Lot {                 // Только постоянные данные. Без hp/lives/damage и т.п.
  id: string;
  name: string;
  amount: number;               // «сумма»; её смысл задаёт режим
  color: string;
}

interface Settings {            // Настройки приложения (тема и язык намеренно не входят)
  modeId: Mode;                 // 'normal' | 'survival' | 'crown-defense'
  visualization: VisualizationType; // 'wheel' | 'strip' | 'counting-rhyme'
  animationDuration: number;    // мс
}

interface MessageDescriptor {   // Отложенное локализуемое сообщение (режим отдаёт ключ, UI переводит)
  key: string;
  params?: Record<string, unknown>;
}
```

`Lot` **никогда** не расширяется игровыми свойствами. Всё, что существует только в рамках
конкретного режима и текущей игры, хранится в состоянии сессии.

### 5.2 Состояние режима и результат хода

```ts
type GameModeState = unknown;          // игровое состояние, принадлежит GameMode (непрозрачно для ядра)
type ParticipantModeState = unknown;   // состояние участника, принадлежит GameMode

interface ModeExtraInfo {              // одна ячейка ext-колонки списка лотов
  label: MessageDescriptor;            // заголовок колонки (локализует UI)
  value: string;                       // готовый к показу текст («♥ 90», «73.1%», «—»)
}
interface ModePresentationData {       // непрозрачные данные режима для UI
  ext?: ModeExtraInfo;                 // опциональная доп. колонка списка («ext»)
}

interface GameParticipantState {       // запись участника, которой владеет GameSession
  lotId: string;
  active: boolean;                     // участие в текущей игре
  modeState: ParticipantModeState;     // семантика известна только режиму
}

interface TurnOutcome {                // обобщённый результат ОДНОГО хода
  rolledLotId: string;
  winners: string[];                   // 0..n победителей
  eliminated: string[];                // 0..n выбывших
  changed: string[];                   // 0..n участников, у которых изменилось состояние
  finished: boolean;                   // достигнуто терминальное состояние
  result: MessageDescriptor;           // немедленный текст («Eliminated: B»)
  message?: MessageDescriptor;         // сообщение о завершении игры
  events?: TurnEvent[];                // опциональные события для UI/визуализации
}
```

`winner`/`deactivate` как скрытые спецслужаи отсутствуют: winners/eliminated/changed —
обычные списки.

### 5.3 Контракт режима (`GameMode`)

```ts
interface GameMode {
  readonly id: Mode;
  readonly name: string;               // ленивый геттер t('mode.<id>.name')
  readonly description: string;

  createGameState(lots: readonly Lot[]): GameModeState;
  createParticipantState(lot: Lot): ParticipantModeState;
  onParticipantsChanged(state, participants): GameModeState;

  calculateSelectionWeight(lot, participant, state): number;   // вероятность выбора рулеткой

  getParticipantVisualValue(lot, participant, state): number;  // визуальная величина для размера

  processRoll(rolledLot, rolled, participants, lots, state): {
    state: GameModeState;
    participants: GameParticipantState[];
    outcome: TurnOutcome;
  };

  getPresentationData(participants, lots, state): ReadonlyMap<string, ModePresentationData>;
}
```

Все переходы **чистые**: режим получает предыдущее состояние и возвращает новое, не мутируя
входы. Режим не обращается к DOM, `App`, `VisualizationDriver` или рендерерам. Режим задаёт две
**независимые** семантики: selection (`calculateSelectionWeight`) и presentation
(`getParticipantVisualValue` + `getPresentationData`). `visualValue` — абстрактная
величина, её смысл (amount / HP / score) знает только режим; визуализация его не интерпретирует.
`getPresentationData` вызывается **один раз на сборку view-состояния** и возвращает карту
`lotId → ModePresentationData`, поэтому режим может посчитать множественную презентацию
(например, вероятность финальной победы) один раз, а не на каждого участника.

### 5.4 Presentation-модель

```ts
interface RenderableParticipant {
  lot: Lot;
  active: boolean;
  selectionWeight: number;             // вероятность выбора рулеткой (НЕ размер!)
  visualValue: number;                 // визуальная величина; смысл задаёт режим
  presence: number;                    // визуальный множитель [0..1] (анимация выбывания)
  modeData?: ModePresentationData;     // режимные данные для UI (ext-колонка и будущее)
}

interface GameViewState {              // снимок игры для UI и визуализаций
  modeId: Mode;
  participants: RenderableParticipant[];
}

interface SelectionCandidate {         // вход RouletteEngine.rollWeighted
  lot: Lot;
  selectionWeight: number;
}

interface HighlightState {             // подсветка, управляемая игрой
  game: ReadonlySet<string>;           // победители / выбывшие (от игры)
  pulse: number;                       // масштаб game-подсветки во время перехода (0..1)
}

interface VisualizationTransition {    // контекст перехода одного хода
  before: GameViewState;
  after: GameViewState;
  outcome: TurnOutcome;
  rolledLotId: string;
}
```

`selectionWeight` и `visualValue` — **две независимые величины**. Геометрия конкретной
визуализации строится из `visualValue * presence`; `selectionWeight` в геометрию рисования не
попадает (он нужен выбору и тем визуальным механикам, что основаны на вероятности, например
«такт» считалочки). Нормировку `visualValue` делает сама визуализация, поэтому участник с
`presence: 1 → 0` сжимается, а остальные растут — переход выбывания получается из интерполяции
view-состояния (см. §7.4).

### 5.5 Контракт визуализации

```ts
interface IRenderer {                  // визуализация; чисто визуальная, правил не знает
  setViewState(view: GameViewState, highlight: HighlightState): void;  // game-подсветка (победители/выбывшие)
  setHover(lotId: string | null): void; // hover-подсветка из списка лотов (stable lot.id; null — снять)
  render(): void;
  reset(): void;

  getAnimationValue(): number;         // текущий скаляр (радианы / px / циклы)
  setAnimationValue(value: number): void;
  computeSpinTarget(rolledLotId: string, durationMs: number): number; // математика спина — внутри визуализации
  getCursorLotId(animationValue: number): string | null;             // курсор — внутри визуализации
}

interface VisualizationPackage {       // реестр: только фабрика
  id: VisualizationType;
  createRenderer(canvas: HTMLCanvasElement): IRenderer;
}
```

Рулет-специфичная математика (финальный угол/смещение/цикл) осталась внутренней реализацией
`Wheel`/`Strip`/`CountingRhyme` и вызывается ими через `RouletteEngine`. Новая визуализация
не обязана реализовывать понятие `targetLotId`, если её модель анимации иная.

---

## 6. Бизнес-логика

### 6.1 Управление лотами — `LotManager`

`LotManager` владеет **глобальным** списком лотов и ничего не знает про режимы и участие.

- `addLot(name, amount, color)` → `AddLotResult | AddLotError`:
  - имя после `trim()` не пустое → иначе `invalid_name`;
  - `amount` — конечное число > 0 → иначе `invalid_amount`;
  - количество лотов < `MAX_LOTS` (3000) → иначе `max_lots_reached`;
  - валидная сумма нормализуется: `max(0.01, parseFloat(amount))`; `id = lot_<timestamp>_<random>`.
- `updateLot(id, {name?, amount?, color?})`, `deleteLot(id)`, `getLotById(id)`,
  `clearAll()`, `getTotalCount()`, `getAllLots()` (возвращает копию).

`MAX_LOTS = 3000` используется и при импорте (лишние лоты отбрасываются — «truncated»).

### 6.2 Игровые режимы — `GameMode`

Реестр `modes.ts`:

```ts
export const MODES = {
    normal: new NormalMode(),
    survival: new SurvivalMode(),
    'crown-defense': new CrownDefenseMode()
};
export function getMode(modeId) { return MODES[modeId]; }
```

`name`/`description` — ленивые геттеры, вызывающие `t(...)` при каждом обращении, поэтому
смена языка немедленно обновляет название и описание режима.

**NormalMode**
- `selectionWeight = amount` (больше сумма → выше шанс);
- `visualValue = amount` (визуальный размер сектора совпадает с вероятностью);
- `processRoll` → `finished: true`, `winners: [rolledLot.id]`, `eliminated: []`;
- `result` = «Победитель: {{name}}». Одна игра = один спин.
- `getPresentationData` → ext = **вероятность финальной победы** `amount_i / Σ amount(active)`
  (в Normal нет выбываний, поэтому она равна текущей вероятности выбора). Inactive → `—`.

**SurvivalMode** (выбывание)
- `selectionWeight = 1 / amount` (больше сумма → ниже шанс выбыть);
- `visualValue = 1 / amount` (сохраняет прежний визуальный размер);
- `processRoll` смотрит на состояние **после** удаления разыгранного лота:
  - остаётся ровно один → он победитель (`finished: true`, `eliminated: [rolled]`);
  - не остаётся никого (спин по единственному активному) → разыгранный лот объявляется
    победителем, `eliminated: []` (вырожденный случай, чтобы игра корректно завершилась);
  - иначе → продолжение, `finished: false`, `eliminated: [rolled]`;
- `result` = «Выбыл: {{name}}», `message` = сообщение о победителе.
- `getPresentationData` → ext = **вероятность финальной победы** — гибрид: точная рекурсия по
  подмножествам `P(S,i) = Σ_{j≠i} p_j(S)·P(S\{j},i)`, `p_j = w_j/Σw(S)`, `w = 1/amount`
  (мемоизация) при числе активных ≤ `SURVIVAL_EXACT_MAX_ACTIVE` (18); свыше — детерминированная
  квадратура трапеций `P_i = ∫ λ_i·e^(−λ_i·t)·∏_{j≠i}(1 − e^(−λ_j·t)) dt`, `λ = 1/amount`,
  предел `T_max = (ln N + 11)/λ_min`, 1000 шагов (без симуляции). Inactive → `—`.

**CrownDefenseMode** (HP)
- `selectionWeight = 1` для каждого активного — вероятность не зависит от HP;
- `visualValue = текущее HP` — размер на экране определяется HP, а не вероятностью;
- состояние: `GameModeState = { maxAmount }` (референс нормализации HP на старте игры),
  `ParticipantModeState = { hp }` (HP участника). До первого спина HP детерминированно выводится
  из `amount / maxAmount * 100`; первый `processRoll` материализует его;
- `processRoll`: разыгранный участник урона не получает; все остальные **активные** получают
  фиксированный урон (10 HP), кламп в 0 — урон считается по состоянию ДО этого хода (без
  последовательной зависимости между участниками); участники с HP 0 выбывают; один оставшийся —
  победитель; несколько выбываний за один спин корректны;
- `result` = «Урон −{{damage}} (выбран: {{name}})», `message` = сообщение о победителе;
- HP не хранится на singleton-экземпляре режима и не добавляется в `Lot`, поэтому две сессии не
  делят HP.
- `getPresentationData` → ext = текущее HP как `♥ N` (целое). Inactive → `—`, никогда не stale HP.

Все режимы владеют своим состоянием и реализуют полный контракт `GameMode`, поэтому являются
равноправными стратегиями.

### 6.3 Движок рулетки — `RouletteEngine` (статические методы)

Движок принимает **предвычисленные selection-веса** (`SelectionCandidate[]`) и не знает ни про
режим, ни про визуализацию. Он не выводит размер визуальных объектов из весов.

- `rollWeighted(candidates)` — взвешенный выбор по `selectionWeight` методом кумулятивного
  распределения; `null`, если список пуст или суммарный вес ≤ 0. Единственный источник
  случайности в игре.
- `canSpin(activeCount)` — `activeCount >= 1`.
- `computeFinalRotation(targetStartAngle, targetEndAngle, currentRotation, durationMs)` —
  финальный угол колеса по переданному угловому диапазону целевого сектора (геометрию считает
  `WheelRenderer`). Указатель сверху (`-π/2`); внутри диапазона выбирается случайная точка (с
  отступом от краёв), затем добавляются полные обороты (2–5/с) — движение только «вперёд».
- `computeFinalScrollOffset(targetStartInCycle, targetSpan, cycleWidth, currentOffset, durationMs, canvasWidth)`
  — финальное смещение ленты по переданным пиксельным данным полосы (геометрию считает
  `StripRenderer`); плюс полные циклы (2–5/с).
- `computeFinalCountingPosition(targetMidFraction, currentPosition, durationMs)` — позиция
  «считалочки» в циклах; возврат `≡ targetMidFraction (mod 1)`, строго больше текущей, плюс
  `max(2, round(durationSec * 2))` циклов. Гарантирует, что последний кадр подсветит
  разыгранный лот.

Движок не знает про `visualValue`, `modeData`, HP, `Normal`/`Survival` или конкретные режимы и не
строит общий `Segment`/`startAngle`-контракт: угловая геометрия — внутренняя для `WheelRenderer`.
Целевой лот определяется **только** через selection, а спин-геометрия считается по уже выбранному
лоту (selection → rolledLot → animation geometry), не наоборот.

### 6.4 Сессия игры — `GameSession`

Центральный владелец состояния конкретной игры и её жизненного цикла.

**Владеет:**
- текущим `GameMode`;
- множеством участников `GameParticipantState[]` (`lotId` + `active` + `modeState`);
- игровым состоянием `modeState` (непрозрачно; трогается только через режим);
- жизненным циклом спина и блокировками;
- единственной точкой смены режима `setMode()`.

**Не владеет:** семантикой `modeState`; она известна только режиму.

**Проекции:**
- `activeLots` / `activeCount` — активные участники, спроецированные на актуальный глобальный
  список (без кэша-снимка);
- `isActive(id)` — участие;
- `viewState` — `GameViewState` (`selectionWeight`, `visualValue` и `modeData` считает режим).

**Мутации участия** (все отклоняются при `sessionLocked`):
- `addLot(lot)` — новый участник (`modeState = mode.createParticipantState(lot)`);
- `removeLot(id)`;
- `clearLots()`;
- `reconcileAfterBulkChange(previousIds)` — примирение после массового изменения (импорт):
  существовавший лот сохраняет прежний статус участия; появившийся — становится активным;
  исчезнувший — удаляется;
- `reset()` — очистка `pendingSpin`, сброс всех трёх флагов, участники = все глобальные лоты,
  `modeState` создаётся заново.

**Жизненный цикл спина — три флага:**
- `sessionLocked` — поднимается при первом успешном `prepareSpin()`, снимается только `reset()`;
  блокирует изменения уровня сессии (участие, режим, импорт, очистку);
- `spinInProgress` — истинно только между `prepareSpin()` и `finishSpin()`;
- `gameFinished` — истинно после `outcome.finished`, снимается только `reset()`.

**Неявный инвариант:** `spinInProgress === true` всегда влечёт `sessionLocked === true`, так
как оба флага поднимаются одним вызовом `prepareSpin()`, а `spinInProgress` снимается только
`finishSpin()`, который `sessionLocked` не трогает.

**`prepareSpin()`** возвращает `{ok:true, lot}` или `{ok:false, reason}` с одним из четырёх
оснований: `spinInProgress`, `gameFinished`, `noActiveLots`, `noValidWeights`.

При успехе: режим **пинится**, считается `selectionWeight` каждого активного участника, вызывается
`RouletteEngine.rollWeighted`, сохраняется контекст `pendingSpin` (разыгранный лот + участник +
режим + «before»-снимок состояния и view), затем атомарно поднимаются оба флага. При отказе
флаги и `pendingSpin` **не меняются**.

**`finishSpin()`** — применяет отложенный переход:
- если `pendingSpin` нет → `null`;
- `pendingSpin` обнуляется **до** применения;
- вызывается пинированный `mode.processRoll(rolledLot, rolled, beforeParticipants, lots, beforeState)`;
- сессия сохраняет новые `participants` и `modeState`; при `outcome.finished` поднимается
  `gameFinished`;
- возвращает `{ rolledLot, outcome, transition: {before, after, outcome, rolledLotId}, after }`;
- `spinInProgress` снимается в `finally` — даже если `processRoll()` бросает исключение;
  `sessionLocked` и `gameFinished` при этом не трогаются, а исключение пробрасывается наверх.

**`setMode(modeId)`** — единственная точка смены режима; отклоняется при `sessionLocked`.
Участие сохраняется; новый режим получает свежесозданное состояние для текущих участников.

### 6.5 Импорт

**Разбор CSV — `csvParser.ts`**
- `parseCSV(csvText, separator)` использует Papa Parse (`header:false`, `skipEmptyLines:true`,
  разделитель `,` или `\t`).
- Обязательны ≥ 2 колонок; имя (колонка 0) не пустое; сумма (колонка 1) — конечное число > 0.
- `normalizeAmount()` различает десятичный разделитель («1,234.56» en и «1.234,56» eu/ru).
- Автоопределение строки-заголовка: строка с некорректной суммой молча пропускается,
  **только** если это первая строка и после неё есть ещё хотя бы одна.
- Возврат: `{validLots, errorCount}`.

**Стратегии импорта — `importStrategies.ts`**
- `REPLACE_STRATEGY`: `clearAll()` и заново добавляет все разобранные лоты (новые id и цвета).
- `MERGE_STRATEGY`: совпадение по имени (без регистра) — обновляет сумму, иначе добавляет.
- Обе уважают `MAX_LOTS`, считая `lotsTruncated`.

**Оркестрация импорта в `App`** (`executeImport`):
1. проверка `isSessionLocked` → при блокировке `ErrorDialog(import.sessionLocked)` и выход;
2. снимок id-множества **до** стратегии (`idsBefore`);
3. `strategy.execute(parsedLots, lotManager)`;
4. `gameSession.reconcileAfterBulkChange(idsBefore)`;
5. `updateUI()` + `visualizationDriver.refresh(viewState, highlight)`;
6. закрытие диалога и, при `lotsTruncated > 0`, информационный модал.

### 6.6 Вспомогательные вычисления — `utils.ts`

- `generateRandomReadableColor()` — HSL (насыщенность 60–100%, светлота 20–45%).
- `brightenColor(color, percent)` — осветляет цвет лота. Понимает `#RGB`/`#RRGGBB`,
  `rgb()/rgba()` и `hsl()/hsla()` (приложение производит `rgb()` для добавленных вручную лотов
  и `hsl()` для импортированных); неизвестный формат возвращается без изменений.
- Геометрия ленты (strip-specific, не общий контракт): `MIN_BAND_WIDTH = 60`,
  `BAND_WIDTH_SCALE = 400`, `getStripBandWidth(fraction) = max(60, fraction * 400)` — ширина
  полосы из нормированной визуальной доли (`visualValue / Σ visualValue`). Используется только
  `StripRenderer`; движок её не знает.
- `normalizeToFractions(values)` — нейтральная нормировка набора неотрицательных величин в доли
  (Σ = 1); используется рендерерами для перевода `visualValue`/`selectionWeight` в геометрию.
- Отображение длительности: позиции слайдера 1–60 с отображаются напрямую; свыше — по таблице
  `DURATION_MAP` до 300 с; `sliderToDuration` / `durationToSlider`.
- `getRandomPositionInRange(span, edgeMarginPercent, maxEdgeMargin)` — случайная точка внутри
  сегмента с отступом от краёв.
- `formatPercent(p)` — проценты для UI: целое без дробной части («100%», «50%»), иначе одна
  цифра («42.5%», «7.1%»). Режимы используют её для ext-колонки.

### 6.7 Настройки времени, языка и темы

- **Длительность**: слайдер (нелинейная шкала 1–300 с) и числовое поле; хранится в
  миллисекундах (`settings.animationDuration`); поле валидируется по `change`.
- **Easing**: реестр `EasingFunctions` (`linear`, `easeOutCubic/Quart/Quint/Expo`, кастомный
  `rouletteEaseOut` — блендинг). Выбор хранится в `App.easingFunction`.
- **Язык (i18n)**: `i18n.ts` грузит `locales/en.json` и `locales/ru.json` параллельно, язык по
  `navigator.language`, fallback `en`. Перевод по `data-i18n`, `data-i18n-placeholder`,
  `data-i18n-title`; синхронизируется `<html lang>`.
- **Тема**: атрибут `data-theme` на `<html>`; переменные в `styles.css`; сохраняется в
  `localStorage('theme')`. Inline-скрипт в `<head>` применяет тему до первой отрисовки.
  Темы: dark, light, emerald, eucalyptus, nordic, monochrome, nebula.

---

## 7. Презентационный слой

### 7.1 `App` — контроллер (`app.ts`)

Создаётся после `initI18n()`. Не содержит mode-specific логики, не мутирует игровое состояние
и не знает структуру `modeState`.

Ключевые ссылки: `lotManager`, `gameSession`, `visualizationDriver`, `lotListView`, `settings`,
`easingFunction`, `gameHighlight: Set<string>` (game-подсветка, принадлежит `App`),
`hoveredLotId` (транзиентный hover), `outcomeInProgress`, `extEnabled` + `extToggle` (UI-тумблер
ext-колонки).

Основные операции:
- `addLot()` — guard `isSessionLocked`; `LotManager.addLot` (ошибка → `ErrorDialog`);
  `gameSession.addLot(lot)`; `updateUI()` + `refresh`.
- `spin()` — `gameSession.prepareSpin()`; отказ → `alert(prepareSpinFailureKey(reason))`;
  успех → `updateControlsState()` и `visualizationDriver.spinTo({view, highlight, targetLotId,
  durationMs, easing, onComplete: finishSpin})`.
- `finishSpin()` — `gameSession.finishSpin()` в `try/catch` (исключение →
  `ErrorDialog('error.spinProcessingFailed')`); выставляет текст результата из
  `outcome.result`; вычисляет game-highlight (`gameHighlightForOutcome`); играет переход
  (`visualizationDriver.animateOutcome`), после чего фиксирует highlight, вызывает
  `updateUI()` + `refresh(after)` и, при `outcome.message`, показывает сообщение.
- `reset()` — `gameSession.reset()`, очистка highlight, `visualizationDriver.reset(view)`,
  текст и UI.
- `deleteLot` / `handleClearLots` / `openImportDialog` / `handleImportConflict` /
  `executeImport` — guard-ы + согласованные операции над `LotManager` и `GameSession` (§6.5).
- `handleLotHover(id)` — hover строки списка: `visualizationDriver.setHover(id)`; чисто визуально
  и не зависит от блокировок.
- `handleAmountChange(id, amount)` — guard `sessionLocked`; `LotManager.updateLot` + `refresh`.
- Тумблер `ext` (`#ext-toggle`, кнопка `↔️` в шапке списка) — переключает `extEnabled`, класс
  `btn-primary`/`btn-secondary` (`applyExtToggleState()`) и вызывает `updateUI()`; доступен всегда.
- Смена режима (`#mode-select`) — `gameSession.setMode(...)`, затем `refresh` и `updateUI()`
  (список перерисовывается, т.к. `modeData`/ext зависят от режима).
- `updateUI()` — строит `RenderableLot[]` из `gameSession.viewState`, вызывает `LotListView.render`
  с `highlightIds = this.gameHighlight` и `extEnabled`, обновляет статистику (total из
  `LotManager`, active из `GameSession`), затем `updateControlsState()`.
- `updateControlsState()` — переносит блокировки в `disabled` (см. §7.5).

`App` не вычисляет курсор визуализации сам — за него это делает рендерер (§7.3, §7.4).
`settings.modeId` — только UI/persistence-зеркало; источник правды по режиму — `GameSession`.

### 7.2 `LotListView` — список лотов (`lotListView.ts`)

Чисто презентационный компонент: владеет DOM списка, сортировкой и `disabled`-состоянием
своих контролов; не импортирует `LotManager`, `GameSession`, `App`, рендереры и `t`.

- `render(lots: RenderableLot[], options)` — полная перерисовка, сортировка на копии;
  строки получают классы `inactive` / `highlighted`; для каждого лота — индикатор цвета, имя,
  поле суммы, (при `extEnabled`) ячейка ext-колонки, кнопка удаления (кроме подсвеченных).
- `options.highlightIds: ReadonlySet<string>` — набор game-highlight (победители/выбывшие).
- `options.onLotHover(lotId | null)` — hover строки сообщается наружу по stable `lot.id`
  (`mouseenter`/`mouseleave`; обработчики перевешиваются при каждой перерисовке, поэтому hover
  переживает сортировку). Список сам hover не хранит и в game-состояние не переводит; `App`
  прокидывает id в `VisualizationDriver.setHover`.
- `options.extEnabled` — показать доп. колонку `modeData.ext.value` (текст режима выводится
  **как есть**; список его не считает и не интерпретирует).
- `options.modeData` (в `RenderableLot`) переносится и, для `ext`, отображается; список не
  знает, что означает значение (HP, вероятность, балл, …).
- `setLocked(boolean)` — блокирует поля сумм и кнопки удаления.

### 7.3 `VisualizationDriver` — граница визуализации (`visualizationDriver.ts`)

Владеет canvas, текущим `IRenderer`, типом визуализации и `AnimationController`; управляет
жизненным циклом:

- `setVisualization(type, view, highlight)` — построить новый рендерер, показать снимок;
  перенести текущую hover-подсветку на новый рендерер (по stable `lot.id`);
- `refresh(view, highlight)` — показать снимок и перерисовать;
- `render()` — перерисовать без пересчёта (смена темы);
- `setHover(lotId | null)` — транзиентная hover-подсветка из списка лотов; чисто презентационная:
  перерисовывает кадр, не трогая view-состояние, анимацию и игровое состояние;
- `spinTo({view, highlight, targetLotId, durationMs, easing, onComplete})` — запросить у
  визуализации целевой скаляр (`computeSpinTarget`), вести `AnimationController`; на каждом
  кадре только `setAnimationValue` + `render` (курсор рендерер вычисляет сам);
- `animateOutcome({transition, highlight, durationMs, easing, onComplete})` — интерполировать
  view-состояние `before → after` (presence выбывших 1 → 0) через переиспользуемый
  интерполятор (без пересборки структур на кадр), рампить `pulse` game-подсветки; финальный
  кадр фиксирует стабильный `after`;
- `reset(view, highlight)` — остановить анимацию, сбросить рендерер (и hover), показать снимок;
- `getCursorLotId()` — read-only запрос текущего лота под курсором (для UI); сам курсор внутрь
  визуализации не передаётся.

Драйвер не знает правил режима; математика спина и семантика курсора — внутри визуализации.

### 7.4 Рендереры (Canvas 2D)

`BaseRenderer` владеет только презентацией: canvas/ctx, `participants`, `highlight`,
`animationValue`, картой `presence`, High-DPI и логическим размером (fallback 600×500). Он **не
строит никакой геометрии** и не хранит общих `Segment`/углов: каждый рендерер в
`onViewStateChanged()` сам выводит свою геометрию из `visualValue * presence`, а в `onReset()` её
очищает. Общий `Segment` с `startAngle/endAngle`, доступный всем визуализациям, не вводится.

- **`WheelRenderer`** — круг. Секторы заданы локальным типом `WheelSector { lot, startAngle,
  endAngle }`, углы — из нормированного `visualValue`. `WHEEL_MARGIN = 30`,
  `SECTOR_STROKE_WIDTH = 2`, `HIGHLIGHT_BRIGHTNESS = 30 + 45·pulse`; подписи на `0.7·radius`
  только при размахе > `LABEL_MIN_ARC = 0.1`; указатель — золотой треугольник сверху; кольца
  `radius + 10` и `radius − 5`. Таргет и курсор — по этим секторам (`getCursorLotId` ищет сектор
  по локальному углу `−π/2 − rotation`).
- **`StripRenderer`** — бесконечная лента. Локальный тип `StripBand { lot, startInCycle, width }`;
  ширины — из нормированного `visualValue` через `getStripBandWidth`. `render()` приводит
  смещение по модулю и рисует копии цикла (`getCyclesNeeded`). `BAND_HEIGHT = 160`, подписи
  повёрнуты на `−π/2`, центральный маркер — золотая пунктирная вертикаль; рамка
  `rgba(255,255,255,0.3)`, 4 px. Таргет и курсор — по полосам
  (`(offset + centerX) mod totalCycleWidth`).
- **`CountingRhymeRenderer`** — каждый лот — круг в детерминированной сетке (LCG, засеянный
  FNV-1a-хешем id; `Math.random()` не используется). **Радиус — из `visualValue * presence`**
  (визуальная величина), а **«такт»/таргет/курсор — из selection-разбиения** (`selectionWeight`),
  поэтому dwell круга пропорционален вероятности. Сетка ячеек кэшируется по набору id + размеру
  canvas и не пересчитывается на кадр перехода. Кроссфейд — `TRANSITION_FRACTION = 0.2`.
  Последний кадр гарантированно подсвечивает разыгранный лот.

Подсветка: `highlight.game` (победители/выбывшие) и собственный курсор рендерера рисуются
**независимо** и не затирают друг друга. Курсор рендерер вычисляет сам из `animationValue`
(`getCursorLotId`) и мемоизирует на кадр; `highlight.pulse` плавно вводит game-акцент во время
перехода. Все рендереры учитывают `presence` (альфа + сжатие) для анимации выбывания.

Hover (наведение в списке лотов) — **третий, независимый** канал подсветки (`setHover`,
identity — stable `lot.id`). Он рисуется **аддитивно**, поэтому сосуществует с game-подсветкой
и курсором, не заменяя их: Wheel — полупрозрачная glow-заливка (`rgba(127,212,255,0.25)`) плюс
голубая обводка (`#7fd4ff`) всего сектора, рисуется **поверх всех секторов**, чтобы соседние
бордюры не перекрывали края; Strip — обводка полосы (без изменения ширины/порядка);
CountingRhyme — внешнее гало вокруг круга (радиус не меняется). Hover не влияет на геометрию,
веса, таргет/анимацию и игровое состояние; неизвестный или неактивный id просто ничего не
подсвечивает.

### 7.5 Правила блокировки UI

`updateControlsState()` выводит `disabled` из флагов `GameSession` (+ `outcomeInProgress`):

| Контрол | Разблокирован когда |
|---|---|
| Spin | не идёт спин, игра не завершена и переход не проигрывается |
| Reset | всегда |
| Mode / Import / Clear | `!sessionLocked` |
| Add-row (имя/сумма/кнопка) | `!sessionLocked` |
| Поля сумм и удаление в списке | `!sessionLocked` |
| Duration / Visualization / Easing | не идёт спин, игра не завершена и переход не проигрывается |
| Сортировка | всегда |
| Toggle `ext` | всегда (чисто презентационный, игру не трогает) |

Обработчики помимо атрибута `disabled` дополнительно проверяют состояние на уровне `App`
(guard-ы). Для селектов при отклонённом изменении восстанавливается предыдущее значение.

### 7.6 Модальные окна

- `ModalManager` — синглтон: возрастающий `z-index`, стек открытых, повторный перевод.
- `ModalDialog` — базовый класс: overlay+content, закрытие по клику вне и по `Escape`
  (только для верхней модалки), хуки `onOpen`/`onClose`.
- `ErrorDialog` — заголовок + сообщение + OK (используется и как инфо-модал).
- `ImportConflictDialog` — кнопки стратегий (replace/merge/cancel) из `IMPORT_STRATEGIES`.

### 7.7 Обработка сбоев и порядок инициализации

**Пути сбоев, видимые пользователю.**
- **Неуспешный `prepareSpin()`** — `App.spin()` переводит `reason` через
  `prepareSpinFailureKey`: `spinInProgress → validation.spinInProgress`,
  `gameFinished → validation.gameFinished`, `noActiveLots → validation.noLotsToSpin`,
  `noValidWeights → validation.noValidWeights`. Показ — нативный `alert()`.
- **Исключение в `processRoll()`** — `App.finishSpin()` ловит его, логирует, открывает
  `ErrorDialog('error.spinProcessingFailed')`, обновляет контролы и возвращается, **не**
  обновляя текст/подсветку/рендерер. Сбой не подаётся как обычный спин.
- **Гонка блокировки при импорте** — `ErrorDialog('import.sessionLocked')` вместо молчаливого
  выхода.

`App` никогда не вызывает `processRoll()`, `RouletteEngine.rollWeighted()` или внутренние
мутации `GameSession`.

**Порядок инициализации (`App`).**
1. `LotManager`, `GameSession`;
2. canvas → `VisualizationDriver` (строит начальный рендерер и `AnimationController`);
3. DOM-хендлы, `LotListView` (список + `#sort-controls`);
4. `updateUI()`;
5. слайдер/поле длительности → дефолт 3 с;
6. случайный цвет индикатора нового лота;
7. тема: `localStorage` → системная (`prefers-color-scheme`) → `'light'`; `applyTheme`; селект;
8. текст результата = имя режима; тултипы режима/easing;
9. `setupEventListeners()`.

Точка входа: `DOMContentLoaded → startApp()` (`await initI18n()` затем `new App()`);
параллельно `translateDOM()`. Inline-скрипт в `<head>` уже применил тему.

---

## 8. Ключевые потоки выполнения

### 8.1 Запуск

```
DOMContentLoaded
  └─ startApp()
       ├─ await initI18n()            // загрузка locales/{en,ru}.json, i18n.init
       ├─ new App()                   // LotManager/GameSession/Driver/View, обработчики
       └─ languageSelect.value = i18n.language
     translateDOM()
```

### 8.2 Спин и переход состояния

```
spin()
  ├─ gameSession.prepareSpin()
  │     ├─ отказ? (spinInProgress / gameFinished / noActiveLots / noValidWeights) → alert, выход
  │     └─ успех: selectionWeight участников → rollWeighted, pendingSpin={лот,участник,режим,before}, locks
  ├─ updateControlsState()
  └─ visualizationDriver.spinTo({view, highlight, targetLotId, ...})
        ├─ renderer.setViewState(view); end = renderer.computeSpinTarget(targetLotId, duration)
        ├─ AnimationController 0..end: setAnimationValue + render (курсор рендерер считает сам)
        └─ onComplete → finishSpin()
              ├─ outcome = gameSession.finishSpin()   // mode.processRoll → новые state/participants/outcome
              ├─ resultText = t(outcome.result)
              ├─ visualizationDriver.animateOutcome({transition: before→after, highlight, ...})
              │     └─ интерполяция view (presence выбывших → 0), pulse game-подсветки
              └─ onComplete: gameHighlight = outcome, updateUI(), refresh(after)
```

Решение и переход определяются **до** визуализации: `prepareSpin()` решает, `finishSpin()`
применяет чистый переход режима; анимация лишь интерполирует уже вычисленное `before → after`.

### 8.3 Добавление лота

```
addLot()
  ├─ guard: sessionLocked? → выход
  ├─ lotManager.addLot(name, amount, color)   // ошибка → ErrorDialog
  ├─ gameSession.addLot(lot)                   // участие (+ modeState)
  ├─ сброс формы, новый цвет, фокус на имя
  └─ updateUI() + visualizationDriver.refresh(viewState, highlight)
```

### 8.4 Импорт

```
openImportDialog() → ImportDialog(CSV/Link) → handleImportConflict(parsedLots)
  ├─ existingCount == 0 → executeImport(MERGE)
  └─ иначе ImportConflictDialog → strategy (или cancel)
       └─ executeImport(parsedLots, strategy)
             ├─ snapshot idsBefore
             ├─ strategy.execute(...)
             ├─ gameSession.reconcileAfterBulkChange(idsBefore)
             ├─ updateUI() + refresh(...)
             └─ закрытие диалога (+ модал при усечении)
```

### 8.5 Разобранный пример: Survival с тремя лотами (A=1302, B=150, C=148.5)

```
спин #1 → prepareSpin бросает B → finishSpin: eliminated=[B] → активны {A, C}
        → outcome.finished=false → спин-лок снят → переход (B сжимается)
спин #2 → prepareSpin бросает C → finishSpin: remaining={A} → winners=[A], eliminated=[C],
        finished=true → gameFinished=true → Spin выключен до Reset
```

Третьего спина не происходит. Для Normal один спин сразу даёт `finished=true` с `winners=[rolled]`.

---

## 9. Инварианты и правила (сводка)

1. Решение принимается в `prepareSpin()` **до** анимации; анимация на результат не влияет.
2. Режим пинится на время конкретного спина — применение (`finishSpin`) не может «уехать» от
   решения.
3. `GameParticipantState[]` — единственное состояние участия; `activeLots`/`viewState` всегда
   проецируются из актуального глобального списка (без кэша-снимка).
4. Глобальные лоты (`LotManager`) и игра (`GameSession`) — два независимых состояния,
   синхронизируемые `App` при add/delete/clear/import.
5. Три блокировки: `sessionLocked` (до `reset()`), `spinInProgress` (на время спина),
   `gameFinished` (до `reset()`); `spinInProgress ⇒ sessionLocked`. `App` не хранит копий.
6. `spinInProgress` снимается в `finally` — исключение в `processRoll()` не «застревает».
7. Отказ спина не меняет ни флаги, ни `pendingSpin`.
8. Все переходы режима чистые; `modeState` и `modeData` непрозрачны для ядра.
9. `selectionWeight ≠ visualValue`: выбор участника определяется только `selectionWeight`, а
   размер/представление — только `visualValue` (× `presence`). Изменение одного не меняет другое.
10. `RouletteEngine` знает только selection и roulette-механику: он не выводит визуальный размер
    из веса и не знает про `visualValue`/`modeData`/конкретные режимы.
11. Геометрия визуализации — её собственная: `startAngle/endAngle` (Wheel), ширина полосы (Strip),
    сетка/радиус (Counting) не являются общим контрактом; общего `Segment` нет.
12. Подсветка: game-набор приходит извне; cursor рендерер вычисляет сам из `animationValue` и
    не смешивает его с game.
13. `render()` самодостаточен: рендерер сам знает canvas, математику спина и курсор.
14. Сессионная и игровая блокировки переживают сбой обработки; единственный выход — `reset()`.

---

## 10. Расширяемость

**Новый игровой режим** (например, Crown Defense с HP):
1. реализовать класс `GameMode` (свои `GameModeState`/`ParticipantModeState`, чистый
   `processRoll` с несколькими изменениями/победителями и `changed`, `calculateSelectionWeight`,
   `getParticipantVisualValue`, `getPresentationData`);
2. зарегистрировать в `MODES` (`modes.ts`) и расширить union `Mode`;
3. добавить локализацию.
`App`, `GameSession`, `RouletteEngine`, `VisualizationDriver` и существующие визуализации
менять не требуется. Например, Crown Defense задаёт `selectionWeight = 1` для активных и
`visualValue = текущее HP` — вероятность выбора и визуальный размер независимы. **Crown Defense
реализован именно так** (`crownDefenseMode.ts`) — без правок core и визуализаций.

**Новая визуализация**:
1. реализовать `IRenderer` (унаследовать `BaseRenderer`), построить собственную геометрию из
   `visualValue * presence` в `onViewStateChanged`, реализовать `computeSpinTarget` и, при
   наличии, `getCursorLotId`;
2. зарегистрировать `VisualizationPackage` в `VISUALIZATION_PACKAGES` (`visualizationStrategy.ts`)
   и расширить union `VisualizationType`.
`App`, `GameSession`, режимы и существующие визуализации менять не требуется.

Общий принцип: реестры (`MODES`, `VISUALIZATION_PACKAGES`) — единственные точки расширения;
`App`/`GameSession` не содержат `switch`/`if` по идентификаторам режимов и визуализаций.

---

## 11. Замечания и технический долг

- **Неиспользуемая разметка длительности**: `App` ищет `#duration-value-number`, тогда как в
  `index.html` присутствует `#duration-value-unit`; `durationValue` остаётся `null` (значение
  доступно в поле ввода и на слайдере).
- **Ключи локалей без реализации**: `settings.soundEffects`, `settings.soundOn/Off`,
  `importDialog.corsError`, `importDialog.fetching`, `importDialog.noValidLots`, часть
  `linkPlaceholder`/`linkTextareaPlaceholder`.
- **Два UX-паттерна ошибок**: отказ `prepareSpin()` показывается нативным `alert()`, тогда как
  импорт и путь исключения используют `ErrorDialog`.
- **Guard-ы смены режима/визуализации** фактически недостижимы (селекты `disabled` ровно при
  тех же условиях) — оставлены как защита в глубину.
- **`updateControlsState()` императивен** (из `updateUI()`, `spin()`, ветки `!result` в
  `finishSpin()`); радикальное решение — уведомление о смене состояния из `GameSession`.
- **«Считалочка» — согласовано**: «такт»/таргет/курсор используют selection-разбиение
  (`selectionWeight`), не меняющееся во время перехода, а радиус — `visualValue * presence`;
  сетка ячеек кэшируется, поэтому подсветка не «прыгает» и раскладка не пересчитывается на кадр.
- **Transition — минимальный**: анимация перехода — линейная интерполяция `visualValue` и
  `presence` независимо друг от друга; модель задаёт драйвер, визуализация отвечает только за
  отрисовку. Полноценная хореография перехода на уровне конкретной визуализации — возможный
  следующий этап.
- **Курсор Wheel/Strip следует за рисованной геометрией**: во время перехода (когда меняется
  `visualValue`/`presence`) курсор может смещаться вместе с геометрией — это ожидаемо, он
  указывает на реально нарисованный сектор. У «считалочки» тайминг от вероятности, поэтому
  стабилен.
- **ext-колонка (Survival)**: вероятность финальной победы считается один раз на сборку
  view-состояния (`getPresentationData`). До `SURVIVAL_EXACT_MAX_ACTIVE = 18` активных — точная
  DP по подмножествам (O(2^n·n), мемоизация); свыше — детерминированная квадратура трапеций
  (1000 шагов, `T_max = (ln N + 11)/λ_min`), приближённая с погрешностью ≤ ~1e-5 (хвост ≤ e^(−11)),
  что многократно ниже разрешения отображения (0.1%). Симуляция не используется; `…` больше не
  выводится. Normal/Crown — дешёвые O(n).
- **ext-колонка (UI)**: тумблер — кнопка `↔️` в шапке списка (`btn-primary` ON / `btn-secondary`
  OFF), доступен всегда. Переключение не меняет ширину блока Lots: колонка укладывается в уже
  существующую ширину строки, а в строке добавления нет искусственного «спейсера» — правые
  элементы (×, ➕) прижаты к краю растянутым полем имени.
- **`importDialog` в `App`** уничтожается при закрытии (`destroy()`), чтобы не накапливать
  DOM-узлы и обработчики.
- **`brightenColor`** теперь понимает `rgb()`/`hsl()`/hex (ранее подсветка `rgb()`/`hsl`-цветов
  давала чёрный) и возвращает исходный цвет для неизвестного формата.

---

## 12. Сборка и запуск

```bash
# Сборка (компиляция TS + копирование статики в dist/)
./build.sh

# Результат: dist/ содержит index.html, styles.css, favicon.ico, locales/,
# а также i18next.js, papaparse.min.js и скомпилированные *.js
```

Приложение открывается из `dist/index.html` (ES-модули требуют раздачи по HTTP, а не
`file://`). Автотесты в проекте отсутствуют.
