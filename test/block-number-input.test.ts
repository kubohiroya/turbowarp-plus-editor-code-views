import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {installBlockNumberInput, normalizeNumberText, toHalfWidth} from '../dist/block-number-input.js';

// Restrictors as scratch-blocks builds them: FieldNumber.getNumRestrictor for math_number,
// math_integer and math_whole_number, and the fixed one of FieldAngle.
const number = /[\d]|[\.]|[-]|[eE]/;
const integer = /[\d]|[-]/;
const whole = /[\d]/;
const angle = new RegExp('[\\d]|[\\.]|[-]|[eE]');

test('full-width digits and signs become half-width', () => {
    assert.equal(toHalfWidth('０１２３４５６７８９'), '0123456789');
    assert.equal(toHalfWidth('－３．５ｅ２'), '-3.5e2');
    assert.equal(toHalfWidth('ー１。５'), '-1.5');
    assert.equal(toHalfWidth('−２'), '-2');
    assert.equal(toHalfWidth('あ１'), 'あ1');
});

test('characters the restrictor refuses are dropped', () => {
    assert.equal(normalizeNumberText('１０', number), '10');
    assert.equal(normalizeNumberText('－３．５', number), '-3.5');
    assert.equal(normalizeNumberText('－３．５', integer), '-35');
    assert.equal(normalizeNumberText('－３', whole), '3');
    assert.equal(normalizeNumberText('９０度', angle), '90');
    assert.equal(normalizeNumberText('12', number), '12');
});

// Shapes from scratch-blocks core/field_textinput.js, reduced to what the patch reads.
function fixture() {
    const {window} = new JSDOM('<!doctype html><body></body>');
    const document = window.document;
    const changes: string[] = [];
    class FieldTextInput {
        static htmlInput_: any = null;
        restrictor_: RegExp | null;
        text_ = '';
        constructor(restrictor: RegExp | null = null) {
            this.restrictor_ = restrictor;
        }
        onHtmlInputChange_(event: {type: string}) {
            if (event.type === 'keypress') return;
            const input = FieldTextInput.htmlInput_;
            if (input.value !== input.oldValue_) {
                input.oldValue_ = input.value;
                this.text_ = input.value;
                changes.push(input.value);
            }
        }
        bindEvents_(htmlInput: HTMLInputElement) {
            htmlInput.addEventListener('input', event => this.onHtmlInputChange_(event));
        }
        unbindEvents_() {}
    }
    installBlockNumberInput({FieldTextInput});
    const edit = (restrictor: RegExp | null) => {
        const field = new FieldTextInput(restrictor);
        const input = document.createElement('input');
        document.body.append(input);
        FieldTextInput.htmlInput_ = input;
        field.bindEvents_(input);
        const type = (value: string, init: {isComposing?: boolean} = {}) => {
            input.value = value;
            input.dispatchEvent(new window.InputEvent('input', init));
        };
        return {field, input, type};
    };
    return {window, changes, edit, FieldTextInput};
}

test('a committed full-width number is stored half-width', () => {
    const {changes, edit} = fixture();
    const {field, input, type} = edit(number);
    type('１０');
    assert.equal(input.value, '10');
    assert.equal(field.text_, '10');
    assert.deepEqual(changes, ['10']);
});

test('text arguments keep full-width text', () => {
    const {edit} = fixture();
    const {field, type} = edit(null);
    type('１０');
    assert.equal(field.text_, '１０');
});

test('the composing text is left to the IME and normalized when the composition ends', () => {
    const {window, edit} = fixture();
    const {field, input, type} = edit(number);
    type('１', {isComposing: true});
    assert.equal(input.value, '１');
    type('１２', {isComposing: true});
    input.dispatchEvent(new window.CompositionEvent('compositionend'));
    assert.equal(input.value, '12');
    assert.equal(field.text_, '12');
});

test('the caret stays after the same characters', () => {
    const {edit} = fixture();
    const {input} = edit(number);
    input.value = '1２3';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new input.ownerDocument.defaultView.InputEvent('input'));
    assert.equal(input.value, '123');
    assert.equal(input.selectionStart, 2);
});

test('unbinding stops listening for the end of a composition', () => {
    const {window, edit} = fixture();
    const {field, input} = edit(number);
    field.unbindEvents_(input);
    input.value = '３';
    input.dispatchEvent(new window.CompositionEvent('compositionend'));
    assert.equal(input.value, '３');
});

test('installing twice wraps the field once', () => {
    const {FieldTextInput} = fixture();
    const {onHtmlInputChange_, bindEvents_, unbindEvents_} = FieldTextInput.prototype;
    installBlockNumberInput({FieldTextInput});
    assert.equal(FieldTextInput.prototype.onHtmlInputChange_, onHtmlInputChange_);
    assert.equal(FieldTextInput.prototype.bindEvents_, bindEvents_);
    assert.equal(FieldTextInput.prototype.unbindEvents_, unbindEvents_);
});
