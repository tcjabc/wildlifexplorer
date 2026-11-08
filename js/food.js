// The Food stage: photos of what the animal eats, from its own "stage": { "food": [{ image, credit },
// …] } in data/animals.json, one to three of them. Prey is always shown alive. The view is in
// js/stage-views.js; tested in tests/food.test.mjs.
import { stagePicture } from './habitat.js';

export const FOOD_MAX = 3;

// The card's food photos, as picture records like card.photo; none it can show is an empty list.
export function foodOf(card) {
  const list = card?.stage?.food;
  return Array.isArray(list) ? list.map(stagePicture).filter(Boolean).slice(0, FOOD_MAX) : [];
}
