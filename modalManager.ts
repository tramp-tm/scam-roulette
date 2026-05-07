/**
 * Singleton manager for modal dialogs.
 * Handles z-index stacking and tracks open modals in order.
 */
export class ModalManager {
    private static instance: ModalManager;
    
    private zIndexCounter = 1000;
    protected openModals: HTMLElement[] = [];

    private constructor() {}

    public static getInstance(): ModalManager {
        if (!ModalManager.instance) {
            ModalManager.instance = new ModalManager();
        }
        return ModalManager.instance;
    }

    /**
     * Gets the next available z-index for a new modal.
     */
    public getNextZIndex(): number {
        return ++this.zIndexCounter;
    }

    /**
     * Registers an open modal in the stack.
     */
    public registerModal(modalElement: HTMLElement): void {
        this.openModals.push(modalElement);
    }

    /**
     * Unregisters a closed modal from the stack.
     */
    public unregisterModal(modalElement: HTMLElement): void {
        const index = this.openModals.indexOf(modalElement);
        if (index !== -1) {
            this.openModals.splice(index, 1);
        }
    }

    /**
     * Gets the count of currently open modals.
     */
    public getOpenModalCount(): number {
        return this.openModals.length;
    }

    /**
     * Checks if any modal is currently open.
     */
    public hasOpenModals(): boolean {
        return this.openModals.length > 0;
    }

    /**
     * Gets the topmost (last opened) modal element.
     */
    public getTopmostModal(): HTMLElement | undefined {
        return this.openModals[this.openModals.length - 1];
    }

    /**
     * Checks if a given modal is currently the topmost one.
     */
    public isTopmost(modalElement: HTMLElement): boolean {
        const topmost = this.getTopmostModal();
        return topmost === modalElement;
    }
}
