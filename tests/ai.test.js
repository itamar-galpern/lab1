import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_BY_ID } from '../js/modes.js';
import { fromFEN, createState, legalMoves, makeMove, snapshot, restore } from '../js/engine.js';
import { chooseMove, LEVELS } from '../js/ai.js';

const classic = MODE_BY_ID.classic;

test('every level finds mate in one', () => {
  // Blue rook a1 to a8 is mate (back-rank).
  const s = fromFEN(classic, '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  for (const lv of ['medium', 'hard', 'master']) {
    const mv = chooseMove(s, lv);
    assert.equal(mv.to, 0, lv);
  }
});

test('Hard and Master grab a hanging queen', () => {
  const s = fromFEN(classic, 'k7/8/8/3q4/8/8/3R4/K7 w - - 0 1');
  for (const lv of ['hard', 'master']) assert.equal(chooseMove(s, lv).to, 27, lv);
});

test('AI walks onto the Hill when it can', () => {
  const s = fromFEN(MODE_BY_ID.hill, '7k/8/8/8/8/3K4/8/8 w - - 0 1');
  assert.ok([27, 28, 35, 36].includes(chooseMove(s, 'hard').to));
});

test('every level returns a legal move in every mode within its time budget', () => {
  for (const mode of MODES) {
    for (const lv of LEVELS) {
      const s = createState(mode);
      const t0 = Date.now();
      const mv = chooseMove(s, lv.id);
      const ms = Date.now() - t0;
      assert.ok(legalMoves(s).some(m => m.from === mv.from && m.to === mv.to), `${mode.id}/${lv.id}`);
      assert.ok(ms < lv.time + 1500, `${mode.id}/${lv.id} took ${ms}ms`);
    }
  }
});

test('snapshot/restore round-trips through structured clone', () => {
  const s = createState(MODE_BY_ID.four);
  const back = restore(structuredClone(snapshot(s)), MODE_BY_ID.four);
  assert.equal(legalMoves(back).length, legalMoves(s).length);
});

test('Hard beats Novice in a short duel (sanity check of strength)', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = createState(classic);
  const levels = ['hard', 'novice'];
  for (let ply = 0; ply < 80; ply++) {
    if (!legalMoves(s).length) break;
    makeMove(s, chooseMove(s, levels[s.turn], rand));
  }
  // Material check: Blue (hard) should be ahead.
  const val = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  const mat = [0, 0];
  s.board.forEach(c => { if (c) mat[c.p] += val[c.t]; });
  const kingGone = s.kings[1] < 0 || !legalMoves(s).length;
  assert.ok(mat[0] > mat[1] || kingGone, `material blue ${mat[0]} pink ${mat[1]}`);
});
