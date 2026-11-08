// The Food stage: what the animal eats, one food at a time. Each food is an emoji (stats.dietIcons,
// one per food its text names; Emoji 11 or older, for the baseline tablet's Android 9) and, where
// there is one, its photo: "stage": { "food": [{ icon, image, credit }, …] }, prey always alive. The
// view is in js/stage-views.js; tested in tests/food.test.mjs.
import { stagePicture } from './stage-pictures.js';

// The card's foods, in order: [{ icon, pic }], pic a picture record (like card.photo) or null. Each
// photo goes with the first unclaimed emoji the same as its own, so two deer can each have theirs. A
// photo whose emoji isn't in the list still shows, after the others.
export function foodOf(card) {
  const icons = Array.isArray(card?.stats?.dietIcons) ? card.stats.dietIcons : [];
  const list = Array.isArray(card?.stage?.food) ? card.stage.food : [];
  const left = list.map(f => ({ icon: f?.icon, pic: stagePicture(f) })).filter(f => f.pic);
  const items = icons.map(icon => {
    const i = left.findIndex(f => f.icon === icon);
    return { icon, pic: i >= 0 ? left.splice(i, 1)[0].pic : null };
  });
  return items.concat(left.map(f => ({ icon: f.icon ?? '🍽️', pic: f.pic })));
}

// Just the photos, for the credits and the build.
export const foodPhotos = card => foodOf(card).map(f => f.pic).filter(Boolean);
