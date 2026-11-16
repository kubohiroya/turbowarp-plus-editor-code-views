/**
 * Full-width characters in number arguments.
 *
 * Every argument that takes a number (`math_number`, `math_integer`, `math_angle`, the list index
 * of `data_listindexall` and so on) edits through a `FieldTextInput` subclass that was given a
 * restrictor, a pattern of the characters it accepts. scratch-blocks tests that pattern only on
 * `keypress`, and text an IME commits arrives through `input` alone, so `１０` passes and the VM
 * reads it as 0. This converts full-width digits and signs to their half-width forms and drops
 * what the restrictor would have refused, for every field with a restrictor and no other.
 */

/** Characters an IME commits for a sign or a decimal point, beyond the full-width ASCII block. */
const signs: Readonly<Record<string, string>> = {
    'ー': '-', // KATAKANA-HIRAGANA PROLONGED SOUND MARK, what the minus key gives in kana mode
    '−': '-', // MINUS SIGN
    '‐': '-', // HYPHEN
    '‑': '-', // NON-BREAKING HYPHEN
    '–': '-', // EN DASH
    '。': '.' // IDEOGRAPHIC FULL STOP, what the period key gives in kana mode
};

const fullWidth = /[！-～]/g;

/**
 * Half-width forms of full-width ASCII (U+FF01–U+FF5E) and of the signs above.
 * @param {string} text The value.
 * @returns {string} The value with those characters replaced.
 */
export const toHalfWidth = (text: string): string => {
    let result = '';
    for (const character of text.replace(fullWidth, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))) {
        result += signs[character] ?? character;
    }
    return result;
};

/**
 * A number field's value with full-width characters converted and refused characters dropped.
 * @param {string} text The value.
 * @param {RegExp} restrictor The field's restrictor, which tests one character.
 * @returns {string} The value the field accepts.
 */
export const normalizeNumberText = (text: string, restrictor: RegExp): string => {
    let result = '';
    for (const character of toHalfWidth(text)) {
        restrictor.lastIndex = 0;
        if (restrictor.test(character)) result += character;
    }
    return result;
};

type HtmlInput = HTMLInputElement & {oldValue_?: string};

const installed = new WeakSet<object>();
const compositionHandlers = new WeakMap<HtmlInput, EventListener>();

/**
 * Rewrite the editor's value in place, keeping the caret after the same characters.
 * @param {HTMLInputElement} input The inline editor.
 * @param {RegExp} restrictor The field's restrictor.
 */
const normalizeInput = (input: HtmlInput, restrictor: RegExp) => {
    const {value} = input;
    const normalized = normalizeNumberText(value, restrictor);
    if (normalized === value) return;
    let caret: number | null = null;
    try {
        if (input.selectionEnd !== null) caret = normalizeNumberText(value.slice(0, input.selectionEnd), restrictor).length;
    } catch {
        // Some input types have no selection.
    }
    input.value = normalized;
    if (caret !== null) {
        try {
            input.setSelectionRange(caret, caret);
        } catch {
            // Same as above.
        }
    }
};

/**
 * Normalize number fields as they are typed.
 * Only fields with a restrictor change: text arguments, which have none, keep full-width text.
 * While an IME is composing the text is left alone, and it is normalized once the composition ends.
 * @param {object} ScratchBlocks The loaded ScratchBlocks.
 */
export const installBlockNumberInput = ScratchBlocks => {
    const FieldTextInput = ScratchBlocks?.FieldTextInput;
    const field = FieldTextInput?.prototype;
    if (!field?.onHtmlInputChange_ || !field.bindEvents_ || !field.unbindEvents_ || installed.has(field)) return;
    installed.add(field);

    const {onHtmlInputChange_: onChange, bindEvents_: bindEvents, unbindEvents_: unbindEvents} = field;

    field.onHtmlInputChange_ = function (event, ...rest) {
        const input: HtmlInput | undefined = FieldTextInput.htmlInput_;
        // A keypress is still filtered by the inherited code, before the character is inserted.
        if (this.restrictor_ instanceof RegExp && input && event?.type !== 'keypress' && !event?.isComposing) {
            normalizeInput(input, this.restrictor_);
        }
        return onChange.call(this, event, ...rest);
    };

    field.bindEvents_ = function (htmlInput: HtmlInput, ...rest) {
        const result = bindEvents.call(this, htmlInput, ...rest);
        if (this.restrictor_ instanceof RegExp && htmlInput?.addEventListener) {
            // Chrome sends the last `input` of a composition while it is still composing.
            const handler = (event: Event) => this.onHtmlInputChange_(event);
            compositionHandlers.set(htmlInput, handler);
            htmlInput.addEventListener('compositionend', handler);
        }
        return result;
    };

    field.unbindEvents_ = function (htmlInput: HtmlInput, ...rest) {
        const handler = htmlInput && compositionHandlers.get(htmlInput);
        if (handler) {
            htmlInput.removeEventListener('compositionend', handler);
            compositionHandlers.delete(htmlInput);
        }
        return unbindEvents.call(this, htmlInput, ...rest);
    };
};
