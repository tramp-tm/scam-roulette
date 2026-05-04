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
