import { h, mount } from '../dom.js';
import { bi, tx, t } from '../i18n.js';
import { state, isVisible, mainImage, saveQuizScore } from '../store.js';
import { picture, readButton } from '../components.js';
import { chimeGood, chimeSoft, confetti } from '../fx.js';
import { stop } from '../speech.js';

const ROUND = 10;
const MIN_PICTURE_CARDS = 4;
const filled = f => f && (f.en || f.zh);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pickOne = list => list[Math.floor(Math.random() * list.length)];

const picturePool = () => state.cards.filter(c => isVisible(c) && mainImage(c));
const factPool = () => state.cards.filter(c => isVisible(c) && (c.facts ?? []).some(filled));

function pictureQuestions() {
  const pool = picturePool();
  return shuffle(pool).slice(0, ROUND).map(answer => {
    // Prefer look-alikes from the same group as wrong answers.
    const same = shuffle(pool.filter(c => c !== answer && c.group === answer.group));
    const other = shuffle(pool.filter(c => c !== answer && c.group !== answer.group));
    const options = shuffle([answer, ...[...same, ...other].slice(0, 3)]);
    return { kind: 'pictures', answer, options };
  });
}

function factQuestions() {
  const pool = factPool();
  const total = Math.min(ROUND, pool.reduce((n, c) => n + c.facts.filter(filled).length, 0));
  return Array.from({ length: total }, () => {
    const subject = pickOne(pool);
    const others = pool.filter(c => c !== subject);
    const truthy = !others.length || Math.random() < 0.5;
    const source = truthy ? subject : pickOne(others);
    return { kind: 'truefalse', subject, source, fact: pickOne(source.facts.filter(filled)), truth: truthy };
  });
}

const newQuestions = kind => (kind === 'pictures' ? pictureQuestions() : factQuestions());

function menu(main) {
  const pics = picturePool().length;
  const facts = factPool().length;
  const best = state.quiz.best ?? {};
  const choice = (kind, emoji, titleKey, ready, hint) => h('button', {
    class: 'choice', type: 'button', disabled: !ready,
    onclick: () => play(main, kind, newQuestions(kind)),
  },
  h('span', { class: 'choice__emoji', 'aria-hidden': 'true' }, emoji),
  h('span', { class: 'choice__title' }, tx(titleKey)),
  h('span', { class: 'choice__hint' }, hint),
  best[kind] > 0 && h('span', { class: 'choice__best' }, '⭐ ', tx('quiz.best', { n: best[kind] })));

  mount(main, h('section', { class: 'page quiz-menu' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🎯'), tx('quiz.title')),
    h('div', { class: 'choice-grid' },
      choice('pictures', '🖼️', 'quiz.pictures', pics >= MIN_PICTURE_CARDS,
        pics >= MIN_PICTURE_CARDS ? tx('quiz.picturesHint') : tx('quiz.needCards', { n: MIN_PICTURE_CARDS })),
      choice('truefalse', '✅', 'quiz.truefalse', facts >= 1,
        facts >= 1 ? tx('quiz.truefalseHint') : tx('quiz.needFacts')))));
}

function play(main, kind, questions) {
  let n = 0, score = 0;

  const show = () => {
    const q = questions[n];
    const total = questions.length;
    const feedback = h('div', { class: 'quiz__feedback', 'aria-live': 'polite' });
    const answers = [];

    const answer = (btn, correct) => {
      stop();
      answers.forEach(b => { b.disabled = true; });
      btn.classList.add(correct ? 'is-right' : 'is-wrong');
      if (correct) { score++; chimeGood(); } else chimeSoft();

      let explain = null;
      if (q.kind === 'pictures') {
        answers[q.options.indexOf(q.answer)].classList.add('is-right');
        if (!correct) explain = tx('quiz.itWas', { name: q.answer.name });
      } else {
        answers[q.truth ? 0 : 1].classList.add('is-right');
        if (!q.truth) explain = tx('quiz.factIsAbout', { name: q.source.name });
      }
      const last = n === total - 1;
      const nextBtn = h('button', {
        class: 'btn btn--accent btn--big', type: 'button',
        onclick: () => { n++; if (n < total) show(); else finish(); },
      }, tx(last ? 'quiz.finish' : 'quiz.next'));
      mount(feedback, h('div', { class: ['feedback', correct ? 'feedback--good' : 'feedback--bad'] },
        h('span', { class: 'feedback__icon', 'aria-hidden': 'true' }, correct ? '🎉' : '🤔'),
        h('div', null, h('p', { class: 'feedback__title' }, tx(correct ? 'quiz.correct' : 'quiz.wrong')), explain && h('p', null, explain)),
        nextBtn));
      nextBtn.focus({ preventScroll: true });
      feedback.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };

    const head = [
      h('p', { class: 'quiz__count' }, tx('quiz.question', { n: n + 1, total })),
      h('div', { class: 'quiz__dots', 'aria-hidden': 'true' },
        Array.from({ length: total }, (_, i) => h('span', { class: i < n ? 'is-done' : i === n ? 'is-now' : null }))),
    ];

    let body;
    if (q.kind === 'pictures') {
      q.options.forEach(c => answers.push(h('button', {
        class: 'answer', type: 'button', 'data-group': c.group,
        onclick: e => answer(e.currentTarget, c === q.answer),
      }, bi(c.name))));
      body = [
        h('div', { class: 'quiz__q' },
          h('h2', { class: 'quiz__prompt' }, tx('quiz.whoAmI')),
          readButton(() => [t('quiz.whoAmI'), ...q.options.map(c => c.name)])),
        h('div', { class: 'quiz__pic' }, picture(q.answer)),
        h('div', { class: 'answers answers--4' }, answers),
      ];
    } else {
      [[true, 'answer--true', '👍', 'quiz.true'], [false, 'answer--false', '👎', 'quiz.false']].forEach(([value, cls, icon, key]) =>
        answers.push(h('button', {
          class: ['answer', cls], type: 'button',
          onclick: e => answer(e.currentTarget, value === q.truth),
        }, h('span', { 'aria-hidden': 'true' }, icon), tx(key))));
      body = [
        h('div', { class: 'quiz__q' },
          h('h2', { class: 'quiz__prompt' }, tx('quiz.isThisAbout', { name: q.subject.name })),
          readButton(() => [t('quiz.isThisAbout', { name: q.subject.name }), q.fact])),
        h('div', { class: 'quiz__tf' },
          h('div', { class: 'quiz__pic quiz__pic--small' }, picture(q.subject)),
          h('blockquote', { class: 'quiz__fact' }, bi(q.fact))),
        h('div', { class: 'answers answers--2' }, answers),
      ];
    }

    mount(main, h('section', { class: 'page quiz' }, h('div', { class: 'quiz__body' }, head, body), feedback));
  };

  const finish = async () => {
    const best = await saveQuizScore(kind, score);
    const ratio = score / questions.length;
    const stars = ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio > 0 ? 1 : 0;
    const result = h('section', { class: 'page quiz-result' },
      h('p', { class: 'stars', 'aria-hidden': 'true' }, [0, 1, 2].map(i => h('span', { class: i < stars ? 'is-on' : null }, '★'))),
      h('h1', { class: 'page__title' }, tx('quiz.score', { n: score, total: questions.length })),
      h('p', { class: 'muted' }, tx('quiz.best', { n: best })),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn--accent btn--big', type: 'button', onclick: () => play(main, kind, newQuestions(kind)) }, tx('quiz.again')),
        h('button', { class: 'btn btn--soft btn--big', type: 'button', onclick: () => menu(main) }, tx('quiz.home'))));
    mount(main, result);
    if (stars >= 2) confetti(result);
  };

  show();
}

export function render(main) {
  menu(main);
  return () => stop();
}
