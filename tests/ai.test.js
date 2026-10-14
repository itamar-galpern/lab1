import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPACE, sq } from '../js/space.js';
import { fromFEN, createState, legalMoves, makeMove, unmakeMove, inCheck, snapshot, restore } from '../js/engine.js';
import { chooseMove, LEVELS } from '../js/ai.js';

const space = fen => fromFEN(SPACE, fen);

test('Captain and up find mate in one', () => {
  // Back-rank mate; with orbit wrap the a-file squares next to h8 must be covered too.
  const s = space('n6k/p5pp/8/8/8/8/8/2K1R3 w - - 0 1');
  for (const lv of ['captain', 'admiral', 'overlord']) {
    const mv = chooseMove(s, lv);
    const u = makeMove(s, mv);
    assert.ok(inCheck(s, 1) && legalMoves(s).length === 0, `${lv} missed the mate`);
    unmakeMove(s, u);
  }
});

test('Admiral and Overlord grab a hanging Flagship', () => {
  const s = space('k7/8/8/3q4/8/8/3R4/K7 w - - 0 1');
  for (const lv of ['admiral', 'overlord']) assert.equal(chooseMove(s, lv).to, sq('d5'), lv);
});

test('the AI warps through a wormhole to capture', () => {
  const s = space('4k3/8/6q1/8/8/1R6/8/4K3 w - - 0 1');
  for (const lv of ['admiral', 'overlord']) {
    const mv = chooseMove(s, lv);
    assert.ok(mv.from === sq('b3') && mv.to === sq('g6') && mv.warp, lv);
  }
});

test('the AI finds a mate through a wormhole', () => {
  const s = space('6rk/6pn/8/8/8/1N6/8/4K3 w - - 0 1');
  for (const lv of ['captain', 'overlord']) {
    const mv = chooseMove(s, lv);
    assert.ok(mv.from === sq('b3') && mv.to === sq('g6') && mv.warp, lv);
  }
});

test('every level returns a legal move within its time budget', () => {
  for (const lv of LEVELS) {
    const s = createState(SPACE);
    const t0 = Date.now();
    const mv = chooseMove(s, lv.id);
    const ms = Date.now() - t0;
    assert.ok(legalMoves(s).some(m => m.from === mv.from && m.to === mv.to), lv.id);
    assert.ok(ms < lv.time + 1500, `${lv.id} took ${ms}ms`);
  }
});

test('snapshot/restore round-trips through structured clone', () => {
  const s = createState(SPACE);
  const back = restore(structuredClone(snapshot(s)), SPACE);
  assert.equal(legalMoves(back).length, legalMoves(s).length);
  assert.deepEqual([...back.warp], [...s.warp]);
});

test('Admiral beats Cadet in a short duel (sanity check of strength)', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const s = createState(SPACE);
  const levels = ['admiral', 'cadet'];
  for (let ply = 0; ply < 80; ply++) {
    if (!legalMoves(s).length) break;
    makeMove(s, chooseMove(s, levels[s.turn], rand));
  }
  const val = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  const mat = [0, 0];
  s.board.forEach(c => { if (c) mat[c.p] += val[c.t]; });
  const mated = !legalMoves(s).length;
  assert.ok(mat[0] > mat[1] || mated, `material solar ${mat[0]} nebula ${mat[1]}`);
});
