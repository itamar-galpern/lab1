import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPACE, sq } from '../js/space.js';
import {
  createState, fromFEN, perft, legalMoves, pseudoMoves, makeMove, unmakeMove, positionKey, inCheck, attackedBy, travel,
} from '../js/engine.js';
import { Game } from '../js/game.js';

// Plain chess, used to check the move generator against known perft counts.
const STANDARD = {
  id: 'standard', w: 8, h: 8,
  players: [{ name: 'White', dir: [0, -1] }, { name: 'Black', dir: [0, 1] }],
  knightPlus: false, castling: true, enPassant: true, doubleStep: true, promoteRank: 7, setup: [],
};
const ROCKETS = { ...STANDARD, knightPlus: true };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POS3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';

const space = fen => fromFEN(SPACE, fen);
const movesFrom = (s, name) => legalMoves(s).filter(m => m.from === sq(name));
const targets = (s, name) => movesFrom(s, name).map(m => m.to).sort((a, b) => a - b);
const moveKey = m => `${m.from}-${m.to}-${m.promo || ''}`;

// ---------- the move generator still plays real chess ----------

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
  for (const s of [fromFEN(STANDARD, KIWIPETE), createState(SPACE)]) {
    const before = positionKey(s);
    for (const mv of legalMoves(s)) {
      const u = makeMove(s, mv);
      unmakeMove(s, u);
      assert.equal(positionKey(s), before);
    }
  }
});

// ---------- rocket (knight) ----------

test('the Rocket also boosts 2+2 (12 targets from the centre of an empty board)', () => {
  const s = fromFEN(ROCKETS, '7k/8/8/8/4N3/8/8/K7 w - - 0 1');
  assert.equal(legalMoves(s).filter(m => s.board[m.from].t === 'N').length, 12);
  const s2 = fromFEN(STANDARD, '7k/8/8/8/4N3/8/8/K7 w - - 0 1');
  assert.equal(legalMoves(s2).filter(m => s2.board[m.from].t === 'N').length, 8);
});

test('a 2+2 boost leaps over pieces and gives check', () => {
  // Rocket on c3 checks the Commander on e5 by jumping over d4.
  const s = fromFEN(ROCKETS, '8/8/8/4k3/3p4/2N5/8/K7 b - - 0 1');
  assert.ok(inCheck(s, 1));
  assert.ok(!legalMoves(s).some(m => s.board[m.from].t === 'P' && m.to === 43));
});

// ---------- the Space Chess board ----------

test('Space Chess starts with a sane position', () => {
  const s = createState(SPACE);
  assert.equal(s.kings.filter(k => k >= 0).length, 2);
  for (const c of SPACE.setup) assert.ok(s.valid[c.y * 8 + c.x], 'piece on a black hole');
  assert.equal(new Set(SPACE.setup.map(c => c.y * 8 + c.x)).size, SPACE.setup.length);
  assert.equal(s.valid.filter(v => !v).length, 2, 'two black holes');
  assert.ok(legalMoves(s).length > 20);
});

test('orbit wrap: a Station slides off the a-file onto the h-file, stopped by a black hole', () => {
  const s = space('4k3/8/8/8/R7/8/8/4K3 w - - 0 1');
  const rank = targets(s, 'a4').filter(i => i >= 32 && i < 40);
  // b4..e4 to the right, h4 and g4 around the seam; f4 is a black hole.
  assert.deepEqual(rank, ['b4', 'c4', 'd4', 'e4', 'g4', 'h4'].map(sq).sort((a, b) => a - b));
  assert.equal(targets(s, 'a4').length, 13);
});

test('orbit wrap: attacks cross the seam', () => {
  assert.ok(inCheck(space('8/8/8/R6k/8/8/8/K7 b - - 0 1'), 1));
});

test('orbit wrap: an Astronaut on the a-file captures onto the h-file', () => {
  const s = space('4k3/8/8/7n/P7/8/8/4K3 w - - 0 1');
  assert.ok(movesFrom(s, 'a4').some(m => m.to === sq('h5') && m.cap));
});

test('orbit wrap: docking (castling) never wraps around the seam', () => {
  const s = space('r3k3/8/8/8/8/8/8/R3K3 w Qq - 0 1');
  const castles = legalMoves(s).filter(m => m.castle);
  assert.equal(castles.length, 1);
  assert.equal(castles[0].to, sq('c1'));
  assert.equal(castles[0].castle.to, sq('d1'));
});

test('black holes block sliders and Astronauts, but Rockets jump over them', () => {
  const rook = space('2r1k3/8/8/8/8/8/8/4K3 b - - 0 1');
  assert.deepEqual(targets(rook, 'c8').filter(i => i % 8 === 2), [sq('c7'), sq('c6')]);
  assert.equal(movesFrom(space('4k3/8/8/8/2P5/8/8/4K3 w - - 0 1'), 'c4').length, 0);
  assert.ok(targets(space('4k3/8/1n6/8/8/8/8/4K3 b - - 0 1'), 'b6').includes(sq('d4')));
});

test('wormholes: a piece on one end warps to the other', () => {
  const s = space('4k3/8/8/8/8/1N6/8/4K3 w - - 0 1');
  assert.ok(movesFrom(s, 'b3').some(m => m.to === sq('g6') && m.warp && !m.cap));
});

test('wormholes: warping onto an enemy captures it', () => {
  const s = space('4k3/8/6n1/8/8/1R6/8/4K3 w - - 0 1');
  assert.ok(movesFrom(s, 'b3').some(m => m.to === sq('g6') && m.warp && m.cap));
});

test('wormholes: Astronauts cannot warp', () => {
  const s = space('4k3/8/8/8/8/1P6/8/4K3 w - - 0 1');
  assert.ok(!movesFrom(s, 'b3').some(m => m.to === sq('g6')));
});

test('wormholes: a piece on one end attacks the other (check through a wormhole)', () => {
  assert.ok(inCheck(space('8/8/6k1/8/8/1N6/8/4K3 b - - 0 1'), 1));
  const s = space('8/8/7k/8/8/1R6/8/4K3 b - - 0 1');
  assert.ok(legalMoves(s).length > 0);
  assert.ok(!movesFrom(s, 'h6').some(m => m.to === sq('g6')), 'Commander may not step into a guarded wormhole');
});

test('wormholes: a warp that matches an ordinary move is listed once', () => {
  // A Comet on b3 can also reach g6 along the wrapped diagonal b3-a4-h5-g6.
  const s = space('4k3/8/8/8/8/1B6/8/4K3 w - - 0 1');
  assert.equal(movesFrom(s, 'b3').filter(m => m.to === sq('g6')).length, 1);
});

// ---------- game flow ----------

test('the board is fair: turning it 180 degrees swaps the fleets and changes nothing else', () => {
  const s = createState(SPACE);
  for (let i = 0; i < 64; i++) {
    assert.equal(s.valid[i], s.valid[63 - i], 'black holes');
    if (s.warp[i] >= 0) assert.equal(s.warp[63 - i], 63 - s.warp[i], 'wormholes');
    const a = s.board[i], b = s.board[63 - i];
    assert.equal(!!a, !!b);
    if (a) assert.deepEqual([a.t, a.p], [b.t, 1 - b.p]);
  }
});

test('Nebula docks (castles) on both sides with its Commander on d8', () => {
  const s = space('r2k3r/8/8/8/8/8/8/4K3 b kq - 0 1');
  const docks = legalMoves(s).filter(m => m.castle).map(m => m.to).sort((a, b) => a - b);
  assert.deepEqual(docks, [sq('b8'), sq('f8')]);
});

test('a Rocket warps through the wormhole to deliver checkmate', () => {
  // Rocket b3 warps to g6: checks h8, and covers a8 and a7 across the seam.
  const g = new Game(SPACE);
  g.s = space('6rk/6pn/8/8/8/1N6/8/4K3 w - - 0 1');
  const mv = g.legal().find(m => m.from === sq('b3') && m.to === sq('g6'));
  assert.ok(mv?.warp);
  g.play(mv);
  assert.deepEqual(g.result, { winner: 0, reason: 'checkmate' });
  assert.equal(g.log.at(-1).text, 'Rocket b3~g6#');
});

test('travel: wrapped moves animate the short way through the seam', () => {
  const s = space('4k3/8/8/8/R7/8/8/4K3 w - - 0 1');
  assert.deepEqual(travel(s, { from: sq('a4'), to: sq('h4') }), [-1, 0]);
  assert.deepEqual(travel(s, { from: sq('a4'), to: sq('e4') }), [4, 0]); // left path blocked by f4
  assert.deepEqual(travel(s, { from: sq('a4'), to: sq('a8') }), [0, -4]);
});

test('undo restores the previous position', () => {
  const g = new Game(SPACE);
  const key = positionKey(g.s);
  g.play(g.legal()[0]);
  assert.notEqual(positionKey(g.s), key);
  g.undo();
  assert.equal(positionKey(g.s), key);
});

test('random games run to completion: no duplicate moves, nothing enters a black hole', () => {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let warps = 0;
  for (let game = 0; game < 8; game++) {
    const g = new Game(SPACE);
    for (let ply = 0; ply < 400 && !g.result; ply++) {
      const moves = g.legal();
      assert.ok(moves.length > 0, 'no moves but no result');
      assert.equal(new Set(moves.map(moveKey)).size, moves.length, 'duplicate moves');
      for (const m of moves) assert.ok(g.s.valid[m.to], 'move into a black hole');
      const mv = moves[Math.floor(rand() * moves.length)];
      if (mv.warp) warps++;
      // Attack detection and capture generation must agree, through the seam and wormholes too.
      if (ply % 7 === 0) {
        for (const p of [0, 1]) {
          const caps = new Set(pseudoMoves(g.s, p, true).filter(m => m.epCap === undefined).map(m => m.to));
          g.s.board.forEach((c, i) => {
            if (c && c.p !== p) assert.equal(attackedBy(g.s, i, q => q === p), caps.has(i), `square ${i}`);
          });
        }
      }
      g.play(mv);
      g.s.kings.forEach(k => assert.equal(g.s.board[k]?.t, 'K', 'king index'));
    }
  }
  assert.ok(warps > 0, 'random play should use a wormhole at least once');
});
