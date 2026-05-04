import { LotManager } from './lotManager.js';
import { Renderer } from './renderer.js';
import { RouletteEngine } from './rouletteEngine.js';
import { AnimationController, EasingFunctions } from './animation.js';
import { Settings, Mode, VisualizationType, AppState, Lot } from './types.js';

/**
 * Main application controller for the roulette game.
 */
export class App {
    private lotManager: LotManager;
    private renderer: Renderer;
    private animationController: AnimationController;
    
    private settings: Settings = {
        mode: 'normal',
        visualization: 'wheel',
        animationDuration: 3000
    };
    
    private highlightedLotId: string | null = null;
    private isSettingsLocked: boolean = false;
    private endRotation: number = 0;

    // DOM elements
    private canvas: HTMLCanvasElement;
    private resultDisplay: HTMLElement;
    private resultText: HTMLElement;
    private spinBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    
    // Form elements
    private lotNameInput: HTMLInputElement;
    private lotAmountInput: HTMLInputElement;
    private lotColorInput: HTMLInputElement;
    private lotsList: HTMLUListElement;
    
    // Settings elements
    private modeSelect: HTMLSelectElement;
    private visualizationSelect: HTMLSelectElement;
    private durationSlider: HTMLInputElement;
    private durationValue: HTMLElement;
    private spinsSlider: HTMLInputElement;
    private spinsValue: HTMLElement;

    constructor() {
        this.lotManager = new LotManager([]);
        this.renderer = new Renderer(document.getElementById('roulette-canvas') as HTMLCanvasElement);
        this.animationController = new AnimationController();
        
        // Initialize DOM elements
        this.canvas = document.getElementById('roulette-canvas') as HTMLCanvasElement;
        this.resultDisplay = document.getElementById('result-display');
        this.resultText = document.getElementById('result-text');
        this.spinBtn = document.getElementById('spin-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        
        // Form elements
        this.lotNameInput = document.getElementById('lot-name') as HTMLInputElement;
        this.lotAmountInput = document.getElementById('lot-amount') as HTMLInputElement;
        this.lotColorInput = document.getElementById('lot-color') as HTMLInputElement;
        this.lotsList = document.getElementById('lots-list') as HTMLUListElement;
        
        // Settings elements
        this.modeSelect = document.getElementById('mode-select') as HTMLSelectElement;
        this.visualizationSelect = document.getElementById('visualization-select') as HTMLSelectElement;
        this.durationSlider = document.getElementById('duration-slider') as HTMLInputElement;
        this.durationValue = document.getElementById('duration-value');
        this.spinsSlider = document.getElementById('spins-slider') as HTMLInputElement;
        this.spinsValue = document.getElementById('spins-value');

        // Initialize UI
        this.updateUI();
        
        // Event listeners
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Form submission
        const form = document.getElementById('lot-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addLot();
            });
        }
        
        // Spin button
        this.spinBtn.addEventListener('click', () => this.spin());
        
        // Reset button
        this.resetBtn.addEventListener('click', () => this.reset());
        
        // Settings changes
        this.modeSelect.addEventListener('change', (e) => {
            this.settings.mode = e.target.value as Mode;
            this.updateUI();
        });
        
        this.visualizationSelect.addEventListener('change', (e) => {
            this.settings.visualization = e.target.value as VisualizationType;
            this.renderer.setVisualizationType(this.settings.visualization);
            this.render();
        });
        
        // Duration slider
        this.durationSlider.addEventListener('input', () => {
            const duration = parseInt(this.durationSlider.value);
            this.settings.animationDuration = duration;
            this.durationValue.textContent = `${(duration / 1000).toFixed(1)}s`;
        });
        
        // Spins slider
        this.spinsSlider.addEventListener('input', () => {
            this.spinsValue.textContent = this.spinsSlider.value;
        });
    }

    private addLot(): void {
        const name = this.lotNameInput.value.trim();
        const amount = parseFloat(this.lotAmountInput.value);
        const color = this.lotColorInput.value;

        if (!name || isNaN(amount)) return;

        this.lotManager.addLot(name, amount, color);
        
        // Clear form
        this.lotNameInput.value = '';
        this.lotAmountInput.value = '1';
        
        this.updateUI();
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
        
        // Select winner
        const winner = RouletteEngine.selectWeighted(activeLots, this.settings.mode);
        if (!winner) return;

        // Calculate final rotation
        const currentRotation = this.renderer.getCurrentRotation();
        const targetLotId = winner.id;
        const animationDuration = this.settings.animationDuration;
        
        this.endRotation = RouletteEngine.computeFinalRotation(
            activeLots,
            this.settings.mode,
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

        const rotationToLog = finalRotation ?? this.renderer.getCurrentRotation();
        console.group('Animation Debug Info');
        console.log(`Final rotation value: ${rotationToLog.toFixed(6)} rad (${(rotationToLog * 180 / Math.PI).toFixed(2)}°)`);
        console.log(`Normalized final angle: ${(rotationToLog % (Math.PI * 2)).toFixed(6)} rad (${((rotationToLog % (Math.PI * 2)) * 180 / Math.PI).toFixed(2)}°)`);
        console.groupEnd();

        // Unlock settings
        this.isSettingsLocked = false;
        this.updateControlsState();
        
        // Re-render with updated state
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.settings.mode);
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
        this.renderer.updateSegments(this.lotManager.getActiveLots(), this.settings.mode);
        
        // Hide result display
        this.resultDisplay.classList.add('hidden');
        
        // Update UI
        this.updateUI();
    }

    private updateUI(): void {
        // Update lots list
        this.renderLotsList();
        
        // Update stats
        document.getElementById('total-lots')!.textContent = this.lotManager.getTotalCount().toString();
        document.getElementById('active-lots')!.textContent = this.lotManager.getActiveCount().toString();
        
        // Update controls state
        this.updateControlsState();
    }

    private updateControlsState(): void {
        const isAnimating = this.animationController.isAnimating();
        
        this.spinBtn.disabled = this.isSettingsLocked || isAnimating;
        this.resetBtn.disabled = isAnimating;
        
        // Disable form inputs when locked
        const formInputs = document.querySelectorAll('#lot-form input');
        formInputs.forEach(input => {
            input.disabled = this.isSettingsLocked;
        });
    }

    private renderLotsList(): void {
        this.lotsList.innerHTML = '';
        
        const lots = this.lotManager.getAllLots();
        
        for (const lot of lots) {
            const li = document.createElement('li');
            li.className = `lot-item ${lot.active ? '' : 'inactive'} ${lot.id === this.highlightedLotId ? 'highlighted' : ''}`;
            
            // Color indicator
            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'lot-color-indicator';
            colorIndicator.style.backgroundColor = lot.color;
            
            // Lot info
            const lotInfo = document.createElement('div');
            lotInfo.className = 'lot-info';
            
            const lotName = document.createElement('div');
            lotName.className = 'lot-name';
            lotName.textContent = lot.name;
            
            const lotAmount = document.createElement('div');
            lotAmount.className = 'lot-amount';
            lotAmount.textContent = `$${lot.amount.toFixed(2)} • ${lot.active ? 'Active' : 'Inactive'}`;
            
            lotInfo.appendChild(lotName);
            lotInfo.appendChild(lotAmount);
            
            // Actions
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'lot-actions';
            
            if (lot.id !== this.highlightedLotId) {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-edit';
                editBtn.textContent = 'Edit';
                editBtn.onclick = () => this.editLot(lot.id);
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.textContent = 'Delete';
                deleteBtn.onclick = () => this.deleteLot(lot.id);
                
                actionsDiv.appendChild(editBtn);
                actionsDiv.appendChild(deleteBtn);
            }
            
            li.appendChild(colorIndicator);
            li.appendChild(lotInfo);
            li.appendChild(actionsDiv);
            
            this.lotsList.appendChild(li);
        }
    }

    private editLot(id: string): void {
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
    }

    private deleteLot(id: string): void {
        if (!confirm('Are you sure you want to delete this lot?')) return;

        this.lotManager.deleteLot(id);
        
        // Clear highlight if deleted lot was highlighted
        if (this.highlightedLotId === id) {
            this.highlightedLotId = null;
        }

        this.updateUI();
    }

    private render(): void {
        this.renderer.render();
    }
}
