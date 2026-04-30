import { Lot, Mode, Settings, VisualizationType } from './types';
import { LotManager } from './lotManager';
import { RouletteEngine } from './rouletteEngine';
import { Renderer } from './renderer';
import { AnimationController, createAnimationController } from './animation';

/**
 * Main application class that coordinates all components.
 */
class App {
    // DOM Elements
    private canvas: HTMLCanvasElement;
    private lotForm: HTMLFormElement;
    private lotsList: HTMLElement;
    private spinBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    private resultDisplay: HTMLElement;
    private resultText: HTMLElement;
    
    // Settings elements
    private modeSelect: HTMLSelectElement;
    private visualizationSelect: HTMLSelectElement;
    private durationSlider: HTMLInputElement;
    private durationValue: HTMLElement;
    private spinsSlider: HTMLInputElement;
    private spinsValue: HTMLElement;

    // Application state
    private lotManager: LotManager;
    private renderer: Renderer;
    private animationController: AnimationController;
    
    private settings: Settings = {
        mode: 'normal',
        visualization: 'wheel',
        animationDuration: 3000,
        numSpins: 5
    };

    private highlightedLotId: string | null = null;
    private isSettingsLocked: boolean = false;

    constructor() {
        // Get DOM elements
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
        this.lotForm = document.getElementById('lot-form') as HTMLFormElement;
        this.lotsList = document.getElementById('lots-list');
        this.spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        this.resultDisplay = document.getElementById('result-display');
        this.resultText = document.getElementById('result-text');

        this.modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
        this.visualizationSelect = document.getElementById('visualization-select') as HTMLSelectElement;
        this.durationSlider = document.getElementById('duration-slider') as HTMLInputElement;
        this.durationValue = document.getElementById('duration-value');
        this.spinsSlider = document.getElementById('spins-slider') as HTMLInputElement;
        this.spinsValue = document.getElementById('spins-value');

        // Initialize components
        this.lotManager = new LotManager([]);
        this.renderer = new Renderer(this.canvas);
        this.animationController = createAnimationController();

        // Add some default lots for demonstration
        this.addDefaultLots();

        // Bind event handlers
        this.bindEvents();

        // Initial render
        this.updateUI();
        this.render();
    }

    /**
     * Adds default lots for demonstration.
     */
    private addDefaultLots(): void {
        const defaultLots = [
            { name: 'Red Prize', amount: 10, color: '#e74c3c' },
            { name: 'Blue Prize', amount: 20, color: '#3498db' },
            { name: 'Green Prize', amount: 15, color: '#2ecc71' },
            { name: 'Yellow Prize', amount: 8, color: '#f1c40f' },
            { name: 'Purple Prize', amount: 12, color: '#9b59b6' },
        ];

        for (const lot of defaultLots) {
            this.lotManager.addLot(lot.name, lot.amount, lot.color);
        }
    }

    /**
     * Binds all event handlers.
     */
    private bindEvents(): void {
        // Lot form submission
        this.lotForm.addEventListener('submit', (e) => this.handleAddLot(e));

        // Spin button
        this.spinBtn.addEventListener('click', () => this.startSpin());

        // Reset button
        this.resetBtn.addEventListener('click', () => this.handleReset());

        // Settings changes
        this.modeSelect.addEventListener('change', (e) => {
            if (!this.isSettingsLocked) {
                this.settings.mode = (e.target as HTMLSelectElement).value as Mode;
                this.updateUI();
            }
        });

        this.visualizationSelect.addEventListener('change', (e) => {
            if (!this.isSettingsLocked) {
                this.settings.visualization = (e.target as HTMLSelectElement).value as VisualizationType;
                this.renderer.setVisualizationType(this.settings.visualization);
                this.render();
            }
        });

        this.durationSlider.addEventListener('input', (e) => {
            if (!this.isSettingsLocked) {
                const value = parseInt((e.target as HTMLInputElement).value);
                this.settings.animationDuration = value;
                this.durationValue.textContent = `${(value / 1000).toFixed(1)}s`;
            }
        });

        this.spinsSlider.addEventListener('input', (e) => {
            if (!this.isSettingsLocked) {
                const value = parseInt((e.target as HTMLInputElement).value);
                this.settings.numSpins = value;
                this.spinsValue.textContent = value.toString();
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.renderer.reset();
            this.render();
        });
    }

    /**
     * Handles adding a new lot.
     */
    private handleAddLot(e: Event): void {
        e.preventDefault();

        const nameInput = document.getElementById('lot-name') as HTMLInputElement;
        const amountInput = document.getElementById('lot-amount') as HTMLInputElement;
        const colorInput = document.getElementById('lot-color') as HTMLInputElement;

        const lot = this.lotManager.addLot(
            nameInput.value,
            parseFloat(amountInput.value),
            colorInput.value
        );

        if (lot) {
            // Reset form
            nameInput.value = '';
            amountInput.value = '1';

            // Update UI
            this.updateUI();
            this.render();
        } else {
            alert('Maximum number of lots (100) reached!');
        }
    }

    /**
     * Starts the spin animation.
     */
    startSpin(): void {
        const activeLots = this.lotManager.getActiveLots();

        if (!RouletteEngine.canSpin(activeLots)) {
            alert('No active lots available to spin!');
            return;
        }

        // Lock settings during animation
        this.isSettingsLocked = true;
        this.updateControlsState();

        // CRITICAL: Determine result BEFORE animation starts
        const selectedLot = RouletteEngine.selectWeighted(activeLots, this.settings.mode);
        
        if (!selectedLot) {
            this.finishSpin(null);
            return;
        }

        console.log(`Selected lot (before animation): ${selectedLot.name}`);

        // Calculate final rotation angle based on the selected lot
        const startRotation = this.renderer.currentRotation || 0;
        const endRotation = RouletteEngine.calculateFinalAngle(
            activeLots,
            this.settings.mode,
            selectedLot.id,
            this.settings.numSpins,
            this.settings.visualization
        );

        // Configure and start animation
        this.animationController.configure({
            startValue: 0,
            endValue: endRotation,
            duration: this.settings.animationDuration,
            onUpdate: (value) => {
                this.renderer.setRotation(value);
                this.render();
            },
            onComplete: () => {
                this.finishSpin(selectedLot);
            }
        });

        this.animationController.start();
    }

    /**
     * Finishes the spin and applies results.
     */
    private finishSpin(winner: Lot | null): void {
        if (winner) {
            // Highlight the result
            this.highlightedLotId = winner.id;
            
            // Show result display
            this.resultText.textContent = 
                this.settings.mode === 'survival' 
                    ? `Eliminated: ${winner.name}`
                    : `Winner: ${winner.name}`;
            this.resultDisplay.classList.remove('hidden');

            // In survival mode, deactivate the eliminated lot
            if (this.settings.mode === 'survival') {
                this.lotManager.deactivateLot(winner.id);
                
                // Check if survival is complete
                const activeLots = this.lotManager.getActiveLots();
                if (RouletteEngine.isSurvivalComplete(activeLots, this.lotManager.getTotalCount())) {
                    const survivor = activeLots[0];
                    setTimeout(() => {
                        alert(`🏆 SURVIVAL COMPLETE! 🏆\n\nThe last lot standing is:\n${survivor.name}`);
                        this.highlightedLotId = survivor.id;
                    }, 500);
                }
            }

            // Update UI to reflect changes
            this.updateUI();
        }

        // Unlock settings
        this.isSettingsLocked = false;
        this.updateControlsState();
        
        // Re-render with updated state
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.settings.mode);
        this.render();
    }

    /**
     * Handles reset button click.
     */
    private handleReset(): void {
        if (this.animationController.isAnimating()) return;

        if (confirm('Are you sure you want to reset all lots?')) {
            this.lotManager.resetAll();
            this.highlightedLotId = null;
            this.renderer.reset();
            this.resultDisplay.classList.add('hidden');
            
            this.updateUI();
            this.render();
        }
    }

    /**
     * Updates the UI controls state based on settings lock.
     */
    private updateControlsState(): void {
        const disabled = this.isSettingsLocked || this.animationController.isAnimating();
        
        this.modeSelect.disabled = disabled;
        this.visualizationSelect.disabled = disabled;
        this.durationSlider.disabled = disabled;
        this.spinsSlider.disabled = disabled;
        this.spinBtn.disabled = disabled;
    }

    /**
     * Updates the lots list and statistics.
     */
    private updateUI(): void {
        const lots = this.lotManager.lots;
        
        // Update lots list
        this.lotsList.innerHTML = '';
        
        for (const lot of lots) {
            const li = document.createElement('li');
            li.className = `lot-item${!lot.active ? ' inactive' : ''}${lot.id === this.highlightedLotId ? ' highlighted' : ''}`;
            
            li.innerHTML = `
                <div class="lot-color-indicator" style="background-color: ${lot.color}"></div>
                <div class="lot-info">
                    <div class="lot-name">${this.escapeHtml(lot.name)}</div>
                    <div class="lot-amount">$${lot.amount.toFixed(2)} • ${lot.active ? 'Active' : 'Inactive'}</div>
                </div>
                <div class="lot-actions">
                    <button class="btn-edit" onclick="app.editLot('${lot.id}')">Edit</button>
                    <button class="btn-delete" onclick="app.deleteLot('${lot.id}')">Delete</button>
                </div>
            `;
            
            this.lotsList.appendChild(li);
        }

        // Update statistics
        document.getElementById('total-lots')!.textContent = 
            this.lotManager.getTotalCount().toString();
        document.getElementById('active-lots')!.textContent = 
            this.lotManager.getActiveCount().toString();

        // Update renderer segments
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.settings.mode);
        this.renderer.setHighlightedLot(this.highlightedLotId);
    }

    /**
     * Escapes HTML to prevent XSS.
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Renders the current frame.
     */
    render(): void {
        this.renderer.render();
    }

    // Public methods for button handlers (attached via onclick)
    editLot(id: string): void {
        const lot = this.lotManager.getLotById(id);
        if (!lot) return;

        const newName = prompt('Enter new name:', lot.name);
        if (newName === null) return;

        const newAmount = prompt(`Enter new amount (current: ${lot.amount}):`, lot.amount.toString());
        if (newAmount === null) return;

        this.lotManager.updateLot(id, {
            name: newName,
            amount: parseFloat(newAmount) || 1
        });

        this.updateUI();
        this.render();
    }

    deleteLot(id: string): void {
        if (!confirm('Are you sure you want to delete this lot?')) return;

        this.lotManager.deleteLot(id);
        
        // Clear highlight if deleted lot was highlighted
        if (this.highlightedLotId === id) {
            this.highlightedLotId = null;
        }

        this.updateUI();
        this.render();
    }
}

// Initialize the application when DOM is ready
let app: App;

document.addEventListener('DOMContentLoaded', () => {
    app = new App();
    
    // Expose app for button handlers
    (window as any).app = app;
});
