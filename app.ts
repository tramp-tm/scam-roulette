import i18n, { t, translateDOM, initI18n, syncDocumentLang } from './i18n.js';
import { LotManager } from './lotManager.js';

import { EasingFunctions, DEFAULT_EASING } from './animation.js';
import { VisualizationDriver } from './visualizationDriver.js';
import { GameSession } from './gameSession.js';
import { VisualizationType, Settings, Mode, GameMode, RenderableLot, LotsListRenderOptions, ParsedLot, ImportStrategy, SortField, SortDirection, EasingFunction, PrepareSpinFailureReason, Lot, RollResult } from './types.js';
import { MERGE_STRATEGY } from './importStrategies.js';
import { 
    generateRandomReadableColor, 
    sliderToDuration, 
    durationToSlider, 
    MIN_DURATION_SEC,
    MAX_DURATION_SEC
} from './utils.js';
import { ImportDialog } from './importDialog.js';
import { ImportConflictDialog } from './importConflictDialog.js';
import { ErrorDialog } from './errorDialog.js';


// Оберните инициализацию приложения или просто вызовите функцию на старте:
async function startApp() {
    try {
        await initI18n();
        console.log('i18n готов, приложение запускается...');

        // Initialize the app first
        const app = new App();

        // Now initialize language select properly since i18n is definitely ready
        if (app.languageSelect) {
            app.languageSelect.value = i18n.language;
        }
    } catch (err) {
        console.error('Ошибка инициализации приложения:', err);
    }
}



/**
 * Main application controller for the roulette game.
 */
export class App {


    private lotManager: LotManager;
    private gameSession: GameSession;
    private visualizationDriver: VisualizationDriver;
    
    private settings: Settings = {
        modeId: 'normal',
        visualization: 'wheel',
        animationDuration: 3000
    };
    
    // Easing function setting - source of truth for user preference
    private easingFunction: EasingFunction = DEFAULT_EASING;
    
    /**
     * Current game mode, delegated to the active GameSession.
     * `GameSession` is the single source of truth for the current mode
     * (§3 of the Stage 2 plan); `settings.modeId` is a UI/persistence
     * record only and is never read back to drive the session.
     */
    get mode(): GameMode {
        return this.gameSession.mode;
    }
    
    private highlightedLotId: string | null = null;
    private importDialog: ImportDialog | null = null;
    
    // Sort state
    private sortField: SortField = 'name';
    private sortDirection: SortDirection = 'asc';

    // DOM elements
    private canvas: HTMLCanvasElement;
    private resultDisplay: HTMLElement | null = null;
    private resultText: HTMLElement | null = null;
    private spinBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    private importBtnControls: HTMLButtonElement;
    private clearBtnControls: HTMLButtonElement;
    
    // Lots list elements
    private lotsList: HTMLUListElement;
    
    // Add row elements (inline at bottom of lots table)
    private lotNameInput: HTMLInputElement;
    private lotAmountInput: HTMLInputElement;
    private addBtn: HTMLButtonElement;
    private newLotColorIndicator: HTMLElement;
    
    // Settings elements
    private modeSelect: HTMLSelectElement | null = null;
    private visualizationSelect: HTMLSelectElement | null = null;
    private durationSlider: HTMLInputElement | null = null;
    private durationInput: HTMLInputElement | null = null;
    private durationValue: HTMLElement | null = null;
    private easingSelect: HTMLSelectElement | null = null;
    public languageSelect: HTMLSelectElement | null = null;
    private themeSelect: HTMLSelectElement | null = null;

    
    // Sort control elements
    private sortByNameBtn: HTMLButtonElement | null = null;
    private sortByAmountBtn: HTMLButtonElement | null = null;
    
    // Settings toggle element
    private settingsToggleBtn: HTMLButtonElement | null = null;

    constructor() {
        this.lotManager = new LotManager([]);
        // Stage 3: `LotManager` owns the *global* lot list; `GameSession`
        // owns the *current game* (mode + participation state). The session
        // reads the global list through this accessor so it never caches a
        // stale snapshot, while its participation set (`activeLotIds`) is
        // its own — see gameSession.ts and refac3.md §2–§7.
        this.gameSession = new GameSession(
            this.settings.modeId,
            () => this.lotManager.getAllLots()
        );

        // The canvas must be resolved before the visualization driver is
        // built — the driver constructs the initial renderer in its
        // constructor.
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;

        // VisualizationDriver owns the renderer + animation controller + canvas.
        // `App` talks to the visualization pipeline only through this boundary
        // (app-refac-task.md §§1–7).
        this.visualizationDriver = new VisualizationDriver(
            this.canvas,
            this.settings.visualization
        );

        // Initialize DOM elements
        this.resultDisplay = document.getElementById('result-display');
        this.resultText = document.getElementById('result-text');
        this.spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        this.importBtnControls = document.getElementById('import-btn-controls') as HTMLButtonElement;
        this.clearBtnControls = document.getElementById('clear-btn-controls') as HTMLButtonElement;
        
        // Lots list elements
        this.lotsList = document.getElementById('lots-list') as HTMLUListElement;
        
        // Add row elements (inline at bottom of lots table)
        this.lotNameInput = document.getElementById('new-lot-name') as HTMLInputElement;
        this.lotAmountInput = document.getElementById('new-lot-amount') as HTMLInputElement;
        this.addBtn = document.getElementById('add-lot-btn') as HTMLButtonElement;
        this.newLotColorIndicator = document.getElementById('new-lot-color-indicator') as HTMLElement;
        
        // Settings elements
        this.modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
        this.visualizationSelect = document.getElementById('visualization-select') as HTMLSelectElement;
        this.durationSlider = document.getElementById('duration-slider') as HTMLInputElement;
        this.durationInput = document.getElementById('duration-input') as HTMLInputElement;
        this.durationValue = document.getElementById('duration-value-number');
        this.easingSelect = document.getElementById('easing-select') as HTMLSelectElement;
        this.languageSelect = document.getElementById('language-select') as HTMLSelectElement;
        this.themeSelect = document.getElementById('theme-select') as HTMLSelectElement;

        
        // Sort control elements
        this.sortByNameBtn = document.getElementById('sort-by-name') as HTMLButtonElement;
        this.sortByAmountBtn = document.getElementById('sort-by-amount') as HTMLButtonElement;
        
        // Settings toggle button
        this.settingsToggleBtn = document.getElementById('toggle-settings-subblock') as HTMLButtonElement;

        // Initialize UI
        this.updateUI();
        
        // Set initial slider and number input positions based on default duration (3s)
        if (this.durationSlider && this.durationInput) {
            const initialSeconds = 3; // Default 3 SECONDS
            this.durationSlider.value = String(durationToSlider(initialSeconds));
            this.durationInput.value = String(initialSeconds);
            
            // Update the display value as well
            if (this.durationValue) {
                this.durationValue.textContent = initialSeconds.toFixed(1);
            }
        }
        
        // Set initial random color for new lot indicator
        this.newLotColorIndicator.style.backgroundColor = generateRandomReadableColor();

        // Apply the saved theme preference (defaults to dark) and sync the selector
        let savedTheme = 'dark';
        try {
            savedTheme = localStorage.getItem('theme') || 'dark';
        } catch (e) {
            // localStorage may be unavailable (e.g. private mode); fall back to dark
        }
        this.applyTheme(savedTheme);
        if (this.themeSelect) {
            this.themeSelect.value = savedTheme;
        }
        
        // Update result display with current mode name initially
        if (this.resultText) {
            this.updateResultTextWithModeName();
        }
        
        // Event listeners
        this.setupEventListeners();
        
    }

    /**
     * Updates result text to show current mode name when no winner is highlighted.
     */
    private updateResultTextWithModeName(): void {
        if (this.resultText && !this.highlightedLotId) {
            this.resultText.textContent = this.mode.name;
        }
    }

    /**
     * Maps a `GameSession.prepareSpin()` failure reason (A2 §2) to its
     * i18n key. The four cases are exactly the current early-return
     * branches in `GameSession.prepareSpin()` — no hypothetical states.
     */
    private prepareSpinFailureKey(reason: PrepareSpinFailureReason): string {
        switch (reason) {
            case 'spinInProgress': return 'validation.spinInProgress';
            case 'gameFinished':   return 'validation.gameFinished';
            case 'noActiveLots':   return 'validation.noLotsToSpin';
            case 'noValidWeights': return 'validation.noValidWeights';
        }
    }

    /**
     * Applies the given theme to the document and persists the preference.
     * The theme drives CSS custom properties defined on :root / :root[data-theme="light"].
     */
    private applyTheme(theme: string): void {
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem('theme', theme);
        } catch (e) {
            // Ignore storage errors (e.g. private browsing); theme still applies for the session
        }
    }

    private setupEventListeners(): void {
        // Inline add lot button (at bottom of lots table)
        this.addBtn.addEventListener('click', () => this.addLot());
        
        // Allow Enter key to submit in name input
        this.lotNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.addLot();
            }
        });
        
        // Spin button
        this.spinBtn.addEventListener('click', () => this.spin());
        
        // Reset button
        this.resetBtn.addEventListener('click', () => this.reset());
        
        // Import button - opens import dialog component
        this.importBtnControls.addEventListener('click', () => {
            this.openImportDialog();
        });
        
        // Clear button - clears all lots with confirmation
        this.clearBtnControls.addEventListener('click', () => {
            this.handleClearLots();
        });
        
        // Settings changes
        this.modeSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;

            // The mode is immutable after the session starts (planA.md §14):
            // reject the change (and restore the previous visible value)
            // rather than only relying on the disabled attribute.
            // A1 §3: `spinInProgress ⇒ sessionLocked`, so the session lock
            // alone gates this session-level operation.
            if (this.gameSession.isSessionLocked) {
                target.value = this.gameSession.mode.id;
                return;
            }

            const newModeId = target.value as Mode;

            // Single point of mode change (§3). GameSession owns the current
            // mode; `settings.modeId` is kept in sync only as a UI /
            // persistence record and is never read back to drive the session.
            this.gameSession.setMode(newModeId);
            this.settings.modeId = newModeId;

            // Re-render wheel with the new mode's weight calculation. The
            // session's participation set is deliberately preserved across a
            // mode switch (matches the behaviour shipped in Stage 1/2 — the
            // Stage 3 plan §13 keeps this behaviour).
            this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
            // Update result text to show new mode name if no winner highlighted
            this.updateResultTextWithModeName();
        });
        
        this.visualizationSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;

            // Visualization cannot change mid-animation; between spins of an
            // unfinished game it is editable, like duration and easing.
            // A1 (finished-game UI): once the game has finished, this select
            // is disabled, so the guard now covers both cases and matches
            // the derived `spinTimeLocked` state in updateControlsState().
            if (this.gameSession.isSpinInProgress || this.gameSession.isGameFinished) {
                target.value = this.settings.visualization;
                return;
            }

            this.settings.visualization = target.value as VisualizationType;
            
            // Recreate renderer with new visualization type and refresh — the
            // swap is entirely contained in the visualization boundary.
            this.visualizationDriver.setVisualization(
                this.settings.visualization,
                this.gameSession.activeLots,
                this.gameSession.mode
            );
        });
        

        // Duration slider - uses non-linear mapping for better control at lower values
        this.durationSlider?.addEventListener('input', () => {
            if (this.durationSlider) {
                const seconds = sliderToDuration(parseInt(this.durationSlider.value)); // Returns SECONDS
                this.settings.animationDuration = Math.round(seconds * 1000); // Store as ms

                // Update number input and display value in SECONDS
                if (this.durationInput) {
                    this.durationInput.value = String(Math.round(seconds));
                }
                if (this.durationValue) {
                    this.durationValue.textContent = seconds.toFixed(1);
                }
            }
        });

        // Duration number input - validate and correct on blur/enter only
        this.durationInput?.addEventListener('change', () => {
            if (this.durationInput) {
                let seconds = parseFloat(this.durationInput.value);
                
                // Correct invalid value to closest valid [MIN_DURATION_SEC, MAX_DURATION_SEC] SECONDS
                if (isNaN(seconds)) {
                    seconds = MIN_DURATION_SEC; // Default to minimum if not a number
                } else {
                    seconds = Math.max(MIN_DURATION_SEC, Math.min(MAX_DURATION_SEC, seconds)); // Clamp to range
                }
                
                this.settings.animationDuration = Math.round(seconds * 1000); // Store as ms
                
                // Update slider position using durationToSlider with SECONDS (nearest allowed position)
                if (this.durationSlider) {
                    this.durationSlider.value = String(durationToSlider(seconds));
                }
                if (this.durationValue) {
                    this.durationValue.textContent = seconds.toFixed(1);
                }
                
                // Update the input field to show corrected value
                this.durationInput.value = String(Math.round(seconds));
            }
        });
        
        // Easing function select - updates App.settings.easingFunction on change
        this.easingSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const easingName = target.value;
            
            // Map selected value to actual easing function from EasingFunctions object
            switch (easingName) {
                case 'easeOutCubic':
                    this.easingFunction = EasingFunctions.easeOutCubic;
                    break;
                case 'easeOutQuart':
                    this.easingFunction = EasingFunctions.easeOutQuart;
                    break;
                case 'easeOutQuint':
                    this.easingFunction = EasingFunctions.easeOutQuint;
                    break;
                case 'easeOutExpo':
                    this.easingFunction = EasingFunctions.easeOutExpo;
                    break;
                case 'linear':
                    this.easingFunction = EasingFunctions.linear;
                    break;
                default: // rouletteEaseOut is the default
                    this.easingFunction = EasingFunctions.rouletteEaseOut;
            }
        });


        // Language select - changes i18n language and re-translates DOM
        this.languageSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const newLang = target.value;


            // Change language using i18next
            i18n.changeLanguage(newLang, () => {
                // Re-translate all DOM elements after language change
                translateDOM();

                // Keep <html lang> in sync so screen readers / font shaping use the right locale
                syncDocumentLang();

                // Update result text to show mode name in new language (if no winner)
                this.updateResultTextWithModeName();

            });
        });

        // Theme select - applies the theme and persists the preference
        this.themeSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.applyTheme(target.value);

            // Re-render so canvas-based visuals pick up the new theme (if applicable)
            this.visualizationDriver.render();
        });

        
        // Sort switch buttons - unified handler for both buttons
        const sortButtons = document.querySelectorAll('#sort-controls .switch-btn');
        sortButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetField = (button as HTMLElement).dataset.sortField;
                if (!targetField) return;
                
                // Update active state visually
                sortButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Set sort field and toggle direction if same field
                this.setSortField(targetField as SortField);
            });
        });
        
        // Settings sub-block toggle button
        if (this.settingsToggleBtn) {
            this.settingsToggleBtn.addEventListener('click', () => {
                const subBlock = document.getElementById('settings-subblock') as HTMLElement;
                if (subBlock) {
                    subBlock.classList.toggle('hidden');
                    
                    // Update button text to indicate state
                    this.settingsToggleBtn!.textContent = subBlock.classList.contains('hidden') ? '⁝' : '✕';
                }
            });
        }
    }


    /** Sets the sort field and toggles direction if same field */
    private setSortField(field: SortField): void {
        // If clicking same field, toggle direction; otherwise default to ascending
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }
        
        // Update button visual states
        this.updateSortButtons();
        
        // Re-render lots list with new sort order.
        //
        // Sorting is strictly a presentation operation (planA.md §11): it
        // never touches `GameSession.activeLotIds`. It does, however,
        // rebuild the `#lots-list` DOM from scratch, so any lock state on
        // the freshly created amount inputs / delete buttons must be
        // re-applied — `renderLotsList()` now does that itself (A1 — single
        // authoritative derivation point).
        this.renderLotsList();
    }
    
    /** Updates visual state of sort buttons */
    private updateSortButtons(): void {
        if (!this.sortByNameBtn || !this.sortByAmountBtn) return;
        
        // Get translated labels
        const nameLabel = t('sort.byName');
        const amountLabel = t('sort.byAmount');
        
        // Reset both buttons to inactive state
        this.sortByNameBtn.classList.remove('active');
        this.sortByAmountBtn.classList.remove('active');
        this.sortByNameBtn.textContent = nameLabel;
        this.sortByAmountBtn.textContent = amountLabel;
        
        // Set active button with direction indicator
        if (this.sortField === 'name') {
            this.sortByNameBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            this.sortByNameBtn.textContent = `${nameLabel} ${arrow}`;
        } else {
            this.sortByAmountBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            this.sortByAmountBtn.textContent = `${amountLabel} ${arrow}`;
        }
    }

    private addLot(): void {
        // State-level guard at the entry point as well (planA.md §13): this
        // prevents even the `LotManager` mutation that `GameSession` would
        // otherwise reject its participation tracking for.
        // A1 §3: `spinInProgress ⇒ sessionLocked`, so the session lock alone
        // is sufficient.
        if (this.gameSession.isSessionLocked) return;

        const name = this.lotNameInput.value.trim();
        const amount = parseFloat(this.lotAmountInput.value);
        const color = this.newLotColorIndicator.style.backgroundColor;

        // Call lotManager.addLot which now returns detailed error info
        const result = this.lotManager.addLot(name, amount, color);
        
        if (!result.success) {
            // Show error dialog with the reason
            const errorDialog = new ErrorDialog(result.message);
            errorDialog.open();
            
            // Don't clear form on error - let user fix their input
            return;
        }

        // Global-lot mutation succeeded. Register the new lot as a participant
        // of the current game session (Stage 3 §6): the two operations are
        // distinct — LotManager persists the lot globally, GameSession tracks
        // whether it takes part in the current game.
        this.gameSession.addLot(result.lot);

        // Success - proceed as before
        this.lotNameInput.value = '';
        this.lotAmountInput.value = '1';
        this.newLotColorIndicator.style.backgroundColor = generateRandomReadableColor();
        
        // Focus back on name input
        this.lotNameInput.focus();
        
        // Update UI and redraw wheel (table editing triggers wheel redraw)
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
    }

    private spin(): void {
        // Preparation belongs to the session (Stage 4 §3–§4): validation,
        // rolling, and remembering the pending spin. The result is decided
        // here, before any animation starts. A2 §2: the structured result
        // distinguishes the four failure causes so the alert is accurate.
        const prepared = this.gameSession.prepareSpin();
        if (!prepared.ok) {
            alert(t(this.prepareSpinFailureKey(prepared.reason)));
            return;
        }

        // A successful prepareSpin() has atomically established the session
        // and spin-time locks (Sub-stage A §7); reflect that in the DOM.
        this.updateControlsState();

        // Hand the already-decided target to the visualization boundary.
        // App says *what* to animate; the driver decides *how* (app-refac-task.md §8).
        this.visualizationDriver.spinTo({
            lots:        this.gameSession.activeLots,
            mode:        this.gameSession.mode,
            targetLotId: prepared.lot.id,
            durationMs:  this.settings.animationDuration,
            easing:      this.easingFunction,
            onComplete:  () => this.finishSpin()
        });
    }

    /**
     * Finishes the spin and applies results.
     *
     * The session owns the game-state transition (Stage 4 §6 / §11):
     * `gameSession.finishSpin()` processes the stored roll through the
     * current mode and applies eliminations internally. `App` only reads
     * the returned outcome for UI display.
     *
     * Lifecycle-wise (Sub-stage A §8): `finishSpin()` releases only the
     * spin-time lock; the session lock persists until reset.
     *
     * Exception safety (A1): if `processRoll()` throws, the session stays
     * locked and `gameFinished` is not set — but the spin-time lock has
     * been released. Reset is the escape hatch. We surface the failure via
     * an ErrorDialog and never present it as a normal completed spin.
     */
    private finishSpin(): void {
        // Capture the current mode once so the roll text and the renderer
        // segment update use the same mode that decided the roll (Stage 5 §20-1).
        const mode = this.gameSession.mode;

        let outcome: { rolledLot: Lot; result: RollResult } | null;
        try {
            outcome = this.gameSession.finishSpin();
        } catch (err) {
            // A1 (finishSpin exception safety): the session stays locked
            // (`spinInProgress` was released in GameSession's `finally`, but
            // `sessionLocked` persists and `gameFinished` is not set).
            // Reset is the escape hatch. Never present this as a normal spin.
            //
            // A1 follow-up: this dialog used to pass the *title* key as both
            // the message and the title, so the user just saw "⚠ Error" in
            // the body. Use a dedicated message key instead; the title stays
            // the generic "⚠ Error".
            console.error('GameSession.finishSpin() threw during processRoll():', err);
            new ErrorDialog(t('error.spinProcessingFailed'), t('dialog.errorTitle')).open();
            this.updateControlsState();
            return;
        }

        if (!outcome) {
            // No pending spin (e.g. the animation was stopped/aborted).
            // This path does not go through `updateUI()` below, so refresh
            // the controls here.
            this.updateControlsState();
            return;
        }

        const { rolledLot, result } = outcome;

        // Immediate visual: show the rolled lot highlighted and its roll
        // text. These are UI concerns only — `getRollText` is a
        // mode-provided display string, not a game-state mutation.
        this.highlightedLotId = rolledLot.id;
        if (this.resultText) {
            this.resultText.textContent = mode.getRollText(rolledLot);
        }

        if (result.finished) {
            // A surviving winner (e.g. SurvivalMode) may differ from the
            // rolled lot.
            if (result.winner) {
                this.highlightedLotId = result.winner.id;
            }

            if (result.message) {
                setTimeout(() => alert(result.message), 500);
            }

            // The finished-game lock is tracked inside GameSession via its
            // `gameFinished` lifecycle flag (planA.md §8) — no `App`-side
            // copy is needed.
        }
        // Otherwise: the session stays locked, but the spin-time lock has
        // been released and a subsequent Survival spin may be prepared.

        // Refresh UI + renderer to reflect the new active-lot list.
        //
        // A1 (single derivation point): the lock state is re-applied
        // automatically by `renderLotsList()` inside `updateUI()`, so no
        // trailing `updateControlsState()` is needed on this normal path.
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, mode);
    }

    private reset(): void {
        // Reset state
        this.highlightedLotId = null;

        // Reset the current game session (Stage 3 §14 / Stage 4 §17,
        // Sub-stage A §9): every lot currently in the global list becomes
        // an active participant again, any in-flight spin context is
        // cleared, and every lifecycle lock is released.
        this.gameSession.reset();

        // Reset the visualization (stops any animation, resets the renderer,
        // re-seeds segments for the now-reset session, redraws). The whole
        // sequence is synchronous: no RAF callback can run between
        // `gameSession.reset()` (which nulls the pending spin) and the
        // driver's `animationController.stop()` — so a late `onComplete`
        // remains a no-op for two independent reasons.
        this.visualizationDriver.reset(
            this.gameSession.activeLots,
            this.gameSession.mode
        );

        // Update result text to show mode name after reset
        this.updateResultTextWithModeName();

        // Update UI
        this.updateUI();
    }

    private updateUI(): void {
        // Update lots list (global lot data — served by LotManager,
        // the owner of the global lot collection; the participation flag
        // is projected from the session inside renderLotsList).
        //
        // A1 (single derivation point): `renderLotsList()` itself re-applies
        // the current lock state to the freshly-rendered controls, so no
        // explicit `updateControlsState()` call is needed here.
        this.renderLotsList();
        
        // Update stats. Game-session counters are read from the GameSession
        // (§8): `activeLots` and the current mode are game state.
        const totalEl = document.getElementById('total-lots');
        const activeEl = document.getElementById('active-lots');
        if (totalEl) totalEl.textContent = this.lotManager.getTotalCount().toString();
        if (activeEl) activeEl.textContent = this.gameSession.activeCount.toString();
    }

    /**
     * Reflects the GameSession's two lifecycle locks onto the DOM
     * (planA.md §10). `App` keeps no lock state of its own — it merely
     * translates the session's read-only properties into `disabled`.
     *
     * Three meaningful combinations:
     *
     *   - session locked, spinning   → only Reset enabled;
     *   - session locked, not spinning (Survival mid-game, or finished)
     *                               → Spin (unless finished), duration,
     *                                 visualization, easing, sorting,
     *                                 Reset enabled;
     *   - session unlocked           → everything enabled.
     *
     * Duration, visualization and easing are tied to the *spin-time* lock
     * plus the finished state (A1 — finished-game UI): they remain editable
     * between spins of an *unfinished* game (planA.md §5), but once the game
     * has finished they freeze along with Spin. Sorting is never locked.
     */
    private updateControlsState(): void {
        const spinning = this.gameSession.isSpinInProgress;
        const finished = this.gameSession.isGameFinished;
        // A1 §3: spinInProgress ⇒ sessionLocked (§5.1 invariant), so the ORed
        // form is redundant at the session level.
        const sessionLevelLocked = this.gameSession.isSessionLocked;
        // A1 (finished-game UI): duration / visualization / easing are editable
        // between spins of an *unfinished* game, but frozen once the game has
        // finished. Spin itself is disabled separately below.
        const spinTimeLocked = spinning || finished;

        // Spin: only between spins of an unfinished game
        if (this.spinBtn) this.spinBtn.disabled = spinning || finished;

        // Reset is always available — the user must be able to abandon the session
        if (this.resetBtn) this.resetBtn.disabled = false;

        // Session-level configuration (mode, import, clear) — locked for the whole session
        if (this.modeSelect) this.modeSelect.disabled = sessionLevelLocked;
        if (this.importBtnControls) this.importBtnControls.disabled = sessionLevelLocked;
        if (this.clearBtnControls) this.clearBtnControls.disabled = sessionLevelLocked;

        // Lot editing
        const lockableControls = document.querySelectorAll<
            HTMLInputElement | HTMLButtonElement
        >(
            '#new-lot-name, #new-lot-amount, #add-lot-btn, ' +
            '#lots-list .lot-amount-input, #lots-list .btn-delete'
        );
        lockableControls.forEach(el => { el.disabled = sessionLevelLocked; });

        // Spin-time configuration (duration, visualization, easing) — available
        // between spins of an unfinished game (planA.md §5); disabled while
        // the spin-time lock is held or once the game has finished.
        if (this.durationSlider) this.durationSlider.disabled = spinTimeLocked;
        if (this.durationInput) this.durationInput.disabled = spinTimeLocked;
        if (this.visualizationSelect) this.visualizationSelect.disabled = spinTimeLocked;
        if (this.easingSelect) this.easingSelect.disabled = spinTimeLocked;

        // Sorting is purely a presentation operation (planA.md §11) — it is
        // never disabled in any lifecycle state. The sort buttons always
        // accept clicks; `renderLotsList()` re-applies the current lock state
        // to the freshly-rendered list controls afterwards.
    }

    /**
     * Renders a list of lots into the specified container element.
     * Reusable for both main lots list and import preview.
     * 
     * @param container - The UL element to render into
     * @param lots - Array of lot data objects (Lot or ParsedLot)
     * @param options - Rendering options
     */
    private renderLotsListToContainer(
        container: HTMLUListElement,
        lots: RenderableLot[],
        options: LotsListRenderOptions = {}
    ): void {
        const {
            showActions = false,
            highlightId = null,
            editableAmount = true,
            onAmountChange
        } = options;

        container.innerHTML = '';

        for (const lot of lots) {
            const li = document.createElement('li');
            
            // Build class name with conditional classes
            const classNameParts: string[] = ['lot-item'];
            if (!lot.active) classNameParts.push('inactive');
            if (lot.id === highlightId) classNameParts.push('highlighted');
            li.className = classNameParts.join(' ');

            // Color indicator (use default color if not provided)
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'lot-color-indicator';
            colorIndicator.style.backgroundColor = lot.color || '#888';

            // Lot name (non-editable)
            const lotName = document.createElement('span');
            lotName.className = 'lot-name';
            lotName.textContent = lot.name;
            lotName.style.flex = '1';
            lotName.style.overflow = 'hidden';
            lotName.style.textOverflow = 'ellipsis';

            // Amount input (editable or read-only based on options)
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.className = 'lot-amount-input';
            amountInput.value = lot.amount.toFixed(2);
            amountInput.min = '0.01';
            amountInput.step = '0.01';

            if (!editableAmount) {
                amountInput.disabled = true;
            } else if (onAmountChange && lot.id) {
                // Handle amount change with callback
                const lotId: string = lot.id; // Capture in closure, guaranteed defined here
                amountInput.addEventListener('change', () => {
                    const newAmount = parseFloat(amountInput.value);
                    if (!isNaN(newAmount) && newAmount > 0) {
                        onAmountChange(lotId, newAmount);
                    } else {
                        amountInput.value = lot.amount.toFixed(2);
                    }
                });
            }

            // Append in order: color → name → amount → delete button
            li.appendChild(colorIndicator);
            li.appendChild(lotName);
            li.appendChild(amountInput);

            // Actions (delete button only if showActions is true and not highlighted)
            if (showActions && lot.id !== highlightId) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'lot-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.textContent = '×';
                deleteBtn.style.padding = '6px 10px';
                
                // Store lot id for deletion callback
                if (lot.id) {
                    const lotId: string = lot.id; // Capture in closure, guaranteed defined here
                    deleteBtn.onclick = () => this.deleteLot(lotId);
                }

                actionsDiv.appendChild(deleteBtn);
                li.appendChild(actionsDiv);
            }

            container.appendChild(li);
        }
    }

    private renderLotsList(): void {
        // Global lots come from LotManager (owner of the global collection).
        const allLots = this.lotManager.getAllLots();
        
        // Apply sorting based on current sort state.
        //
        // NOTE (planA.md §11): sorting is purely a presentation operation.
        // The following `sorted` array is a *copy* (`[...allLots]`) used to
        // order the rendered list; it never mutates `LotManager` and never
        // touches `GameSession.activeLotIds`. Participation is projected
        // below from the session, so an eliminated lot stays eliminated
        // regardless of the sort order.
        const sorted = [...allLots].sort((a, b) => {
            if (this.sortField === 'name') {
                return this.sortDirection === 'asc' 
                    ? a.name.localeCompare(b.name)
                    : b.name.localeCompare(a.name);
            } else { // amount
                return this.sortDirection === 'asc'
                    ? a.amount - b.amount
                    : b.amount - a.amount;
            }
        });

        // Project the session's participation state onto each renderable lot
        // (Stage 3 §12). Participation is projected from the session — the
        // UI asks GameSession which lots take part in the current game.
        const renderables: RenderableLot[] = sorted.map(lot => ({
            ...lot,
            active: this.gameSession.isActive(lot.id)
        }));
        
        // Use the reusable rendering method with default options for main lots list
        this.renderLotsListToContainer(this.lotsList, renderables, {
            showActions: true,
            highlightId: this.highlightedLotId,
            editableAmount: true,
            onAmountChange: (id: string, newAmount: number) => {
                if (!id) return; // Safety check for undefined id
                // State-level guard (planA.md §13): rejected while the
                // session is locked, mirroring the GameSession-boundary
                // rejection.
                if (this.gameSession.isSessionLocked) return;
                this.lotManager.updateLot(id, { amount: newAmount });
                // Amount changes do not affect participation; no session
                // mutation is required. The next read of `session.activeLots`
                // already reflects the updated amount.
                this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
            }
        });

        // Any lockable controls created by this render must be brought into
        // line with the current lifecycle state. This makes the lock refresh
        // self-contained rather than dependent on the caller's call order
        // (A1 — single authoritative derivation point).
        this.updateControlsState();
    }

    private deleteLot(id: string): void {
        // State-level guard at the entry point (planA.md §13).
        // A1 §3: `spinInProgress ⇒ sessionLocked`, so the session lock alone
        // is sufficient.
        if (this.gameSession.isSessionLocked) return;

        if (!confirm(t('confirmation.deleteLot'))) return;

        // Two independent operations (Stage 3 §6 / §7):
        //   • LotManager.deleteLot(id) — removes the lot globally;
        //   • GameSession.removeLot(id) — drops it from the session's
        //     participation set, preserving the invariant that the session
        //     never references a globally absent lot.
        this.lotManager.deleteLot(id);
        this.gameSession.removeLot(id);
        
        // Clear highlight if deleted lot was highlighted
        if (this.highlightedLotId === id) {
            this.highlightedLotId = null;
        }

        // Update UI and redraw wheel (table editing triggers wheel redraw)
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
    }

    /** Handles clearing all lots */
    private handleClearLots(): void {
        // State-level guard at the entry point (planA.md §13).
        // A1 §3: `spinInProgress ⇒ sessionLocked`, so the session lock alone
        // is sufficient.
        if (this.gameSession.isSessionLocked) return;

        const totalLots = this.lotManager.getTotalCount();
        
        if (totalLots === 0) {
            alert(t('validation.noLotsToClear'));
            return;
        }
        
        const message = t('confirmation.clearAllLots', { count: totalLots });
        if (!confirm(message)) {
            return;
        }
        
        // Two independent operations (Stage 3 §6 / §7):
        //   • LotManager.clearAll() — empties the global list;
        //   • GameSession.clearLots() — empties the participation set.
        this.lotManager.clearAll();
        this.gameSession.clearLots();
        
        // Reset highlight and result display
        this.highlightedLotId = null;
        if (this.resultText) {
            this.updateResultTextWithModeName();
        }
        
        // Update UI and renderer
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
    }

    /** Opens the import dialog */
    private openImportDialog(): void {
        // State-level guard at the entry point (planA.md §13). The button is
        // also disabled while the session is locked, but this makes the
        // rejection independent of the DOM.
        // A1 §3: `spinInProgress ⇒ sessionLocked`, so the session lock alone
        // is sufficient.
        if (this.gameSession.isSessionLocked) return;

        // Ensure any existing ImportDialog is destroyed before creating a new one
        if (this.importDialog) {
            this.importDialog.destroy();
            this.importDialog = null;
        }
        
        this.importDialog = new ImportDialog((parsedLots) => {
            this.handleImportConflict(parsedLots);
        });
        
        this.importDialog.open();
    }

    /** Handles conflict resolution when importing lots */
    private handleImportConflict(parsedLots: ParsedLot[]): void {
        const existingCount = this.lotManager.getTotalCount();
        
        // If no existing lots, proceed directly with merge strategy (no conflict)
        if (existingCount === 0) {
            this.executeImport(parsedLots, MERGE_STRATEGY);
            return;
        }
        
        // Show conflict resolution dialog - callback receives ImportStrategy | null
        const conflictDialog = new ImportConflictDialog(existingCount, (strategy) => {
            if (strategy) {  // If strategy is not null (user didn't cancel)
                this.executeImport(parsedLots, strategy);
            }
        });
        
        conflictDialog.open();
    }

    /** Executes the import using the selected strategy */
    private executeImport(parsedLots: ParsedLot[], strategy: ImportStrategy): void {
        // State-level guard at the entry point (planA.md §13). Also covers
        // the case where the conflict dialog was opened *before* the session
        // locked and its callback fires afterwards.
        // A2 §1: the conflict dialog may have been opened *before* the
        // session locked; surface the race instead of silently no-oping.
        if (this.gameSession.isSessionLocked) {
            new ErrorDialog(t('import.sessionLocked')).open();
            return;
        }

        // Snapshot the global id set *before* the strategy runs so the
        // session can tell "kept / updated" lots (preserve participation)
        // apart from "created" lots (become active). See GameSession
        // .reconcileAfterBulkChange() for the exact rules — they preserve
        // the shipped behaviour of both strategies without either strategy
        // needing to know about the session.
        const idsBefore = new Set(this.lotManager.getAllLots().map(l => l.id));

        // Delegate execution to the strategy object - no branching needed!
        const result = strategy.execute(parsedLots, this.lotManager);

        // Reconcile the session's participation set with the new global list
        // (Stage 3 §6). This is the explicit bulk-change entry point; no
        // syncGameSession() is involved. GameSession also rejects this call
        // itself while locked (planA.md §3).
        this.gameSession.reconcileAfterBulkChange(idsBefore);
        
        // Update UI and renderer after import completes
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
        
        // Close the import dialog after successful import (handles both conflict and no-conflict cases)
        if (this.importDialog) {
            this.importDialog.close();
            this.importDialog = null;
        }
        
        // Show info modal if lots were truncated due to MAX_LOTS limit
        if (result.lotsTruncated > 0) {
            const message = t('import.summaryWithTruncation', {
                lotsAdded: result.lotsAdded,
                lotsTruncated: result.lotsTruncated,
                maxLots: LotManager.MAX_LOTS,
                totalLots: this.lotManager.getTotalCount()
            });
            
            const infoDialog = new ErrorDialog(message, t('import.summaryTitle'));
            infoDialog.open();
        }
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {

    startApp();


    
    // Ensure translations are applied after everything is set up
    translateDOM();
});
