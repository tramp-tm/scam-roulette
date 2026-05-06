import { LotManager } from './lotManager.js';
import { Renderer } from './renderer.js';
import { RouletteEngine } from './rouletteEngine.js';
import { AnimationController, EasingFunctions } from './animation.js';
import { Settings, Mode, VisualizationType, AppState, Lot, ModeConfig, getModeConfig, MODES, RenderableLot, LotsListRenderOptions } from './types.js';
import { generateRandomReadableColor } from './utils.js';

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

    // DOM elements
    private canvas: HTMLCanvasElement;
    private resultDisplay: HTMLElement | null = null;
    private resultText: HTMLElement | null = null;
    private infoContainer: HTMLElement | null = null;
    private spinBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    
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
                let debounceTimer: number | null = null;
                amountInput.addEventListener('change', () => {
                    const newAmount = parseFloat(amountInput.value);
                    if (!isNaN(newAmount) && newAmount > 0) {
                        onAmountChange(lot.id, newAmount);
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
                    const lotId: string = lot.id; // Explicitly typed - guaranteed non-undefined here
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
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
