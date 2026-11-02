// When each pack is due. Every profile has its own timeline: drop 1 (Series 1, Week 1)
// arrives the moment the profile is made, then one drop a week on the profile's drop day
// and time, with one week off between series. The order of drops (data/drops.json) is
// the same for everyone; only the dates differ.

// Week number (from 0) of drop n, counting the week off after every series.
export const weekOf = (n, seriesDrops) => n + Math.floor(n / seriesDrops);

// The first drop day/time at least six days after the previous drop (plus a week for every
// week off in between). In steady state that is exactly a week later; after the parents
// change the drop day, the next drop moves to the new day without coming twice in a week.
export function nextDue(prevDue, { dropDay, dropTime }, weeksOff = 0) {
  const [hh, mm] = dropTime.split(':').map(Number);
  const d = new Date(prevDue);
  d.setDate(d.getDate() + 6 + 7 * weeksOff); // calendar days, so clock changes don't drift it
  const earliest = d.getTime();
  d.setHours(hh, mm, 0, 0);
  d.setDate(d.getDate() + ((dropDay - d.getDay() + 7) % 7));
  if (d.getTime() < earliest) d.setDate(d.getDate() + 7);
  return d;
}

// Due time of drop n, given the previous granted pack (null for the first drop).
export function dueAt(n, prev, { startAt, parent, seriesDrops }) {
  if (!prev) return new Date(startAt);
  return nextDue(new Date(prev.dueAt), parent, weekOf(n, seriesDrops) - weekOf(prev.seq, seriesDrops) - 1);
}
