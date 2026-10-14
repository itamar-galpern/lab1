import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_BY_ID } from '../js/modes.js';
import { createState, fromFEN, perft, legalMoves, makeMove, unmakeMove, positionKey } from '../js/engine.js';
import { Game } from '../js/game.js';

// Standard chess = Classic with the knight extension switched off.
const STANDARD = { ...MODE_BY_ID.classic, knightPlus: false };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';

test('perft matches standard chess from the start position', () => {
  const s = fromFEN(STANDARD, START);
  assert.deepEqual([1, 2, 3, 4].map(d => perft(s, d)), [20, 400, 8902, 197281]);
});

test('perft matches standard chess on Kiwipete (castling, en passant, promotion)', () => {
  const s = fromFEN(STANDARD, KIWIPETE);
  assert.deepEqual([1, 2, 3].map(d => perft(s, d)), [48, 2039, 97862]);
});

test('perft matches standard chess on position 3 (en passant pins)', () => {
  const s = fromFEN(STANDARD, POS3);
  assert.deepEqual([1, 2, 3, 4].map(d => perft(s, d)), [14, 191, 2812, 43238]);
});

test('make/unmake restores the position exactly', () => {
  const s = fromFEN(STANDARD, KIWIPETE);
  const before = positionKey(s);
  for (const mv of legalMoves(s)) {
    const u = makeMove(s, mv);
    unmakeMove(s, u);
    assert.equal(positionKey(s), before);
  }
});

test('MindGame knight also jumps 2+2 (12 targets from the centre of an empty board)', () => {
  const s = fromFEN(MODE_BY_ID.classic, '7k/8/8/8/4N3/8/8/K7 w - - 0 1');
  const knightMoves = legalMoves(s).filter(m => s.board[m.from].t === 'N');
  assert.equal(knightMoves.length, 12);
  const s2 = fromFEN(STANDARD, '7k/8/8/8/4N3/8/8/K7 w - - 0 1');
  assert.equal(legalMoves(s2).filter(m => s2.board[m.from].t === 'N').length, 8);
});

test('2+2 knight jump leaps over pieces and gives check', () => {
  // Knight on c3 checks the king on e5 by jumping over d4.
  const s = fromFEN(MODE_BY_ID.classic, '8/8/8/4k3/3p4/2N5/8/K7 b - - 0 1');
  const kingMoves = legalMoves(s).filter(m => s.board[m.from].t === 'K');
  assert.ok(legalMoves(s).length > 0);
  // The king is in check, so the pawn may not make a non-blocking move like d4-d3.
  assert.ok(!legalMoves(s).some(m => s.board[m.from].t === 'P' && m.to === 43));
  assert.ok(kingMoves.length > 0);
});

test('every mode starts with a sane position and legal moves', () => {
  for (const mode of MODES) {
    const s = createState(mode);
    assert.equal(s.kings.filter(k => k >= 0).length, mode.players.length, mode.id);
    for (const c of mode.setup) assert.ok(s.valid[c.y * mode.w + c.x], `${mode.id} piece on hole`);
    const seen = new Set(mode.setup.map(c => c.y * mode.w + c.x));
    assert.equal(seen.size, mode.setup.length, `${mode.id} overlapping pieces`);
    assert.ok(legalMoves(s).length > 0, mode.id);
  }
});

test('King of the Hill: stepping onto the centre wins', () => {
  const g = new Game(MODE_BY_ID.hill);
  g.s = fromFEN(MODE_BY_ID.hill, '7k/8/8/8/8/3K4/8/8 w - - 0 1');
  const mv = g.legal().find(m => m.to === 35); // d4
  g.play(mv);
  assert.deepEqual(g.result, { winner: 0, reason: 'reached the Hill' });
});

test('Classic: fool\'s mate is checkmate', () => {
  const g = new Game(MODE_BY_ID.classic);
  const sq = n => (8 - +n[1]) * 8 + n.charCodeAt(0) - 97;
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    const mv = g.legal().find(m => m.from === sq(a) && m.to === sq(b));
    assert.ok(mv, `${a}-${b}`);
    g.play(mv);
  }
  assert.deepEqual(g.result, { winner: 1, reason: 'checkmate' });
  assert.match(g.log.at(-1).text, /#$/);
});

test('undo restores the previous position', () => {
  const g = new Game(MODE_BY_ID.classic);
  const key = positionKey(g.s);
  g.play(g.legal()[0]);
  assert.notEqual(positionKey(g.s), key);
  g.undo();
  assert.equal(positionKey(g.s), key);
});

test('random games run to completion in every mode without errors', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const mode of MODES) {
    for (let game = 0; game < 4; game++) {
      const g = new Game(mode);
      for (let ply = 0; ply < 400 && !g.result; ply++) {
        const moves = g.legal();
        assert.ok(moves.length > 0, `${mode.id}: no moves but no result`);
        g.play(moves[Math.floor(rand() * moves.length)]);
        // Kings of living players are where the engine thinks they are.
        g.s.kings.forEach((k, p) => {
          if (k >= 0) assert.equal(g.s.board[k]?.t, 'K', `${mode.id} king index`);
          else assert.ok(!g.s.alive[p] || g.s.n > 2, `${mode.id} lost king in duel`);
        });
      }
    }
  }
});
