// Small dependency-free DOM for controller tests, not a layout/browser substitute.
export function installDomEnvironment() {
    const saved = new Map();
    const expose = (key, value) => {
        saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    };
    class DomEvent {
        constructor(type, options = {}) { Object.assign(this, { type, bubbles: false, cancelable: false, defaultPrevented: false }, options); }
        preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
        stopPropagation() { this.stopped = true; }
    }
    class Target {
        listeners = new Map();
        addEventListener(type, callback, options = {}) {
            const entries = this.listeners.get(type) || [];
            if (!entries.some(e => e.callback === callback)) entries.push({ callback, once: options.once });
            this.listeners.set(type, entries);
        }
        removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(e => e.callback !== callback)); }
        dispatchEvent(event) {
            if (!event.target) event.target = this;
            event.currentTarget = this;
            this['on' + event.type]?.call(this, event);
            for (const entry of [...(this.listeners.get(event.type) || [])]) {
                if (entry.once) this.removeEventListener(event.type, entry.callback);
                entry.callback.call(this, event);
            }
            if (event.bubbles && !event.stopped) this.parentNode?.dispatchEvent(event);
            return !event.defaultPrevented;
        }
    }
    const dataKey = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const decode = text => text.replace(/&(?:amp|lt|gt|quot|times|#39);/g, s => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&times;': '×', '&#39;': "'" })[s]);
    function simpleMatch(el, selector) {
        if (selector === '*') return true;
        selector = selector.replace(/:not\(([^)]+)\)/g, (_, s) => simpleMatch(el, s) ? '__never__' : '');
        if (/:checked/.test(selector) && !el.checked) return false;
        if (/:disabled/.test(selector) && !el.disabled) return false;
        selector = selector.replace(/:(checked|disabled)/g, '');
        const attrs = [...selector.matchAll(/\[([^\]=~^$*|\s]+)(?:\s*([~^$*|]?=)\s*["']?([^\]"']*)["']?)?\]/g)];
        for (const [, name, op, value] of attrs) {
            const actual = el.getAttribute(name);
            if (actual === null || (op === '=' && actual !== value) || (op === '^=' && !actual.startsWith(value)) || (op === '*=' && !actual.includes(value))) return false;
        }
        selector = selector.replace(/\[[^\]]+\]/g, '');
        const tag = selector.match(/^[\w-]+/);
        if (tag && tag[0].toUpperCase() !== el.tagName) return false;
        for (const [, id] of selector.matchAll(/#([\w-]+)/g)) if (el.id !== id) return false;
        for (const [, cls] of selector.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(cls)) return false;
        return !selector.includes('__never__');
    }
    function matches(el, selector) {
        return selector.split(',').some(part => {
            const bits = part.trim().split(/\s+(?![^\[]*\])/);
            let cursor = el;
            if (!simpleMatch(cursor, bits.pop())) return false;
            while (bits.length) {
                let bit = bits.pop();
                const direct = bit === '>';
                if (direct) bit = bits.pop();
                cursor = cursor.parentNode;
                while (cursor && cursor.tagName && !simpleMatch(cursor, bit) && !direct) cursor = cursor.parentNode;
                if (!cursor?.tagName || !simpleMatch(cursor, bit)) return false;
            }
            return true;
        });
    }
    class Element extends Target {
        constructor(tag) {
            super(); this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
            this.attributes = new Map(); this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
            this.value = ''; this.disabled = false; this.readOnly = false; this.checked = false; this.hidden = false; this._text = '';
            this.classList = {
                contains: name => this.className.split(/\s+/).includes(name),
                add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
                remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
                toggle: (name, force) => { const on = force ?? !this.classList.contains(name); this.classList[on ? 'add' : 'remove'](name); return on; }
            };
        }
        get className() { return this.attributes.get('class') || ''; }
        set className(v) { this.attributes.set('class', String(v)); }
        get id() { return this.attributes.get('id') || ''; }
        set id(v) { this.attributes.set('id', String(v)); }
        get parentElement() { return this.parentNode?.tagName ? this.parentNode : null; }
        get childNodes() { return this.children; }
        get firstChild() { return this.children[0] || null; }
        get firstElementChild() { return this.firstChild; }
        get isConnected() { return this === document.documentElement || !!this.parentNode?.isConnected; }
        get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
        set textContent(v) { this.replaceChildren(); this._text = String(v ?? ''); }
        set innerHTML(html) {
            this.replaceChildren(); this._text = '';
            const stack = [this];
            for (const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
                if (token.startsWith('<!--') || /^<!/.test(token)) continue;
                if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
                if (token.startsWith('<')) {
                    const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
                    const el = new Element(tag);
                    const body = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
                    for (const [, name, a, b, c] of body.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(name, decode(a ?? b ?? c ?? ''));
                    stack.at(-1).appendChild(el);
                    if (!/^(input|br|hr|img|meta|link)$/i.test(tag) && !token.endsWith('/>')) stack.push(el);
                } else stack.at(-1)._text += decode(token);
            }
        }
        get innerHTML() { return this.textContent; }
        setAttribute(name, value) {
            value = String(value); this.attributes.set(name, value);
            if (name.startsWith('data-')) this.dataset[dataKey(name.slice(5))] = value;
            if (['value', 'type', 'title'].includes(name)) this[name] = value;
            if (name === 'readonly') this.readOnly = true;
            if (['disabled', 'checked', 'hidden'].includes(name)) this[name] = true;
        }
        getAttribute(name) {
            if (name.startsWith('data-')) return this.dataset[dataKey(name.slice(5))] ?? null;
            return this.attributes.get(name) ?? null;
        }
        hasAttribute(name) { return this.getAttribute(name) !== null; }
        removeAttribute(name) { this.attributes.delete(name); if (name.startsWith('data-')) delete this.dataset[dataKey(name.slice(5))]; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? Object.assign(new Element('span'), { textContent: child }) : child); }
        insertBefore(child, before) { if (!before) return this.appendChild(child); child.remove(); this.children.splice(this.children.indexOf(before), 0, child); child.parentNode = this; return child; }
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
        remove() { this.parentNode?.removeChild(this); }
        replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...children); }
        contains(child) { return child === this || this.children.some(c => c.contains(child)); }
        matches(selector) { return matches(this, selector); }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
        querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
        click() { if (!this.disabled) this.dispatchEvent(new DomEvent('click', { bubbles: true })); }
        focus() { document.activeElement = this; this.dispatchEvent(new DomEvent('focus')); }
        blur() { document.activeElement = document.body; this.dispatchEvent(new DomEvent('blur')); }
    }
    const document = new Target();
    document.documentElement = new Element('html');
    document.head = new Element('head'); document.body = new Element('body');
    document.documentElement.append(document.head, document.body);
    document.documentElement.parentNode = document;
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.querySelector('#' + id);
    document.querySelectorAll = selector => [...(document.documentElement.matches(selector) ? [document.documentElement] : []), ...document.documentElement.querySelectorAll(selector)];
    document.querySelector = selector => document.querySelectorAll(selector)[0] ?? null;
    document.activeElement = document.body;
    const window = new Target();
    Object.assign(window, { document, Event: DomEvent, KeyboardEvent: DomEvent, MouseEvent: DomEvent, HTMLElement: Element, innerWidth: 1280, innerHeight: 800 });
    for (const [key, value] of Object.entries({ document, window, Event: DomEvent, KeyboardEvent: DomEvent, MouseEvent: DomEvent, HTMLElement: Element, HTMLInputElement: Element, HTMLButtonElement: Element, HTMLSelectElement: Element, navigator: { language: 'en', languages: ['en'] } })) expose(key, value);
    return { document, window, createElement: document.createElement, cleanup() {
        for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    } };
}
