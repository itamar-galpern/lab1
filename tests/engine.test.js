import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sq, sqName, isHole, warpTwin, START, BLACK_HOLES } from '../js/rules.js';
import {
  newState, fromFEN, toFEN, legalMoves, makeMove, unmakeMove, inCheck, pieceAt, kingSquare,
  serialize, deserialize, positionKey, perft,
  VOID, isVoid, twinOf, features, setVoid, linkWormhole, unlinkWormhole,
} from '../js/engine.js';
import { Game, EVENT_EVERY } from '../js/game.js';

const movesFrom = (s, a) => legalMoves(s).filter(m => m.from === sq(a));
const targets = (s, a) => movesFrom(s, a).map(m => sqName(m.to)).sort();
const find = (s, a, b) => legalMoves(s).filter(m => m.from === sq(a) && m.to === sq(b));
function one(s, a, b) {
  const ms = find(s, a, b);
  assert.equal(ms.length, 1, `expected exactly one ${a}-${b}, got ${ms.length}`);
  return ms[0];
}
const play = (g, a, b, promo) => g.play({ from: sq(a), to: sq(b), promo });

// Seeded PRNG so the random-game tests are reproducible.
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Turns a FEN 180 degrees and swaps the colours (and which fleet is to move).
function rotateFEN(fen) {
  const [place, turn, castle, ep, half, full] = fen.split(' ');
  const cells = [];
  for (const ch of place.replace(/\//g, '')) {
    if (ch >= '1' && ch <= '8') for (let k = 0; k < +ch; k++) cells.push('');
    else cells.push(ch);
  }
  const rot = cells.slice().reverse().map(c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let row = '', gap = 0;
    for (const c of rot.slice(y * 8, y * 8 + 8)) { if (!c) gap++; else { row += (gap || '') + c; gap = 0; } }
    rows.push(row + (gap || ''));
  }
  const map = { K: 'q', Q: 'k', k: 'Q', q: 'K' };
  const c2 = castle === '-' ? '-' : [...castle].map(c => map[c]).sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b)).join('');
  const ep2 = ep === '-' ? '-' : sqName(63 - sq(ep));
  return `${rows.join('/')} ${turn === 'w' ? 'b' : 'w'} ${c2} ${ep2} ${half} ${full}`;
}

// ---------- the board ----------

test('start position: 32 ships, Nebula is Solar turned 180 degrees, 23 legal moves', () => {
  const s = newState();
  assert.equal(START.length, 32);
  assert.deepEqual(pieceAt(s, sq('e1')), { type: 'K', side: 0 });
  assert.deepEqual(pieceAt(s, sq('d8')), { type: 'K', side: 1 });
  assert.deepEqual(pieceAt(s, sq('e8')), { type: 'Q', side: 1 });
  assert.equal(kingSquare(s, 1), sq('d8'));
  // 8 single pushes + 7 double pushes (f2-f4 runs into a black hole) + 4 moves per Rocket.
  assert.equal(toFEN(s), 'rnbkqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(legalMoves(s).length, 23);
  // 23 x 23 minus 4: after b2-b3 or b2-b4 the c1 Comet's diagonal wraps round the orbit
  // (c1-b2-a3-h4-g5-f6-e7-d8) and pins Nebula's e7 Astronaut, which loses e6 and e5.
  assert.equal(perft(s, 2), 23 * 23 - 4);
  makeMove(s, legalMoves(s).find(m => m.from === sq('b2') && m.to === sq('b3')));
  assert.equal(legalMoves(s).filter(m => m.from === sq('e7')).length, 0);
});

test('rules squares: c5 and f4 are black holes, b3 and g6 are the wormhole', () => {
  assert.deepEqual(BLACK_HOLES.map(sqName), ['c5', 'f4']);
  assert.ok(isHole(sq('c5')) && isHole(sq('f4')) && !isHole(sq('e4')));
  assert.equal(warpTwin(sq('b3')), sq('g6'));
  assert.equal(warpTwin(sq('g6')), sq('b3'));
  assert.equal(warpTwin(sq('e4')), -1);
  assert.throws(() => fromFEN('3k4/8/8/2N5/8/8/8/4K3 w - - 0 1'), /black hole/);
});

// ---------- black holes ----------

test('black holes stop a Station on its file', () => {
  const s = fromFEN('3k4/8/8/8/8/8/8/2R1K3 w - - 0 1');
  const t = targets(s, 'c1');
  for (const ok of ['c2', 'c3', 'c4', 'd1', 'b1', 'a1', 'h1', 'g1', 'f1']) assert.ok(t.includes(ok), ok);
  for (const no of ['c5', 'c6', 'c7', 'c8']) assert.ok(!t.includes(no), no);
  assert.equal(one(s, 'c1', 'h1').vx, -3);   // round the orbit to the left
});

test('black holes block both diagonals of a Comet', () => {
  const s = fromFEN('3k4/B7/8/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(targets(s, 'a7'), ['b6', 'b8', 'g5', 'h6', 'h8']);
});

test('an Astronaut cannot double-step into a black hole', () => {
  const s = newState();
  assert.equal(find(s, 'f2', 'f4').length, 0);
  assert.equal(find(s, 'f2', 'f3').length, 1);
  makeMove(s, one(s, 'e2', 'e4'));
  assert.equal(find(s, 'c7', 'c5').length, 0);
  assert.equal(find(s, 'c7', 'c6').length, 1);
});

test('the Rocket jumps in an L or 2+2, leaping over a black hole but never into one', () => {
  const s = fromFEN('7k/8/3N4/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(targets(s, 'd6'), ['b4', 'b5', 'b7', 'b8', 'c4', 'c8', 'e4', 'e8', 'f5', 'f7', 'f8']);
  const boost = one(s, 'd6', 'b4');
  assert.deepEqual([boost.vx, boost.vy], [-2, 2]);
});

// ---------- the wormhole ----------

test('a ship on a wormhole can warp to the other end, both ways', () => {
  let s = fromFEN('3k4/8/8/8/8/1R6/8/4K3 w - - 0 1');
  const w = one(s, 'b3', 'g6');
  assert.equal(w.kind, 'warp');
  assert.deepEqual([w.vx, w.vy], [0, 0]);
  s = fromFEN('3k4/8/6R1/8/8/8/8/4K3 w - - 0 1');
  assert.equal(one(s, 'g6', 'b3').kind, 'warp');
});

test('a warp can capture, and Game describes it with ~x', () => {
  const g = new Game('3k4/8/6n1/8/8/1R6/8/4K3 w - - 0 1');
  const m = one(g.state, 'b3', 'g6');
  assert.equal(m.kind, 'warp');
  assert.equal(m.cap, 'N');
  assert.equal(m.capSq, sq('g6'));
  assert.equal(play(g, 'b3', 'g6').text, 'Station b3~xg6');
  assert.deepEqual(g.captured[0], ['N']);
});

test('a ship on a wormhole gives check through it, and a Commander can warp to capture', () => {
  const g = new Game('8/8/6k1/8/8/8/8/1R2K3 w - - 0 1');
  assert.equal(play(g, 'b1', 'b3').text, 'Station b1-b3+');
  assert.ok(inCheck(g.state));
  const kx = one(g.state, 'g6', 'b3');
  assert.equal(kx.kind, 'warp');
  assert.equal(kx.cap, 'R');
});

test('Astronauts never warp', () => {
  const s = fromFEN('3k4/8/8/8/8/1P6/8/4K3 w - - 0 1');
  assert.deepEqual(targets(s, 'b3'), ['b4']);
});

test('a warp to a square the ship can already reach is listed once, as the normal move', () => {
  let s = fromFEN('3k4/8/8/8/8/1B6/8/4K3 w - - 0 1');
  const m = one(s, 'b3', 'g6');   // b3-a4-h5-g6 round the orbit
  assert.equal(m.kind, 'move');
  assert.deepEqual([m.vx, m.vy], [-3, -3]);
  s = fromFEN('3k4/8/8/8/P7/1B6/8/4K3 w - - 0 1');   // a4 blocked: now only the warp gets there
  assert.equal(one(s, 'b3', 'g6').kind, 'warp');
});

// ---------- the orbit wrap ----------

test('a Station slides round the orbit and stops at black holes on the way', () => {
  const s = fromFEN('3k4/8/8/8/R7/8/8/4K3 w - - 0 1');
  const rank = movesFrom(s, 'a4').filter(m => m.to >> 3 === 4);
  assert.deepEqual(rank.map(m => sqName(m.to)).sort(), ['b4', 'c4', 'd4', 'e4', 'g4', 'h4']);
  assert.deepEqual([one(s, 'a4', 'h4').vx, one(s, 'a4', 'h4').vy], [-1, 0]);
  assert.equal(one(s, 'a4', 'g4').vx, -2);
  assert.equal(one(s, 'a4', 'e4').vx, 4);
});

test('when both ways round the orbit work, each square is listed once by the shorter way', () => {
  const s = fromFEN('3k4/8/R7/8/8/8/8/4K3 w - - 0 1');
  const rank = movesFrom(s, 'a6').filter(m => m.to >> 3 === 2);
  assert.equal(rank.length, 7);
  const vx = Object.fromEntries(rank.map(m => [sqName(m.to), m.vx]));
  assert.deepEqual(vx, { b6: 1, c6: 2, d6: 3, e6: 4, f6: -3, g6: -2, h6: -1 });
});

test('Flagship, Commander and Rocket all wrap round the seam', () => {
  let s = fromFEN('3k4/8/8/8/8/8/8/Q3K3 w - - 0 1');
  assert.deepEqual([one(s, 'a1', 'h1').vx, one(s, 'a1', 'h1').vy], [-1, 0]);
  assert.deepEqual([one(s, 'a1', 'h2').vx, one(s, 'a1', 'h2').vy], [-1, -1]);
  s = fromFEN('3k4/8/8/8/8/8/8/K7 w - - 0 1');
  assert.deepEqual(targets(s, 'a1'), ['a2', 'b1', 'b2', 'h1', 'h2']);
  s = fromFEN('3k4/8/8/8/8/8/8/N3K3 w - - 0 1');
  assert.deepEqual(targets(s, 'a1'), ['b3', 'c2', 'c3', 'g2', 'g3', 'h3']);
  assert.deepEqual([one(s, 'a1', 'g2').vx, one(s, 'a1', 'g2').vy], [-2, -1]);
});

test('an Astronaut captures across the seam', () => {
  const s = fromFEN('3k4/8/8/7r/P7/8/8/4K3 w - - 0 1');
  const m = one(s, 'a4', 'h5');
  assert.equal(m.cap, 'R');
  assert.deepEqual([m.vx, m.vy], [-1, -1]);
});

test('en passant works across the seam', () => {
  const g = new Game('3k4/p7/8/7P/8/8/8/4K3 b - - 0 1');
  play(g, 'a7', 'a5');
  const m = one(g.state, 'h5', 'a6');
  assert.equal(m.kind, 'ep');
  assert.equal(m.capSq, sq('a5'));
  assert.deepEqual([m.vx, m.vy], [1, -1]);
  play(g, 'h5', 'a6');
  assert.equal(g.pieceAt(sq('a5')), null);
  assert.deepEqual(g.pieceAt(sq('a6')), { type: 'P', side: 0 });
});

test('ordinary en passant, only right after the double step', () => {
  const g = new Game('3k4/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  play(g, 'd7', 'd5');
  assert.equal(one(g.state, 'e5', 'd6').kind, 'ep');
  play(g, 'e1', 'e2');
  play(g, 'd8', 'c8');
  assert.equal(find(g.state, 'e5', 'd6').length, 0);
});

// ---------- castling ----------

test('both fleets dock (castle) on both sides', () => {
  const fen = 'r2k3r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const s = fromFEN(fen);
  const short = one(s, 'e1', 'g1'), long = one(s, 'e1', 'c1');
  assert.deepEqual([short.kind, sqName(short.rookFrom), sqName(short.rookTo)], ['castle', 'h1', 'f1']);
  assert.deepEqual([long.kind, sqName(long.rookFrom), sqName(long.rookTo)], ['castle', 'a1', 'd1']);
  const g = new Game(fen);
  assert.equal(play(g, 'e1', 'g1').text, 'Commander O-O');
  assert.deepEqual(g.pieceAt(sq('f1')), { type: 'R', side: 0 });
  assert.equal(g.pieceAt(sq('h1')), null);
  // Nebula is rotated: its short side is the a8 Station.
  const nShort = one(g.state, 'd8', 'b8'), nLong = one(g.state, 'd8', 'f8');
  assert.deepEqual([sqName(nShort.rookFrom), sqName(nShort.rookTo)], ['a8', 'c8']);
  assert.deepEqual([sqName(nLong.rookFrom), sqName(nLong.rookTo)], ['h8', 'e8']);
  assert.equal(play(g, 'd8', 'b8').text, 'Commander O-O');
  g.undo();
  assert.equal(play(g, 'd8', 'f8').text, 'Commander O-O-O');
});

test('no docking through check, out of check, or with ships in between', () => {
  let s = fromFEN('3k4/8/8/1b6/8/8/8/R3K2R w KQ - 0 1');   // the Comet on b5 covers f1
  assert.equal(find(s, 'e1', 'g1').length, 0);
  assert.equal(find(s, 'e1', 'c1').length, 1);
  s = fromFEN('3k4/8/8/8/4r3/8/8/R3K2R w KQ - 0 1');      // in check
  assert.equal(movesFrom(s, 'e1').filter(m => m.kind === 'castle').length, 0);
  s = fromFEN('3k4/8/8/8/8/8/8/RN2K2R w KQ - 0 1');       // a Rocket on b1
  assert.equal(find(s, 'e1', 'c1').length, 0);
  assert.equal(find(s, 'e1', 'g1').length, 1);
});

test('moving the Commander or a Station gives up docking rights', () => {
  const fen = 'r2k3r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  let g = new Game(fen);
  play(g, 'e1', 'e2'); play(g, 'd8', 'd7'); play(g, 'e2', 'e1'); play(g, 'd7', 'd8');
  assert.equal(movesFrom(g.state, 'e1').filter(m => m.kind === 'castle').length, 0);
  g = new Game(fen);
  play(g, 'h1', 'h2'); play(g, 'a8', 'a7'); play(g, 'h2', 'h1'); play(g, 'a7', 'a8');
  assert.deepEqual(movesFrom(g.state, 'e1').filter(m => m.kind === 'castle').map(m => sqName(m.to)), ['c1']);
});

// ---------- promotion and check ----------

test('promotion offers all four ships', () => {
  const g = new Game('3k4/P7/8/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(find(g.state, 'a7', 'a8').map(m => m.promo).sort(), ['B', 'N', 'Q', 'R']);
  assert.equal(play(g, 'a7', 'a8', 'Q').text, 'Astronaut a7-a8=Flagship+');
});

test('a pinned ship may not leave its Commander in check', () => {
  const s = fromFEN('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
  const t = movesFrom(s, 'e2');
  assert.equal(t.length, 6);
  assert.ok(t.every(m => (m.to & 7) === 4));
});

// ---------- results ----------

test('checkmate delivered round the orbit', () => {
  const g = new Game('4k3/3ppp2/1Q6/8/8/8/8/4K3 w - - 0 1');
  const r = play(g, 'b6', 'h8');
  assert.deepEqual([r.move.vx, r.move.vy], [-2, -2]);
  assert.equal(r.text, 'Flagship b6-h8#');
  assert.ok(r.mate);
  assert.deepEqual(g.result, { winner: 0, reason: 'checkmate' });
  assert.deepEqual(g.moves(), []);
});

test('checkmate delivered through the wormhole', () => {
  const g = new Game('8/5ppp/5pkp/5ppp/8/8/P7/1R2K3 w - - 0 1');
  const r = play(g, 'b1', 'b3');
  assert.equal(r.text, 'Station b1-b3#');
  assert.deepEqual(g.result, { winner: 0, reason: 'checkmate' });
});

test('stalemate', () => {
  const g = new Game('7k/8/7N/8/8/8/3R4/4K3 w - - 0 1');
  play(g, 'd2', 'd7');
  assert.deepEqual(g.result, { winner: null, reason: 'stalemate' });
});

test('threefold repetition', () => {
  const g = new Game();
  const dance = [['g1', 'f3'], ['b8', 'c6'], ['f3', 'g1'], ['c6', 'b8']];
  for (const [a, b] of dance) play(g, a, b);
  assert.equal(g.result, null);
  for (const [a, b] of dance) play(g, a, b);
  assert.deepEqual(g.result, { winner: null, reason: 'threefold repetition' });
  g.undo();
  assert.equal(g.result, null);
});

test('fifty-move rule', () => {
  const g = new Game('3k4/8/8/8/8/8/8/R3K3 w - - 99 80');
  play(g, 'a1', 'a2');
  assert.deepEqual(g.result, { winner: null, reason: 'fifty-move rule' });
});

test('insufficient material', () => {
  const g = new Game('3k4/8/8/8/8/5p2/8/4K1N1 w - - 0 1');
  play(g, 'g1', 'f3');
  assert.deepEqual(g.result, { winner: null, reason: 'insufficient material' });
});

// ---------- state ----------

test('undo restores every position exactly', () => {
  const rand = mulberry(7), s = newState(), seen = [];
  for (let k = 0; k < 80; k++) {
    const ms = legalMoves(s);
    if (!ms.length) break;
    seen.push([JSON.stringify(serialize(s)), positionKey(s), toFEN(s)]);
    makeMove(s, ms[Math.floor(rand() * ms.length)]);
  }
  while (seen.length) {
    unmakeMove(s);
    const [json, key, fen] = seen.pop();
    assert.equal(toFEN(s), fen);
    assert.equal(positionKey(s), key);
    assert.equal(JSON.stringify(serialize(s)), json);
  }
});

test('serialize / deserialize round trip', () => {
  const rand = mulberry(11), s = newState();
  for (let k = 0; k < 30; k++) { const ms = legalMoves(s); makeMove(s, ms[Math.floor(rand() * ms.length)]); }
  const copy = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  assert.equal(toFEN(copy), toFEN(s));
  assert.equal(positionKey(copy), positionKey(s));
  const names = st => legalMoves(st).map(m => `${m.from}-${m.to}${m.promo || ''}`).sort();
  assert.deepEqual(names(copy), names(s));
});

test('the board is fair: turning any position 180 degrees and swapping fleets changes nothing', () => {
  const rand = mulberry(3);
  for (let game = 0; game < 8; game++) {
    const s = newState();
    for (let k = 0; k < 60; k++) {
      const ms = legalMoves(s);
      if (!ms.length) break;
      if (k % 6 === 0) {
        const r = fromFEN(rotateFEN(toFEN(s)));
        assert.equal(legalMoves(r).length, ms.length, toFEN(s));
        assert.equal(inCheck(r), inCheck(s));
      }
      makeMove(s, ms[Math.floor(rand() * ms.length)]);
    }
  }
});

test('random games: no duplicate moves, nothing enters a black hole, vx/vy match, undo all the way back', () => {
  const rand = mulberry(2024);
  for (let game = 0; game < 30; game++) {
    const s = newState(), startKey = positionKey(s);
    let plies = 0;
    for (; plies < 200; plies++) {
      const ms = legalMoves(s);
      if (!ms.length) break;
      const keys = new Set(ms.map(m => `${m.from}-${m.to}-${m.promo}`));
      assert.equal(keys.size, ms.length, 'duplicate move in ' + toFEN(s));
      for (const m of ms) {
        assert.ok(!isHole(m.to), 'move into a black hole');
        if (m.kind === 'warp') assert.equal(m.to, warpTwin(m.from));
        else {
          assert.equal(((m.from & 7) + m.vx + 64) & 7, m.to & 7, 'vx');
          assert.equal((m.from >> 3) + m.vy, m.to >> 3, 'vy');
        }
      }
      const side = s.turn;
      makeMove(s, ms[Math.floor(rand() * ms.length)]);
      assert.ok(!inCheck(s, side), 'left own Commander in check');
    }
    for (let k = 0; k < plies; k++) unmakeMove(s);
    assert.equal(positionKey(s), startKey);
    assert.equal(toFEN(s), toFEN(newState()));
  }
});

// ---------- instant wormhole transit ----------

// Everything about a position that must come back exactly after an undo.
const snapshot = s => JSON.stringify([serialize(s), positionKey(s), s.kings, toFEN(s)]);

test('a ship landing on a wormhole is flung out of the other end', () => {
  const s = fromFEN('3k4/8/8/8/3N4/8/8/4K3 w - - 0 1');
  const before = snapshot(s);
  const m = one(s, 'd4', 'b3');
  assert.deepEqual([m.kind, m.transit, m.vx, m.vy], ['move', sq('g6'), -2, 1]);
  makeMove(s, m);
  assert.deepEqual(pieceAt(s, sq('g6')), { type: 'N', side: 0 });
  assert.equal(pieceAt(s, sq('b3')), null);
  assert.equal(positionKey(s), positionKey(deserialize(serialize(s))));
  unmakeMove(s);
  assert.equal(snapshot(s), before);
});

test('a transit can capture on the way in, give check, and is written with ~', () => {
  let g = new Game('6k1/8/8/8/8/8/8/1R2K3 w - - 0 1');
  const r = play(g, 'b1', 'b3');
  assert.equal(r.text, 'Station b1-b3~g6+');
  assert.ok(r.check);
  g = new Game('3k4/8/8/8/8/1n6/8/1R2K3 w - - 0 1');
  assert.equal(play(g, 'b1', 'b3').text, 'Station b1xb3~g6');
  assert.deepEqual(g.pieceAt(sq('g6')), { type: 'R', side: 0 });
  assert.deepEqual(g.captured[0], ['N']);
  g.undo();
  assert.deepEqual(g.pieceAt(sq('b3')), { type: 'N', side: 1 });
  assert.deepEqual(g.pieceAt(sq('b1')), { type: 'R', side: 0 });
});

test('a Commander transits too, and its square is tracked', () => {
  const s = fromFEN('3k4/8/8/8/K7/8/8/8 w - - 0 1');
  const m = one(s, 'a4', 'b3');
  assert.equal(m.transit, sq('g6'));
  makeMove(s, m);
  assert.equal(kingSquare(s, 0), sq('g6'));
  unmakeMove(s);
  assert.equal(kingSquare(s, 0), sq('a4'));
});

test('no transit when the exit is occupied: the ship parks, and can warp later', () => {
  const g = new Game('3k4/8/6p1/8/3N4/8/8/4K3 w - - 0 1');
  assert.equal(one(g.state, 'd4', 'b3').transit, -1);
  assert.equal(play(g, 'd4', 'b3').text, 'Rocket d4-b3');
  assert.deepEqual(g.pieceAt(sq('b3')), { type: 'N', side: 0 });
  play(g, 'd8', 'c8');
  const w = one(g.state, 'b3', 'g6');
  assert.deepEqual([w.kind, w.cap, w.transit], ['warp', 'P', -1]);
});

test('no transit back to the square the ship just left', () => {
  const s = fromFEN('3k4/8/6B1/8/8/8/8/4K3 w - - 0 1');
  const m = one(s, 'g6', 'b3');   // g6-h5-a4-b3 round the orbit
  assert.deepEqual([m.kind, m.transit], ['move', -1]);
  makeMove(s, m);
  assert.deepEqual(pieceAt(s, sq('b3')), { type: 'B', side: 0 });
});

test('Astronauts never transit', () => {
  const s = newState();
  const m = one(s, 'b2', 'b3');
  assert.equal(m.transit, -1);
  makeMove(s, m);
  assert.deepEqual(pieceAt(s, sq('b3')), { type: 'P', side: 0 });
  assert.equal(pieceAt(s, sq('g6')), null);
});

test('checkmate by transit', () => {
  const g = new Game('6rk/6nr/8/8/3N4/8/8/4K3 w - - 0 1');
  const r = play(g, 'd4', 'b3');
  assert.equal(r.text, 'Rocket d4-b3~g6#');
  assert.deepEqual(g.result, { winner: 0, reason: 'checkmate' });
});

// ---------- the layout API ----------

test('voids and wormholes can change between moves, and the hash follows', () => {
  const s = newState(), start = positionKey(s);
  assert.deepEqual(features(s), { voids: [sq('c5'), sq('f4')], wormholes: [[sq('g6'), sq('b3')]] });
  assert.ok(isVoid(s, sq('c5')) && !isVoid(s, sq('d4')));
  assert.equal(twinOf(s, sq('b3')), sq('g6'));
  assert.equal(s.board[sq('c5')], VOID);
  assert.equal(pieceAt(s, sq('c5')), null);

  setVoid(s, sq('d4'), true);
  assert.notEqual(positionKey(s), start);
  assert.equal(positionKey(s), positionKey(deserialize(serialize(s))));
  linkWormhole(s, sq('e3'), sq('d6'));
  assert.equal(twinOf(s, sq('d6')), sq('e3'));
  assert.equal(positionKey(s), positionKey(deserialize(serialize(s))));
  assert.equal(s.keys[s.keys.length - 1], positionKey(s));
  unlinkWormhole(s, sq('d6'));
  setVoid(s, sq('d4'), false);
  assert.equal(positionKey(s), start);
  assert.throws(() => setVoid(s, sq('e2'), true), /not empty/);
  assert.throws(() => linkWormhole(s, sq('b3'), sq('e5')), /cannot link/);
});

test('a new void stops sliders and pawns, but Rockets leap over it', () => {
  const s = fromFEN('3k4/8/8/8/8/8/3P4/3RK1N1 w - - 0 1');
  setVoid(s, sq('d3'), true);
  assert.equal(find(s, 'd2', 'd3').length, 0);
  assert.equal(find(s, 'd2', 'd4').length, 0);
  setVoid(s, sq('f3'), true);
  assert.ok(targets(s, 'g1').includes('e2') && targets(s, 'g1').includes('h3') && !targets(s, 'g1').includes('f3'));
  const t = fromFEN('3k4/8/8/8/8/8/8/3RK3 w - - 0 1');
  setVoid(t, sq('d4'), true);
  assert.deepEqual(targets(t, 'd1').filter(x => x[0] === 'd'), ['d2', 'd3']);
});

test('serialize / deserialize keeps a changed layout', () => {
  const s = newState();
  setVoid(s, sq('e4'), true);
  linkWormhole(s, sq('a5'), sq('h4'));
  unlinkWormhole(s, sq('b3'));
  const copy = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  assert.deepEqual(features(copy), features(s));
  assert.equal(positionKey(copy), positionKey(s));
  const names = st => legalMoves(st).map(m => `${m.from}-${m.to}-${m.transit}`).sort();
  assert.deepEqual(names(copy), names(s));
});

// ---------- cosmic events ----------

// Plays deterministic pseudo-random moves; returns the play() results.
function playRandom(g, plies, rand) {
  const out = [];
  for (let k = 0; k < plies && !g.result; k++) {
    const ms = g.moves();
    out.push(g.play(ms[Math.floor(rand() * ms.length)]));
  }
  return out;
}

const NEW_EVENTS = ['drift', 'wormhole-open', 'meteor'];

test('cosmic events fire after every 10th ply, on empty middle squares', () => {
  let checked = 0;
  for (let seed = 1; checked < 5 && seed < 60; seed++) {
    const g = new Game(null, { cosmic: true, seed });
    assert.equal(g.nextEvent, EVENT_EVERY);
    const rand = mulberry(seed);
    const before = [];
    const results = [];
    for (let k = 0; k < 20 && !g.result; k++) {
      before.push(g.board().map(p => !!p));
      const ms = g.moves();
      results.push(g.play(ms[Math.floor(rand() * ms.length)]));
    }
    if (results.length < 20) continue;
    checked++;
    results.forEach((r, k) => {
      const fresh = r.events.filter(e => NEW_EVENTS.includes(e.type));
      assert.equal(fresh.length, (k + 1) % EVENT_EVERY === 0 ? 1 : 0, `ply ${k + 1}`);
      for (const e of fresh) {
        const squares = e.type === 'drift' ? [e.to] : e.type === 'meteor' ? e.squares : [e.a, e.b];
        for (const i of squares) {
          assert.ok((i >> 3) >= 2 && (i >> 3) <= 5, `${e.type} outside ranks 3-6`);
          assert.equal(g.log[k].events.includes(e), true);
        }
        assert.ok(typeof e.text === 'string' && e.text.length > 10);
      }
    });
    assert.equal(g.nextEvent, EVENT_EVERY);
  }
  assert.equal(checked, 5);
});

// Finds a seeded cosmic game whose first event (ply 10) has the given type.
function gameWithFirstEvent(type) {
  for (let seed = 1; seed < 400; seed++) {
    const g = new Game(null, { cosmic: true, seed }), rand = mulberry(seed * 7 + 1);
    const rs = playRandom(g, 10, rand);
    if (rs.length === 10 && rs[9].events.some(e => e.type === type)) return { g, rand };
  }
  throw new Error('no game with a ' + type);
}

test('meteor debris clears after 6 plies, temporary wormholes close after 12', () => {
  let { g, rand } = gameWithFirstEvent('meteor');
  const met = g.features.meteors.map(m => m.sq);
  assert.equal(met.length, 2);
  assert.ok(met.every(i => isVoid(g.state, i)));
  assert.ok(g.features.meteors.every(m => m.ttl === 6));
  const rs = playRandom(g, 6, rand);
  assert.equal(rs.length, 6);
  const clear = rs.flatMap(r => r.events).filter(e => e.type === 'meteor-clear');
  assert.equal(clear.length, 1);
  assert.equal(rs.findIndex(r => r.events.includes(clear[0])), 5);   // ply 16
  assert.deepEqual(clear[0].squares.slice().sort(), met.slice().sort());
  for (const i of met) assert.ok(!isVoid(g.state, i));
  assert.deepEqual(g.features.meteors, []);

  ({ g, rand } = gameWithFirstEvent('wormhole-open'));
  const w = g.features.wormholes.find(x => x.ttl !== null);
  assert.equal(w.ttl, 12);
  assert.equal(twinOf(g.state, w.a), w.b);
  const more = playRandom(g, 12, rand);
  assert.equal(more.length, 12);
  const close = more.flatMap(r => r.events).find(e => e.type === 'wormhole-close');
  assert.deepEqual([close.a, close.b], [w.a, w.b]);
  assert.equal(more.findIndex(r => r.events.includes(close)), 11);   // ply 22
  assert.equal(twinOf(g.state, w.a), -1);
  assert.equal(g.features.wormholes.length, 1);
});

test('undo across cosmic events restores everything, and replaying gives the same events', () => {
  for (const seed of [3, 8, 21]) {
    const g = new Game(null, { cosmic: true, seed }), rand = mulberry(seed);
    const snaps = [], moves = [];
    for (let k = 0; k < 34 && !g.result; k++) {
      snaps.push([snapshot(g.state), JSON.stringify(g.features), g.rng, g.nextEvent]);
      const ms = g.moves();
      const m = ms[Math.floor(rand() * ms.length)];
      moves.push({ from: m.from, to: m.to, promo: m.promo });
      g.play(m);
    }
    const events = g.log.map(e => JSON.stringify(e.events));
    assert.ok(events.filter(e => e !== '[]').length >= 3, 'expected cosmic events to undo');
    while (snaps.length) {
      g.undo();
      assert.deepEqual([snapshot(g.state), JSON.stringify(g.features), g.rng, g.nextEvent], snaps.pop());
    }
    for (const m of moves) g.play(m);
    assert.deepEqual(g.log.map(e => JSON.stringify(e.events)), events);
  }
});

test('random cosmic games: no crashes, nothing lands in a void, no Commander left en prise', () => {
  const rand = mulberry(777);
  let events = 0;
  for (let game = 0; game < 20; game++) {
    const g = new Game(null, { cosmic: true, seed: game + 1 });
    for (let k = 0; k < 150 && !g.result; k++) {
      const ms = g.moves();
      for (const m of ms) {
        assert.ok(!isVoid(g.state, m.to), 'move into a void');
        if (m.transit >= 0) assert.equal(g.pieceAt(m.transit), null);
      }
      const r = g.play(ms[Math.floor(rand() * ms.length)]);
      events += r.events.length;
      assert.ok(!inCheck(g.state, g.state.turn ^ 1), 'the fleet that just moved is in check');
      const f = g.features;
      for (const i of [...f.holes, ...f.meteors.map(x => x.sq)]) assert.ok(isVoid(g.state, i));
      for (const { a, b } of f.wormholes) assert.ok(!isVoid(g.state, a) && !isVoid(g.state, b));
      assert.equal(positionKey(g.state), positionKey(deserialize(serialize(g.state))));
    }
  }
  assert.ok(events > 40, `only ${events} events`);
});
