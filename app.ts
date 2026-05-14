import { LotManager } from './lotManager.js';
import { createRenderer } from './rendererFactory.js';
import { RouletteEngine } from './rouletteEngine.js';
import { AnimationController, EasingFunctions } from './animation.js';
import { getVisualizationPackage } from './visualizationStrategy.js';
import { IRenderer, VisualizationType, Settings, Mode, Lot, ModeConfig, getModeConfig, MODES, RenderableLot, LotsListRenderOptions, ParsedLot, ParseResult, SeparatorType, ImportStrategy, SortField, SortDirection, VisualizationPackage } from './types.js';
import { IMPORT_STRATEGIES, MERGE_STRATEGY } from './strategies.js';
import { generateRandomReadableColor, sliderToDuration, durationToSlider, MAX_DURATION_SLIDER_VALUE } from './utils.js';
import { parseCSV } from './csvParser.js';
import { ImportDialog } from './importDialog.js';
import { ImportConflictDialog } from './importConflictDialog.js';
import { ModalManager } from './modalManager.js';

/**
 * Main application controller for the roulette game.
 */
export class App {
    private lotManager: LotManager;
    private renderer: IRenderer;
    private animationController: AnimationController;
    
    private settings: Settings = {
        modeId: 'normal',
        visualization: 'wheel',
        animationDuration: 3000
    };
    
    // Get current mode config (cached for performance)
    get modeConfig(): ModeConfig {
        return getModeConfig(this.settings.modeId);
    }
    
    private highlightedLotId: string | null = null;
    private isSettingsLocked: boolean = false;
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
    
    // Sort control elements
    private sortByNameBtn: HTMLButtonElement | null = null;
    private sortByAmountBtn: HTMLButtonElement | null = null;

    constructor() {
        this.lotManager = new LotManager([]);
        const canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
        this.renderer = createRenderer(this.settings.visualization, canvas);
        this.animationController = new AnimationController();
        
        // Initialize DOM elements
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
        this.resultDisplay = document.getElementById('result-display');
        this.resultText = document.getElementById('result-text');
        this.spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        this.importBtnControls = document.getElementById('import-btn-controls') as HTMLButtonElement;
        
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
        this.durationValue = document.getElementById('duration-value');
        
        // Sort control elements
        this.sortByNameBtn = document.getElementById('sort-by-name') as HTMLButtonElement;
        this.sortByAmountBtn = document.getElementById('sort-by-amount') as HTMLButtonElement;

        // Initialize UI
        this.updateUI();
        
        // Set initial slider and number input positions based on default duration (3s)
        if (this.durationSlider && this.durationInput) {
            const initialDurationSeconds = 3; // Default 3 seconds
            this.durationSlider.value = String(durationToSlider(initialDurationSeconds * 1000));
            this.durationInput.value = String(initialDurationSeconds);
        }
        
        // Set initial random color for new lot indicator
        this.newLotColorIndicator.style.backgroundColor = generateRandomReadableColor();
        
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
            this.resultText.textContent = this.modeConfig.name;
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
        
        // Settings changes
        this.modeSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.settings.modeId = target.value as Mode;
            // Re-render wheel with new mode's weight calculation
            this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
            this.render();
            // Update result text to show new mode name if no winner highlighted
            this.updateResultTextWithModeName();
        });
        
        this.visualizationSelect?.addEventListener('change', (e) => {
            const target = e.target as HTMLSelectElement;
            this.settings.visualization = target.value as VisualizationType;
            
            // Recreate renderer with new visualization type
            const canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
            this.renderer = createRenderer(this.settings.visualization, canvas);
            
            // Re-initialize segments and render
            this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
            this.render();
        });
        
        // Duration slider - uses non-linear mapping for better control at lower values
        this.durationSlider?.addEventListener('input', () => {
            if (this.durationSlider) {
                const sliderValue = parseInt(this.durationSlider.value);
                const duration = sliderToDuration(sliderValue);
                this.settings.animationDuration = duration;
                
                // Update number input and display value
                if (this.durationInput) {
                    this.durationInput.value = String(Math.round(duration / 1000));
                }
                if (this.durationValue) {
                    this.durationValue.textContent = `${(duration / 1000).toFixed(1)}s`;
                }
            }
        });

        // Duration number input - direct value entry
        
        this.durationInput?.addEventListener('input', () => {
            if (this.durationInput) {
                let seconds = parseFloat(this.durationInput.value);
                
                // Validate and clamp to range [1, 300]
                if (isNaN(seconds)) seconds = 1;
                seconds = Math.max(1, Math.min(300, seconds));
                
                const duration = Math.round(seconds * 1000);
                this.settings.animationDuration = duration;
                
                // Update slider position and display value
                if (this.durationSlider) {
                    this.durationSlider.value = String(durationToSlider(duration / 1000));
                }
                if (this.durationValue) {
                    this.durationValue.textContent = `${seconds.toFixed(1)}s`;
                }
            }
        });

        // Duration number input - sync on blur/enter
        this.durationInput?.addEventListener('change', () => {
            if (this.durationInput) {
                let seconds = parseFloat(this.durationInput.value);
                
                // Validate and clamp to range [1, 300]
                if (isNaN(seconds)) seconds = 1;
                seconds = Math.max(1, Math.min(300, seconds));
                
                const duration = Math.round(seconds * 1000);
                this.settings.animationDuration = duration;
                
                // Update slider position and display value
                if (this.durationSlider) {
                    this.durationSlider.value = String(durationToSlider(duration / 1000));
                }
                if (this.durationValue) {
                    this.durationValue.textContent = `${seconds.toFixed(1)}s`;
                }
            }
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
        
        // Re-render lots list with new sort order
        this.renderLotsList();
    }
    
    /** Updates visual state of sort buttons */
    private updateSortButtons(): void {
        if (!this.sortByNameBtn || !this.sortByAmountBtn) return;
        
        // Reset both buttons to inactive state
        this.sortByNameBtn.classList.remove('active');
        this.sortByAmountBtn.classList.remove('active');
        this.sortByNameBtn.textContent = '🅰️ Name';
        this.sortByAmountBtn.textContent = '💵 Amount';
        
        // Set active button with direction indicator
        if (this.sortField === 'name') {
            this.sortByNameBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            this.sortByNameBtn.textContent = `🅰️ Name ${arrow}`;
        } else {
            this.sortByAmountBtn.classList.add('active');
            const arrow = this.sortDirection === 'asc' ? '↑' : '↓';
            this.sortByAmountBtn.textContent = `💵 Amount ${arrow}`;
        }
    }

    private addLot(): void {
        const name = this.lotNameInput.value.trim();
        const amount = parseFloat(this.lotAmountInput.value);
        const color = this.newLotColorIndicator.style.backgroundColor;

        if (!name || isNaN(amount)) return;

        this.lotManager.addLot(name, amount, color);
        
        // Clear form and generate new random color for next lot
        this.lotNameInput.value = '';
        this.lotAmountInput.value = '1';
        this.newLotColorIndicator.style.backgroundColor = generateRandomReadableColor();
        
        // Focus back on name input
        this.lotNameInput.focus();
        
        // Update UI and redraw wheel (table editing triggers wheel redraw)
        this.updateUI();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        this.render();
    }

    private spin(): void {
        const activeLots = this.lotManager.getActiveLots();
        
        if (!RouletteEngine.canSpin(activeLots)) {
            alert('Add at least one lot to spin!');
            return;
        }
        
        // Lock settings
        this.isSettingsLocked = true;
        this.updateControlsState();
        
        // Select winner using mode's weight calculation (BEFORE animation)
        const winner = RouletteEngine.selectWeighted(activeLots, this.modeConfig);
        if (!winner) return;

        // Calculate final position using visualization strategy pattern
        const currentRotation = this.renderer.getCurrentRotation();
        const targetLotId = winner.id;
        const animationDuration = this.settings.animationDuration;
        
        // Get canvas dimensions
        const rect = this.canvas.getBoundingClientRect();
        
        // Use bundled visualization package - single lookup returns everything needed
        const vizPackage: VisualizationPackage = getVisualizationPackage(this.settings.visualization);
        const endRotation = vizPackage.computeFinalPosition(
            activeLots,
            this.modeConfig,
            targetLotId,
            currentRotation,
            animationDuration,
            rect.width  // Always passed - package handles it appropriately
        );

        // Configure animation
        this.animationController.configure({
            startValue: currentRotation,
            endValue: endRotation,
            duration: animationDuration,
            easing: EasingFunctions.rouletteEaseOut,
            onUpdate: (value) => {
                this.renderer.setRotation(value);
                this.render();
            },
            onComplete: () => {
                this.finishSpin(winner);
            }
        });

        // Start animation
        this.animationController.start();
    }

    /**
     * Finishes the spin and applies results.
     */
    private finishSpin(winner: Lot | null): void {
        if (winner) {
            // Highlight the result
            this.highlightedLotId = winner.id;

            // Show result display using mode's getResultText function
            if (this.resultText) {
                this.resultText.textContent = this.modeConfig.getResultText(winner);
            }

            // Call mode-specific onRollEnd hook if defined
            const activeLots = this.lotManager.getActiveLots();
            if (this.modeConfig.onRollEnd) {
                const rollResult = this.modeConfig.onRollEnd(winner, activeLots, this.lotManager.getTotalCount());
                
                // Handle lot elimination (e.g., survival mode)
                if (rollResult.eliminatedLotId) {
                    this.lotManager.deactivateLot(rollResult.eliminatedLotId);
                }
                
                // Check for completion
                if (rollResult.isComplete && rollResult.completionMessage) {
                    setTimeout(() => {
                        alert(rollResult.completionMessage);
                        const survivor = activeLots.find(l => l.id !== winner.id);
                        this.highlightedLotId = survivor?.id || null;
                    }, 500);
                }
            }

            // Update UI to reflect changes
            this.updateUI();
        }

        if (winner) {
            const action = this.settings.modeId === 'survival' ? 'Eliminated' : 'Winning';
            console.log(`${action} lot: "${winner.name}"`);
        }

        // Unlock settings
        this.isSettingsLocked = false;
        this.updateControlsState();
        
        // Re-render with updated state
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        this.render();
    }

    private reset(): void {
        // Stop any running animation
        this.animationController.stop();
        
        // Reset state
        this.highlightedLotId = null;
        this.isSettingsLocked = false;
        this.lotManager.resetAll();
        
        // Reset renderer
        this.renderer.reset();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        
        // Update result text to show mode name after reset
        this.updateResultTextWithModeName();
        
        // Update UI
        this.updateUI();
        
        // Redraw the roulette wheel
        this.render();
    }

    private updateUI(): void {
        // Update lots list
        this.renderLotsList();
        
        // Update stats
        const totalEl = document.getElementById('total-lots');
        const activeEl = document.getElementById('active-lots');
        if (totalEl) totalEl.textContent = this.lotManager.getTotalCount().toString();
        if (activeEl) activeEl.textContent = this.lotManager.getActiveCount().toString();
        
        // Update controls state
        this.updateControlsState();
    }

    private updateControlsState(): void {
        const isAnimating = this.animationController.isAnimating();
        
        if (this.spinBtn) this.spinBtn.disabled = this.isSettingsLocked || isAnimating;
        if (this.resetBtn) this.resetBtn.disabled = isAnimating;
        if (this.importBtnControls) this.importBtnControls.disabled = isAnimating;
        
        // Disable form inputs when locked
        const formInputs = document.querySelectorAll('#lot-form input');
        formInputs.forEach(input => {
            if ('disabled' in input && input instanceof HTMLInputElement) {
                input.disabled = this.isSettingsLocked;
            }
        });
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
                let debounceTimer: number | null = null;
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
        let lots = this.lotManager.getAllLots();
        
        // Apply sorting based on current sort state
        lots = [...lots].sort((a, b) => {
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
        
        // Use the reusable rendering method with default options for main lots list
        this.renderLotsListToContainer(this.lotsList, lots, {
            showActions: true,
            highlightId: this.highlightedLotId,
            editableAmount: true,
            onAmountChange: (id: string, newAmount: number) => {
                if (!id) return; // Safety check for undefined id
                this.lotManager.updateLot(id, { amount: newAmount });
                // Re-render wheel to reflect weight changes
                this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
                this.render();
            }
        });
    }

    private deleteLot(id: string): void {
        if (!confirm('Are you sure you want to delete this lot?')) return;

        this.lotManager.deleteLot(id);
        
        // Clear highlight if deleted lot was highlighted
        if (this.highlightedLotId === id) {
            this.highlightedLotId = null;
        }

        // Update UI and redraw wheel (table editing triggers wheel redraw)
        this.updateUI();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        this.render();
    }

    private render(): void {
        const rect = this.canvas.getBoundingClientRect();
        this.renderer.render(rect.width, rect.height);
    }

    /** Opens the import dialog */
    private openImportDialog(): void {
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
        // Delegate execution to the strategy object - no branching needed!
        strategy.execute(parsedLots, this.lotManager);
        
        // Update UI and renderer after import completes
        this.updateUI();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        this.render();
        
        // Close the import dialog after successful import (handles both conflict and no-conflict cases)
        if (this.importDialog) {
            this.importDialog.close();
            this.importDialog = null;
        }
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
