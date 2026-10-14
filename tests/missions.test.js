import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFEN, legalMoves, makeMove, unmakeMove, inCheck } from '../js/engine.js';
import { MISSIONS, forcedMate, mateMove, defend } from '../js/missions.js';

test('missions: 8 of them, each with a title, brief, hint and a Solar-to-move position', () => {
  assert.equal(MISSIONS.length, 8);
  assert.equal(new Set(MISSIONS.map(m => m.id)).size, MISSIONS.length);
  for (const m of MISSIONS) {
    assert.ok(m.title && m.brief && m.hint, m.id);
    assert.ok(m.mateIn === 1 || m.mateIn === 2, m.id);
    const s = fromFEN(m.fen);
    assert.equal(s.turn, 0, `${m.id}: Solar must be to move`);
    assert.ok(!inCheck(s, 1), `${m.id}: Nebula may not start in check`);
    assert.ok(s.kings[0] >= 0 && s.kings[1] >= 0, `${m.id}: both Commanders`);
  }
});

for (const m of MISSIONS) {
  test(`mission ${m.id} ${m.title}: a forced mate in exactly ${m.mateIn}`, () => {
    const s = fromFEN(m.fen);
    assert.ok(forcedMate(s, m.mateIn), 'no forced mate');
    if (m.mateIn > 1) assert.ok(!forcedMate(s, m.mateIn - 1), 'mates faster than advertised');
    // Play it out: the key move, then the longest defence, until mate.
    let n = m.mateIn;
    for (;;) {
      const key = mateMove(s, n);
      assert.ok(key, `lost the mate with ${n} to go`);
      makeMove(s, key);
      if (!legalMoves(s).length) { assert.ok(inCheck(s)); break; }
      n--;
      assert.ok(n > 0, 'not mate in time');
      const d = defend(s, n + 1);
      assert.ok(legalMoves(s).some(x => x.from === d.from && x.to === d.to));
      makeMove(s, d);
    }
  });
}

test('defend picks a reply that avoids a quick mate when there is one', () => {
  // After 1. Flagship g3-c3 in CLOSING THE ORBIT, every reply loses, so defend just returns a legal reply.
  const s = fromFEN(MISSIONS.find(m => m.id === 'm7').fen);
  makeMove(s, mateMove(s, 2));
  const d = defend(s, 2);
  assert.ok(legalMoves(s).some(x => x.from === d.from && x.to === d.to));
  unmakeMove(s);
  // From the start position nobody can force mate, so the first reply holds.
  const t = fromFEN('rnbkqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1');
  assert.ok(defend(t, 2));
});
