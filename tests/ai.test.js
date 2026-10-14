import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sq } from '../js/rules.js';
import { newState, fromFEN, toFEN, legalMoves, makeMove, inCheck, serialize, deserialize } from '../js/engine.js';
import { LEVELS, chooseMove } from '../js/ai.js';

const seeded = (a => () => ((a = (a * 16807) % 2147483647) / 2147483647))(42);
const isLegal = (s, m) => legalMoves(s).some(x => x.from === m.from && x.to === m.to && x.promo === m.promo);

function isMate(s, m) {
  makeMove(s, m);
  return inCheck(s) && legalMoves(s).length === 0;
}

test('every level returns a legal move from the start position', () => {
  assert.deepEqual(LEVELS.map(l => l.id), ['cadet', 'pilot', 'captain', 'admiral', 'overlord']);
  for (const lv of LEVELS) {
    assert.ok(lv.name && lv.blurb);
    const s = newState();
    const m = chooseMove(s, lv.id, { rand: seeded, timeScale: 0.05 });
    assert.ok(isLegal(s, m), lv.id);
  }
});

test('finds a mate in one through the wormhole', () => {
  const s = fromFEN('8/5ppp/5pkp/5ppp/8/8/P7/1R2K3 w - - 0 1');
  const m = chooseMove(s, 'captain', { rand: seeded, timeScale: 0.5 });
  assert.ok(isMate(s, m), `played ${m.from}-${m.to}`);
});

test('finds a mate in one round the orbit', () => {
  const s = fromFEN('4k3/3ppp2/1Q6/8/8/8/8/4K3 w - - 0 1');
  const m = chooseMove(s, 'admiral', { rand: seeded, timeScale: 0.5 });
  assert.ok(isMate(s, m), `played ${m.from}-${m.to}`);
});

test('captures a hanging Flagship', () => {
  const s = fromFEN('3k4/8/8/q7/8/8/8/R5K1 w - - 0 1');
  for (const level of ['pilot', 'captain', 'admiral']) {
    const m = chooseMove(s, level, { rand: seeded, timeScale: 0.3 });
    assert.equal(m.to, sq('a5'), level);
  }
});

test('Nebula plays too, and the search works on a deserialized state', () => {
  const s = newState();
  makeMove(s, legalMoves(s).find(m => m.from === sq('e2') && m.to === sq('e4')));
  const copy = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  const m = chooseMove(copy, 'captain', { rand: seeded, timeScale: 0.2 });
  assert.equal(m.side, 1);
  assert.ok(isLegal(s, m));
});

test('never changes the state it is given', () => {
  const s = newState();
  for (let k = 0; k < 6; k++) makeMove(s, legalMoves(s)[k * 3 % legalMoves(s).length]);
  const before = [toFEN(s), JSON.stringify(serialize(s)), s.stack.length, s.keys.length];
  chooseMove(s, 'admiral', { rand: seeded, timeScale: 0.1 });
  assert.deepEqual([toFEN(s), JSON.stringify(serialize(s)), s.stack.length, s.keys.length], before);
});

test('returns null when there is no legal move', () => {
  const stalemate = fromFEN('7k/3R4/7N/8/8/8/8/4K3 b - - 0 1');
  assert.equal(legalMoves(stalemate).length, 0);
  assert.equal(chooseMove(stalemate, 'captain'), null);
});
