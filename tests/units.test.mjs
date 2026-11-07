// Numbers with units on the cards (js/units.js). Strings aren't loaded here, so a unit shows as its key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/store.js';
import { lengthText, weightText } from '../js/units.js';

const as = system => { state.profile = { parent: { length: system } }; };

test('metric: small animals in grams, the rest in kilograms', () => {
  as('metric');
  assert.equal(weightText(0.062, 0.123).en, '62–123 unit.g');
  assert.equal(weightText(0.254, 0.26).en, '254–260 unit.g');
  assert.equal(weightText(0.4, 0.5).en, '400–500 unit.g');
  assert.equal(weightText(1.1).en, '1.1 unit.kg');
  assert.equal(weightText(0.7, 1.1).en, '0.7–1.1 unit.kg', 'one unit for the whole range');
  assert.equal(weightText(3000, 6000).en, '3,000–6,000 unit.kg');
});

test('under a centimetre in millimetres, in both systems', () => {
  as('metric');
  assert.equal(lengthText(0.05).en, '0.5 unit.mm');
  assert.equal(lengthText(0.007).en, '0.07 unit.mm');
  assert.equal(lengthText(0.1).en, '1 unit.mm');
  assert.equal(lengthText(21).en, '21 unit.cm');
  as('imperial');
  assert.equal(lengthText(0.05).en, '0.5 unit.mm');
  state.profile = null;
});

test('imperial: ounces under a pound', () => {
  as('imperial');
  assert.equal(weightText(0.254, 0.26).en, '9–9.2 unit.oz');
  assert.equal(weightText(50, 200).en, '110–441 unit.lb');
  state.profile = null;
});
