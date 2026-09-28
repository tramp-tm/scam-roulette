/** Sort field options for lots list */
export type SortField = 'name' | 'amount';

/** Sort direction */
export type SortDirection = 'asc' | 'desc';

/**
 * Interface for lot data that can be rendered in a list.
 * Supports both full Lot objects and ParsedLot from CSV import.
 */
export interface RenderableLot {
    name: string;
    amount: number;
    id?: string;
    color?: string;
    active?: boolean;
}

/**
 * Options for rendering a lots list via `LotListView`.
 */
export interface LotListViewOptions {
    showActions?: boolean;
    highlightId?: string | null;
    editableAmount?: boolean;
    onAmountChange?: (id: string, newAmount: number) => void;
    onDelete?: (id: string) => void;
}

/**
 * LotListView
 * -----------
 * Presentation-only UI component for the lots list.
 *
 * Owns:
 *   - the list DOM (rebuilt on every render);
 *   - the sorting state (`sortField` / `sortDirection`) and the sort controls;
 *   - the disabled state of its own controls (amount inputs, delete buttons).
 *   - the sort-direction arrow, written into the `.sort-direction` span
 *     inside each sort button. The button's visible label lives in a
 *     sibling `.label-primary` span carrying `data-i18n`, so it is owned by
 *     translateDOM() and is never overwritten by this view.
 *
 * Does NOT own (and must not import or reference):
 *   - LotManager, GameSession, VisualizationDriver, App;
 *   - any lot mutation, session synchronisation, or visualization refresh;
 *   - confirmation dialogs or ErrorDialog;
 *   - translated strings — the view writes only direction glyphs, and the
 *     labels are translated by translateDOM() from the DOM's `data-i18n`
 *     attributes (this file no longer imports the i18n `t` helper at all).
 *
 * User actions inside the list are surfaced back to the caller through the
 * callbacks in `LotListViewOptions`; the caller decides whether and how to
 * mutate application state.
 */
export class LotListView {
    private readonly listContainer: HTMLUListElement;
    private readonly sortControls: HTMLElement | null;

    // Sorting is presentation state owned by this view.
    private sortField: SortField = 'name';
    private sortDirection: SortDirection = 'asc';

    // Lock state — driven only by `setLocked(boolean)`.
    private locked: boolean = false;

    // Cache of the latest render inputs so a sort click can re-render
    // without the caller having to re-supply the data.
    private lastLots: RenderableLot[] = [];
    private lastOptions: LotListViewOptions = {};

    constructor(listContainer: HTMLUListElement, sortControls: HTMLElement | null) {
        this.listContainer = listContainer;
        this.sortControls = sortControls;
        this.attachSortHandlers();
    }

    /**
     * Full re-render of the list. Sorting applies internally — callers pass
     * un-sorted data and need not care about sort order.
     */
    render(lots: RenderableLot[], options: LotListViewOptions = {}): void {
        this.lastLots = lots;
        this.lastOptions = options;

        const {
            showActions = false,
            highlightId = null,
            editableAmount = true,
            onAmountChange,
            onDelete
        } = options;

        // Sorting happens on a copy — the caller's array is never mutated.
        const sorted = [...lots].sort((a, b) => {
            if (this.sortField === 'name') {
                return this.sortDirection === 'asc'
                    ? a.name.localeCompare(b.name)
                    : b.name.localeCompare(a.name);
            }
            return this.sortDirection === 'asc'
                ? a.amount - b.amount
                : b.amount - a.amount;
        });

        this.listContainer.innerHTML = '';

        for (const lot of sorted) {
            const li = document.createElement('li');

            const classNameParts: string[] = ['lot-item'];
            if (!lot.active) classNameParts.push('inactive');
            if (lot.id === highlightId) classNameParts.push('highlighted');
            li.className = classNameParts.join(' ');

            const colorIndicator = document.createElement('div');
            colorIndicator.className = 'lot-color-indicator';
            colorIndicator.style.backgroundColor = lot.color || '#888';

            const lotName = document.createElement('span');
            lotName.className = 'lot-name';
            lotName.textContent = lot.name;
            lotName.style.flex = '1';
            lotName.style.overflow = 'hidden';
            lotName.style.textOverflow = 'ellipsis';

            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.className = 'lot-amount-input';
            amountInput.value = lot.amount.toFixed(2);
            amountInput.min = '0.01';
            amountInput.step = '0.01';

            if (!editableAmount) {
                amountInput.disabled = true;
            } else if (onAmountChange && lot.id) {
                const lotId: string = lot.id;
                amountInput.addEventListener('change', () => {
                    const newAmount = parseFloat(amountInput.value);
                    if (!isNaN(newAmount) && newAmount > 0) {
                        onAmountChange(lotId, newAmount);
                    } else {
                        amountInput.value = lot.amount.toFixed(2);
                    }
                });
            }

            li.appendChild(colorIndicator);
            li.appendChild(lotName);
            li.appendChild(amountInput);

            if (showActions && lot.id !== highlightId) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'lot-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.textContent = '×';
                deleteBtn.style.padding = '6px 10px';

                if (lot.id && onDelete) {
                    const lotId: string = lot.id;
                    deleteBtn.onclick = () => onDelete(lotId);
                }

                actionsDiv.appendChild(deleteBtn);
                li.appendChild(actionsDiv);
            }

            this.listContainer.appendChild(li);
        }

        // Freshly-created controls must inherit the current lock state.
        this.applyLockState();
    }

    /**
     * Applies the current lock state to the list's own controls. The boolean
     * is the only thing the view ever receives from the application layer.
     */
    setLocked(locked: boolean): void {
        this.locked = locked;
        this.applyLockState();
    }

    // --- Internal --------------------------------------------------------

    private attachSortHandlers(): void {
        if (!this.sortControls) return;
        const buttons = this.sortControls.querySelectorAll<HTMLElement>('.switch-btn');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const field = button.dataset.sortField as SortField | undefined;
                if (!field) return;
                this.setSortField(field);
            });
        });
    }

    private setSortField(field: SortField): void {
        if (this.sortField === field) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDirection = 'asc';
        }

        this.updateSortButtons();

        // Re-render with the cached inputs.
        this.render(this.lastLots, this.lastOptions);
    }

    /**
     * Refreshes the sort controls' `active` state and direction arrow.
     *
     * Only two DOM facets are touched here:
     *   - the `active` class on each button (which field is selected);
     *   - the text of each `.sort-direction` span (the ↑/↓ glyph).
     *
     * The button labels themselves are NOT written — they live in the
     * `.label-primary` spans and are owned by translateDOM(), keyed off
     * their `data-i18n` attributes. Writing the button's `textContent`
     * here would clobber the translated label on every sort click.
     */
    private updateSortButtons(): void {
        if (!this.sortControls) return;

        const nameBtn = this.sortControls.querySelector<HTMLButtonElement>('#sort-by-name');
        const amountBtn = this.sortControls.querySelector<HTMLButtonElement>('#sort-by-amount');
        if (!nameBtn || !amountBtn) return;

        const nameArrow = nameBtn.querySelector<HTMLSpanElement>('.sort-direction');
        const amountArrow = amountBtn.querySelector<HTMLSpanElement>('.sort-direction');

        nameBtn.classList.remove('active');
        amountBtn.classList.remove('active');
        if (nameArrow) nameArrow.textContent = '';
        if (amountArrow) amountArrow.textContent = '';

        const arrow = this.sortDirection === 'asc' ? '↑' : '↓';

        if (this.sortField === 'name') {
            nameBtn.classList.add('active');
            if (nameArrow) nameArrow.textContent = arrow;
        } else {
            amountBtn.classList.add('active');
            if (amountArrow) amountArrow.textContent = arrow;
        }
    }

    private applyLockState(): void {
        const amountInputs = this.listContainer.querySelectorAll<HTMLInputElement>('.lot-amount-input');
        amountInputs.forEach(el => { el.disabled = this.locked; });

        const deleteButtons = this.listContainer.querySelectorAll<HTMLButtonElement>('.btn-delete');
        deleteButtons.forEach(el => { el.disabled = this.locked; });
    }
}
