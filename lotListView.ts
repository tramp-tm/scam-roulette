import type { AccentKind, ModePresentationData } from './types.js';

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
    /**
     * Mode-owned presentation payload (e.g. the "ext" column). Opaque to this
     * view: it is only carried through and, for `ext`, rendered verbatim.
     */
    modeData?: ModePresentationData;
}

/**
 * Options for rendering a lots list via `LotListView`.
 */
export interface LotListViewOptions {
    showActions?: boolean;
    /**
     * Accent per lot id (already filtered to the `list` target). Purely
     * presentational: the view maps each kind to a CSS class and never
     * interprets its meaning.
     */
    accents?: ReadonlyMap<string, AccentKind>;
    editableAmount?: boolean;
    onAmountChange?: (id: string, newAmount: number) => void;
    onDelete?: (id: string) => void;
    /**
     * Reports the transient hover state as a stable lot id (or `null` when the
     * pointer leaves a row). The caller decides what to do with it; the view
     * neither interprets it nor stores it as application/game state.
     */
    onLotHover?: (lotId: string | null) => void;
    /**
     * When true, render the mode-provided extra-info column for each lot
     * (`modeData.ext.value`). Purely presentational: the value's meaning and
     * formatting live in the current GameMode.
     */
    extEnabled?: boolean;
    /**
     * When true, list only the lots that are currently ACTIVE — the same
     * predicate that adds the `inactive` row class, so a filtered-out lot is
     * exactly one that would have been drawn as inactive. Purely presentational:
     * it filters the VIEW only; participation, selection weights and the
     * visualization are untouched.
     */
    activeOnly?: boolean;
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
 *     attributes (this file does not import the i18n `t` helper).
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
            accents,
            editableAmount = true,
            onAmountChange,
            onDelete,
            onLotHover,
            extEnabled = false,
            activeOnly = false
        } = options;

        // Sorting happens on a copy — the caller's array is never mutated, and
        // `activeOnly` filters that copy (never the caller's array).
        const visible = activeOnly ? lots.filter(l => l.active) : [...lots];
        const sorted = visible.sort((a, b) => {
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
            // Accent is looked up by stable `lot.id`; the kind becomes a CSS
            // class verbatim (`accent-good`, …).
            const accent = lot.id ? accents?.get(lot.id) : undefined;
            if (accent) classNameParts.push(`accent-${accent}`);
            li.className = classNameParts.join(' ');

            // Hover is surfaced by stable `lot.id` (never an index/position), so
            // it survives the rebuild that sorting performs.
            if (lot.id && onLotHover) {
                const lotId: string = lot.id;
                li.addEventListener('mouseenter', () => onLotHover(lotId));
                li.addEventListener('mouseleave', () => onLotHover(null));
            }

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

            // Extra-info column: the value is the mode's (`modeData.ext.value`);
            // this view only displays it and never computes/interprets it.
            if (extEnabled) {
                const ext = document.createElement('span');
                ext.className = 'lot-ext';
                ext.textContent = lot.modeData?.ext?.value ?? '';
                li.appendChild(ext);
            }

            // Actions are always rendered when the list shows them; an accent is
            // purely visual and must never remove controls. Locking (spin in
            // progress / finished game) is expressed by `applyLockState()` as a
            // `disabled` state, not by hiding the button.
            if (showActions) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'lot-actions';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete';
                deleteBtn.textContent = '×';

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
