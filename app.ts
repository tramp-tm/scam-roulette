import { LotManager } from './lotManager.js';
import { Renderer } from './renderer.js';
import { RouletteEngine } from './rouletteEngine.js';
import { AnimationController, EasingFunctions } from './animation.js';
import { Settings, Mode, VisualizationType, AppState, Lot, ModeConfig, getModeConfig, MODES, RenderableLot, LotsListRenderOptions, ParsedLot, ParseResult, SeparatorType } from './types.js';
import { generateRandomReadableColor } from './utils.js';
import { parseCSV } from './csvParser.js';

/**
 * Main application controller for the roulette game.
 */
export class App {
    private lotManager: LotManager;
    private renderer: Renderer;
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
    private endRotation: number = 0;
    private importStrategy: ImportStrategy | null = null;

    // DOM elements
    private canvas: HTMLCanvasElement;
    private resultDisplay: HTMLElement | null = null;
    private resultText: HTMLElement | null = null;
    private infoContainer: HTMLElement | null = null;
    private spinBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    private importBtnControls: HTMLButtonElement;
    private importBtn: HTMLButtonElement | null = null;
    
    // Import dialog elements
    private importDialog: HTMLElement | null = null;
    private tabButtons: NodeListOf<Element> | null = null;
    private csvTabContent: Element | null = null;
    private linkTabContent: Element | null = null;
    
    // Import dialog input/output elements
    private importTextarea: HTMLTextAreaElement | null = null;
    private separatorSelect: HTMLSelectElement | null = null;
    private previewBtn: HTMLButtonElement | null = null;
    private importStatus: HTMLElement | null = null;
    private validCountSpan: HTMLElement | null = null;
    private errorCountSpan: HTMLElement | null = null;
    private previewContainer: HTMLElement | null = null;
    private previewLotsList: HTMLUListElement | null = null;
    
    // Store parsed result for import
    private parsedResult: ParseResult | null = null;
    
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
    private durationValue: HTMLElement | null = null;
    private spinsSlider: HTMLInputElement | null = null;
    private spinsValue: HTMLElement | null = null;

    constructor() {
        this.lotManager = new LotManager([]);
        this.renderer = new Renderer(document.getElementById('roulette-canvas') as HTMLCanvasElement);
        this.animationController = new AnimationController();
        
        // Initialize DOM elements
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
        this.resultDisplay = document.getElementById('result-display');
        this.resultText = document.getElementById('result-text');
        this.infoContainer = document.getElementById('info-container') as HTMLElement;
        this.spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        this.importBtnControls = document.getElementById('import-btn-controls') as HTMLButtonElement;
        this.importBtn = document.getElementById('import-btn') as HTMLButtonElement;
        
        // Import dialog elements
        this.importDialog = document.getElementById('import-dialog');
        this.tabButtons = document.querySelectorAll('.tab-button');
        this.csvTabContent = document.getElementById('tab-csv');
        this.linkTabContent = document.getElementById('tab-link');
        
        // Import dialog input/output elements
        this.importTextarea = document.getElementById('import-textarea') as HTMLTextAreaElement;
        this.separatorSelect = document.getElementById('separator-select') as HTMLSelectElement;
        this.previewBtn = document.getElementById('preview-btn') as HTMLButtonElement;
        this.importStatus = document.getElementById('import-status');
        this.validCountSpan = document.getElementById('valid-count');
        this.errorCountSpan = document.getElementById('error-count');
        this.previewContainer = document.getElementById('preview-container');
        this.previewLotsList = document.getElementById('preview-lots-list') as HTMLUListElement;
        
        // Lots list elements
        this.lotsList = document.getElementById('lots-list') as HTMLUListElement;
        
        // Add row elements (inline at bottom of lots table)
        const addLotRow = document.getElementById('add-lot-row') as HTMLElement;
        this.lotNameInput = document.getElementById('new-lot-name') as HTMLInputElement;
        this.lotAmountInput = document.getElementById('new-lot-amount') as HTMLInputElement;
        this.addBtn = document.getElementById('add-lot-btn') as HTMLButtonElement;
        this.newLotColorIndicator = document.getElementById('new-lot-color-indicator') as HTMLElement;
        
        // Settings elements
        this.modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
        this.visualizationSelect = document.getElementById('visualization-select') as HTMLSelectElement;
        this.durationSlider = document.getElementById('duration-slider') as HTMLInputElement;
        this.durationValue = document.getElementById('duration-value');
        this.spinsSlider = document.getElementById('spins-slider') as HTMLInputElement;
        this.spinsValue = document.getElementById('spins-value');

        // Initialize UI
        this.updateUI();
        
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
        
        // Import button - opens import dialog
        this.importBtnControls.addEventListener('click', () => {
            const importDialog = document.getElementById('import-dialog') as HTMLElement;
            if (importDialog) {
                importDialog.classList.remove('hidden');
            }
        });
        
        // Tab switching logic for import dialog
        this.tabButtons?.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = (button as HTMLElement).dataset.tab;
                if (!targetTab) return;
                
                // Update active tab button styling
                this.tabButtons?.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // Show corresponding tab content
                if (this.csvTabContent && this.linkTabContent) {
                    if (targetTab === 'csv') {
                        this.csvTabContent.classList.add('active');
                        this.linkTabContent.classList.remove('active');
                    } else if (targetTab === 'link') {
                        this.linkTabContent.classList.add('active');
                        this.csvTabContent.classList.remove('active');
                    }
                }
            });
        });
        
        // Preview button - parses CSV and shows preview
        this.previewBtn?.addEventListener('click', () => {
            if (!this.importTextarea || !this.separatorSelect) return;
            
            const csvText = this.importTextarea.value;
            const separator: SeparatorType = this.separatorSelect.value === 'tab' ? 'tab' : 'comma';
            
            // Parse CSV text
            this.parsedResult = parseCSV(csvText, separator);
            
            // Update status line
            if (this.importStatus && this.validCountSpan && this.errorCountSpan) {
                this.validCountSpan.textContent = `${this.parsedResult.validLots.length}`;
                this.errorCountSpan.textContent = `${this.parsedResult.errorCount}`;
                this.importStatus.classList.remove('hidden');
            }
            
            // Render preview if there are valid lots
            if (this.previewContainer && this.previewLotsList) {
                if (this.parsedResult.validLots.length > 0) {
                    // Generate random colors for preview lots
                    const previewLots: ParsedLot[] = this.parsedResult.validLots.map(lot => ({
                        ...lot,
                        color: generateRandomReadableColor()
                    }));
                    
                    // Render to preview area using reusable method
                    this.renderLotsListToContainer(this.previewLotsList, previewLots, {
                        showActions: false,
                        editableAmount: false
                    });
                    
                    this.previewContainer.classList.remove('hidden');
                } else {
                    this.previewContainer.classList.add('hidden');
                }
            }
        });
        
        // Import button - validates size limit and proceeds to conflict resolution
        this.importBtn?.addEventListener('click', () => {
            // Check if preview has been run with valid lots
            if (!this.parsedResult || this.parsedResult.validLots.length === 0) {
                alert('Please click "Preview" first to parse the CSV data.');
                return;
            }

            const validLotCount = this.parsedResult.validLots.length;

            // Check size limit (1000 lots maximum)
            if (validLotCount > 1000) {
                alert(`Import blocked: ${validLotCount} lots exceeds the maximum limit of 1000.\n\nPlease reduce the number of lots and try again.`);
                return;
            }

            // Size check passed - proceed to conflict resolution (Step 10)
            this.handleConflictResolution(this.parsedResult.validLots, validLotCount);
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
            this.renderer.setVisualizationType(this.settings.visualization);
            this.render();
        });
        
        // Duration slider
        this.durationSlider?.addEventListener('input', () => {
            if (this.durationSlider) {
                const duration = parseInt(this.durationSlider.value);
                this.settings.animationDuration = duration;
                if (this.durationValue) this.durationValue.textContent = `${(duration / 1000).toFixed(1)}s`;
            }
        });
        
        // Spins slider
        this.spinsSlider?.addEventListener('input', () => {
            if (this.spinsValue) this.spinsValue.textContent = this.spinsSlider ? this.spinsSlider.value : '';
        });
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
        
        // Select winner using mode's weight calculation
        const winner = RouletteEngine.selectWeighted(activeLots, this.modeConfig);
        if (!winner) return;

        // Calculate final rotation
        const currentRotation = this.renderer.getCurrentRotation();
        const targetLotId = winner.id;
        const animationDuration = this.settings.animationDuration;
        
        this.endRotation = RouletteEngine.computeFinalRotation(
            activeLots,
            this.modeConfig,
            targetLotId,
            currentRotation,
            animationDuration
        );

        // Configure animation
        this.animationController.configure({
            startValue: currentRotation,
            endValue: this.endRotation,
            duration: animationDuration,
            easing: EasingFunctions.rouletteEaseOut,
            onUpdate: (value) => {
                this.renderer.setRotation(value);
                this.render();
            },
            onComplete: () => {
                this.finishSpin(winner, this.endRotation);
            }
        });

        // Start animation
        this.animationController.start();
    }

    /**
     * Finishes the spin and applies results.
     */
    private finishSpin(winner: Lot | null, finalRotation?: number): void {
        if (winner) {
            // Highlight the result
            this.highlightedLotId = winner.id;
            
            // Show result display using mode's getResultText function
            if (this.resultText) {
                this.resultText.textContent = this.modeConfig.getResultText(winner);
            }
            if (this.infoContainer) this.infoContainer.classList.remove('hidden');

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
        this.endRotation = 0;
        this.lotManager.resetAll();
        
        // Reset renderer
        this.renderer.reset();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        
        // Update result text to show mode name after reset
        this.updateResultTextWithModeName();
        
        // Update UI
        this.updateUI();
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

            // Append all elements to list item
            li.appendChild(colorIndicator);
            li.appendChild(lotName);
            li.appendChild(amountInput);

            container.appendChild(li);
        }
    }

    private renderLotsList(): void {
        const lots = this.lotManager.getAllLots();
        
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
        this.renderer.render();
    }

    /**
     * Handles conflict resolution when importing lots.
     * Prompts user to choose strategy if existing lots are present.
     */
    private handleConflictResolution(parsedLots: ParsedLot[], count: number): void {
        const existingCount = this.lotManager.getTotalCount();
        
        // If no existing lots, proceed directly with import (merge behavior)
        if (existingCount === 0) {
            this.importStrategy = 'merge';
            this.executeImport(parsedLots);
            return;
        }
        
        // Show conflict resolution prompt using browser confirm dialogs
        const choice = prompt(
            `⚠️ CONFLICT DETECTED\n\nYou have ${existingCount} existing lot(s).\nHow would you like to proceed?\n\n` +
            `[1] Replace - Remove all existing lots and import new ones\n` +
            `[2] Merge - Keep existing lots and add new ones\n` +
            `[0] Cancel - Abort import operation`,
            '2'  // Default to merge
        );
        
        if (choice === null) {
            // User clicked Cancel/Close on prompt
            this.closeImportDialog();
            return;
        }
        
        const trimmedChoice = choice.trim().toLowerCase();
        
        if (trimmedChoice === '1' || trimmedChoice === 'replace') {
            this.importStrategy = 'replace';
            this.executeImport(parsedLots);
        } else if (trimmedChoice === '2' || trimmedChoice === 'merge') {
            this.importStrategy = 'merge';
            this.executeImport(parsedLots);
        } else {
            // Invalid choice - treat as cancel
            alert('Invalid selection. Import cancelled.');
            this.closeImportDialog();
        }
    }

    /**
     * Executes the actual import based on selected strategy.
     */
    private executeImport(parsedLots: ParsedLot[]): void {
        if (this.importStrategy === 'replace') {
            // Clear all existing lots first
            this.lotManager.clearAll();
        } else if (this.importStrategy === 'merge') {
            // For merge strategy, check for name conflicts and update or add accordingly
            for (const parsedLot of parsedLots) {
                const matchingLot = this.lotManager.getAllLots().find(
                    l => l.name.toLowerCase() === parsedLot.name.toLowerCase()
                );
                
                if (matchingLot) {
                    // Update existing lot with new amount
                    this.lotManager.updateLot(matchingLot.id, { amount: parsedLot.amount });
                } else {
                    // Add new lot with random color
                    const color = generateRandomReadableColor();
                    this.lotManager.addLot(parsedLot.name, parsedLot.amount, color);
                }
            }
        }

        // Update UI and renderer
        this.updateUI();
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.modeConfig);
        this.render();
        
        // Close import dialog
        this.closeImportDialog();
    }

    /**
     * Closes the import dialog and resets state.
     */
    private closeImportDialog(): void {
        if (this.importDialog) {
            this.importDialog.classList.add('hidden');
        }
        
        // Reset parsed result and strategy
        this.parsedResult = null;
        this.importStrategy = null;
        
        // Clear textarea and preview
        if (this.importTextarea) {
            this.importTextarea.value = '';
        }
        if (this.previewContainer) {
            this.previewContainer.classList.add('hidden');
        }
        if (this.importStatus) {
            this.importStatus.classList.add('hidden');
        }
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
