import i18n, { t, translateDOM, initI18n, syncDocumentLang } from './i18n.js';
import { LotManager } from './lotManager.js';

import { EasingFunctions, DEFAULT_EASING } from './animation.js';
import type { EasingFunction } from './animation.js';
import { VisualizationDriver } from './visualizationDriver.js';
import { LotListView } from './lotListView.js';
import type { RenderableLot } from './lotListView.js';
import { GameSession } from './gameSession.js';
import type { PrepareSpinFailureReason } from './gameSession.js';
import { VisualizationType, Settings, Mode, GameMode, Lot, RollResult } from './types.js';
import { MERGE_STRATEGY } from './importStrategies.js';
import type { ImportStrategy } from './importStrategies.js';
import type { ParsedLot } from './csvParser.js';
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
    private lotListView: LotListView;
    
    private settings: Settings = {
        modeId: 'normal',
        visualization: 'wheel',
        animationDuration: 3000
    };
    
    // Easing function setting - source of truth for user preference
    private easingFunction: EasingFunction = DEFAULT_EASING;
    
    /**
     * Current game mode, delegated to the active GameSession. GameSession is the
     * single source of truth for the current mode; `settings.modeId` is a UI /
     * persistence mirror only and is never read back to drive the session.
     */
    get mode(): GameMode {
        return this.gameSession.mode;
    }
    
    private highlightedLotId: string | null = null;
    private importDialog: ImportDialog | null = null;

    // DOM elements
    private canvas: HTMLCanvasElement;
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
    private modeHelp: HTMLElement | null = null;
    private easingHelp: HTMLElement | null = null;

    
    // Settings toggle element
    private settingsToggleBtn: HTMLButtonElement | null = null;

    constructor() {
        this.lotManager = new LotManager([]);
        // `LotManager` owns the global lot list; `GameSession` owns the current game
        // (mode + participation state). The session reads the global list through this
        // accessor so it never caches a stale snapshot; its participation set
        // (`activeLotIds`) is its own.
        this.gameSession = new GameSession(
            this.settings.modeId,
            () => this.lotManager.getAllLots()
        );

        // The canvas must be resolved before the visualization driver is
        // built — the driver constructs the initial renderer in its
        // constructor.
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;

        // VisualizationDriver owns the renderer + animation controller + canvas.
        // `App` talks to the visualization pipeline only through this boundary.
        this.visualizationDriver = new VisualizationDriver(
            this.canvas,
            this.settings.visualization
        );

        // Initialize DOM elements
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
        this.modeHelp = document.getElementById('mode-help');
        this.easingHelp = document.getElementById('easing-help');

        // LotListView owns the list DOM and the sorting controls. `#sort-controls`
        // sits outside `#lots-list`, so it is passed in explicitly.
        const sortControls = document.getElementById('sort-controls');
        this.lotListView = new LotListView(this.lotsList, sortControls);
        
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

        // Apply the saved theme preference; when none has been chosen yet,
        // follow the OS preference (fallback: light). Keep this resolution in
        // sync with the inline <head> script in index.html.
        let savedTheme: string | null = null;
        try {
            savedTheme = localStorage.getItem('theme');
        } catch (e) {
            // localStorage may be unavailable (e.g. private mode); fall through
        }
        if (!savedTheme) {
            savedTheme = (window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches)
                ? 'dark'
                : 'light';
        }
        this.applyTheme(savedTheme);
        if (this.themeSelect) {
            this.themeSelect.value = savedTheme;
        }
        
        // Update result display with current mode name initially
        if (this.resultText) {
            this.updateResultTextWithModeName();
        }

        // Populate the help tooltips now that i18n is ready (startApp()
        // awaits initI18n before `new App()`).
        this.updateModeHelpTooltip();
        this.updateEasingHelpTooltip();
        
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
     * Maps a `GameSession.prepareSpin()` failure reason to its i18n key. The
     * four cases mirror the four refusal branches in `GameSession.prepareSpin()`.
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
     * Handle an amount edit emitted by the LotListView. The view knows
     * nothing about the application — this is the application's job.
     */
    private handleAmountChange(id: string, newAmount: number): void {
        if (!id) return;
        // State-level guard: rejected while the session is locked, mirroring the
        // GameSession-boundary rejection.
        if (this.gameSession.isSessionLocked) return;
        this.lotManager.updateLot(id, { amount: newAmount });
        // Amount changes do not affect participation; no session mutation
        // is required. The next read of session.activeLots already reflects
        // the updated amount.
        this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
    }

    /**
     * Sets the Game Mode tooltip to the description of the *currently
     * selected* mode (`mode.<id>.description`). The mode name shown inside
     * the select is driven by `mode.<id>.name` via `data-i18n` — the two
     * surfaces reuse the same locale namespace, no duplication.
     */
    private updateModeHelpTooltip(): void {
        if (!this.modeHelp) return;
        this.modeHelp.dataset.tooltip = t(`mode.${this.gameSession.mode.id}.description`);
    }

    /**
     * Sets the Easing Function tooltip to the description of the *currently
     * selected* easing. The option value matches a key of `EasingFunctions`;
     * the entry's `name` field is the i18n key base, giving the option label
     * (`easing.<name>.name`) and this tooltip (`easing.<name>.description`)
     * from a single source.
     */
    private updateEasingHelpTooltip(): void {
        if (!this.easingHelp || !this.easingSelect) return;
        const entry = EasingFunctions[this.easingSelect.value];
        if (!entry) return;
        this.easingHelp.dataset.tooltip = t(`easing.${entry.name}.description`);
    }

    /**
     * Applies the given theme to the document and persists the preference.
     * The theme drives CSS custom properties defined on :root[data-theme="…"].
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

            // Reject the change (and restore the previous visible value) rather
            // than only relying on the disabled attribute. The session lock alone
            // gates this session-level operation.
            if (this.gameSession.isSessionLocked) {
                target.value = this.gameSession.mode.id;
                return;
            }

            const newModeId = target.value as Mode;

            // Single point of mode change. GameSession owns the current mode;
            // `settings.modeId` is kept in sync only as a UI / persistence record
            // and is never read back to drive the session.
            this.gameSession.setMode(newModeId);
            this.settings.modeId = newModeId;

            // Re-render wheel with the new mode's weight calculation. The
            // session's participation set is deliberately preserved across a
            // mode switch.
            this.visualizationDriver.refresh(this.gameSession.activeLots, this.gameSession.mode);
            // Update result text to show new mode name if no winner highlighted
            this.updateResultTextWithModeName();
            this.updateModeHelpTooltip();
        });
        
        this.visualizationSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;

            // Visualization cannot change mid-animation; between spins of an unfinished
            // game it is editable, like duration and easing. Once the game has finished
            // this select is disabled, so this guard also covers the finished case.
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
        
        // Easing function select — the option value is a key of
        // EasingFunctions; the entry carries both the curve and its i18n
        // name (used by the tooltip).
        this.easingSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            const entry = EasingFunctions[target.value];
            if (!entry) return;
            this.easingFunction = entry.fn;
            this.updateEasingHelpTooltip();
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

                // The tooltips are set via `data-tooltip`, not `data-i18n`,
                // so translateDOM() does not touch them — refresh explicitly.
                this.updateModeHelpTooltip();
                this.updateEasingHelpTooltip();

            });
        });

        // Theme select - applies the theme and persists the preference
        this.themeSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.applyTheme(target.value);

            // Re-render so canvas-based visuals pick up the new theme (if applicable)
            this.visualizationDriver.render();
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


    private addLot(): void {
        // State-level guard at the entry point prevents even the `LotManager`
        // mutation that `GameSession` would reject its participation tracking for.
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

        // Register the new lot as a participant of the current session — the global
        // list and the session's participation are two separate concerns.
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
        // Preparation belongs to the session: validation, rolling, and remembering
        // the pending spin. The result is decided here, before any animation starts.
        const prepared = this.gameSession.prepareSpin();
        if (!prepared.ok) {
            alert(t(this.prepareSpinFailureKey(prepared.reason)));
            return;
        }

        // A successful prepareSpin() has atomically established the session
        // and spin-time locks; reflect that in the DOM.
        this.updateControlsState();

        // Hand the already-decided target to the visualization boundary.
        // App says *what* to animate; the driver decides *how*.
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
     * Finishes the spin. Delegates the state transition to `gameSession.finishSpin()`
     * (mode processing, eliminations). On a `processRoll()` exception the session
     * stays locked and `gameFinished` is not set; the failure is surfaced via
     * ErrorDialog and never presented as a normal spin completion.
     */
    private finishSpin(): void {
        // Capture the current mode once so the roll text and the renderer
        // segment update use the same mode that decided the roll.
        const mode = this.gameSession.mode;

        let outcome: { rolledLot: Lot; result: RollResult } | null;
        try {
            outcome = this.gameSession.finishSpin();
        } catch (err) {
            // The session stays locked (`spinInProgress` was released in
            // GameSession's `finally`, but `sessionLocked` persists and
            // `gameFinished` is not set). Reset is the escape hatch. Never
            // present this as a normal spin.
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
            // `gameFinished` lifecycle flag — no `App`-side copy is needed.
        }
        // Otherwise: the session stays locked, but the spin-time lock has
        // been released and a subsequent Survival spin may be prepared.

        // Refresh UI + renderer to reflect the new active-lot list. The lock
        // state is re-applied automatically by the render path inside `updateUI()`,
        // so no trailing `updateControlsState()` is needed on this normal path.
        this.updateUI();
        this.visualizationDriver.refresh(this.gameSession.activeLots, mode);
    }

    private reset(): void {
        // Reset state
        this.highlightedLotId = null;

        // Reset the current game session: every lot currently in the global list
        // becomes an active participant again, any in-flight spin context is cleared,
        // and every lifecycle lock is released.
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
        // Global lot data comes from `LotManager`; participation is
        // projected from the session. Sorting is delegated to the view.
        const allLots = this.lotManager.getAllLots();
        const renderables: RenderableLot[] = allLots.map(lot => ({
            ...lot,
            active: this.gameSession.isActive(lot.id)
        }));

        this.lotListView.render(renderables, {
            showActions: true,
            highlightId: this.highlightedLotId,
            editableAmount: true,
            onAmountChange: (id, amount) => this.handleAmountChange(id, amount),
            onDelete: (id) => this.deleteLot(id)
        });

        // Update stats. Game-session counters are read from the GameSession
        // (§8): `activeLots` and the current mode are game state.
        const totalEl = document.getElementById('total-lots');
        const activeEl = document.getElementById('active-lots');
        if (totalEl) totalEl.textContent = this.lotManager.getTotalCount().toString();
        if (activeEl) activeEl.textContent = this.gameSession.activeCount.toString();

        // Re-apply the lifecycle lock state to every control the UI just rebuilt —
        // the list controls via `LotListView.setLocked()`, plus the application-level
        // controls handled directly here.
        this.updateControlsState();
    }

    /**
     * Reflects the GameSession's two lifecycle locks onto the DOM.
     * Three combinations:
     *
     *   - session locked, spinning → only Reset enabled;
     *   - session locked, not spinning (Survival mid-game or finished) → Spin
     *     (unless finished), duration, visualization, easing, sorting, Reset;
     *   - session unlocked → everything enabled.
     */
    private updateControlsState(): void {
        const spinning = this.gameSession.isSpinInProgress;
        const finished = this.gameSession.isGameFinished;
        // spinInProgress ⇒ sessionLocked, so the session lock alone suffices here.
        const sessionLevelLocked = this.gameSession.isSessionLocked;
        const spinTimeLocked = spinning || finished;

        // Spin: only between spins of an unfinished game
        if (this.spinBtn) this.spinBtn.disabled = spinning || finished;

        // Reset is always available — the user must be able to abandon the session
        if (this.resetBtn) this.resetBtn.disabled = false;

        // Session-level configuration (mode, import, clear) — locked for the whole session
        if (this.modeSelect) this.modeSelect.disabled = sessionLevelLocked;
        if (this.importBtnControls) this.importBtnControls.disabled = sessionLevelLocked;
        if (this.clearBtnControls) this.clearBtnControls.disabled = sessionLevelLocked;

        // Add-row controls stay managed directly by App.
        const addRowControls = document.querySelectorAll<
            HTMLInputElement | HTMLButtonElement
        >('#new-lot-name, #new-lot-amount, #add-lot-btn');
        addRowControls.forEach(el => { el.disabled = sessionLevelLocked; });

        // List controls are delegated to the view: `App` passes only the boolean;
        // the view knows which elements to lock.
        this.lotListView.setLocked(sessionLevelLocked);

        // Spin-time configuration (duration, visualization, easing) — available
        // between spins of an unfinished game (planA.md §5); disabled while
        // the spin-time lock is held or once the game has finished.
        if (this.durationSlider) this.durationSlider.disabled = spinTimeLocked;
        if (this.durationInput) this.durationInput.disabled = spinTimeLocked;
        if (this.visualizationSelect) this.visualizationSelect.disabled = spinTimeLocked;
        if (this.easingSelect) this.easingSelect.disabled = spinTimeLocked;

        // Sorting is never disabled. The sort buttons always accept clicks; the
        // list view re-applies the current lock state to any freshly-rendered list
        // controls.
    }

    private deleteLot(id: string): void {
        // State-level guard: rejected while the session is locked.
        if (this.gameSession.isSessionLocked) return;

        if (!confirm(t('confirmation.deleteLot'))) return;

        // Two independent operations:
        //   • LotManager.deleteLot(id) — removes the lot globally;
        //   • GameSession.removeLot(id) — drops it from the session's
        //     participation set. The session never references a globally
        //     absent lot.
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
        // State-level guard: rejected while the session is locked.
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
        
        // Two independent operations:
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
        // State-level guard: rejected while the session is locked. The button is
        // also disabled, but this makes the rejection independent of the DOM.
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
        // Also covers the case where the conflict dialog was opened *before* the
        // session locked and its callback fires afterwards.
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

        const result = strategy.execute(parsedLots, this.lotManager);

        // Reconcile the session's participation set with the new global list after
        // the strategy ran. GameSession also rejects this call itself while locked.
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
