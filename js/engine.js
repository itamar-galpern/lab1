// Space Chess rules engine: board, move generation, make/unmake and Zobrist hashing.
// Pure logic with no DOM access, so it runs in the page, in the AI worker and under Node tests.
//
// Squares are indexed i = y * 8 + x (see rules.js). Internally a piece is a small integer:
// its type (P=1 ... K=6) plus 8 for Nebula pieces; 0 is an empty square and VOID is a square
// that doesn't exist (a black hole or a meteor-blocked square).
//
// The geometry tables only know the orbit wrap (files wrap, ranks don't). The layout lives in
// the state, because cosmic events can move it during a game:
//   - VOID cells on the board: rays stop in front of them and nothing lands on them;
//   - s.twin: wormhole links. A non-pawn ship whose move ends on one end is flung out of the
//     other end at once (a transit) if that exit is empty; a ship standing on an end may warp
//     to the other end as its move, and attacks it.

import { START, BLACK_HOLES, WORMHOLES, sq, sqName } from './rules.js';

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const VOID = 7;               // type 7 of side 0: inside the Zobrist range, so voids are hashed
const LETTERS = ' PNBRQK';
const CODE = { P, N, B, R, Q, K };
export const pc = (type, side) => type | (side << 3);
// A real ship of the other side (not empty, not a void).
const isFoe = (c, side) => c !== 0 && c !== VOID && c >> 3 !== side;

export const FWD = [-1, 1];           // pawn direction: Solar moves up the screen, Nebula down
const START_RANK = [6, 1];
const PROMO_RANK = [0, 7];
const PROMOS = ['Q', 'R', 'B', 'N'];

// ---------- geometry (orbit wrap only) ----------

// The square reached from i by (dx, dy), wrapping the files; -1 off the top or bottom edge.
export function step(i, dx, dy) {
  const y = (i >> 3) + dy;
  if (y < 0 || y > 7) return -1;
  return y * 8 + (((i & 7) + dx) & 7);
}

// Directions 0-3 are orthogonal, 4-7 diagonal.
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

// RAYS[i * 8 + d]: squares along direction d from i, nearest first. A ray is at most 7 steps
// (one more would bring a rank ray back to its start) and ends at the top or bottom edge.
export const RAYS = [];
for (let i = 0; i < 64; i++) {
  for (const [dx, dy] of DIRS) {
    const ray = [];
    for (let k = 1; k <= 7; k++) {
      const j = step(i, dx * k, dy * k);
      if (j < 0) break;
      ray.push(j);
    }
    RAYS.push(ray);
  }
}

// Leaper tables, flattened as [to, dx, dy, to, dx, dy, ...] per square.
// The Rocket adds four 2+2 diagonal boosts to the usual L-jumps.
const ROCKET = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1], [2, 2], [2, -2], [-2, 2], [-2, -2]];
const leaps = offsets => Array.from({ length: 64 }, (_, i) => {
  const out = [];
  for (const [dx, dy] of offsets) { const j = step(i, dx, dy); if (j >= 0) out.push(j, dx, dy); }
  return out;
});
export const KNIGHT = leaps(ROCKET);
export const KING = leaps(DIRS);

// PAWN_HITS[side][i]: squares a pawn of `side` standing on i attacks, flattened as [to, dx, ...].
export const PAWN_HITS = [0, 1].map(side => Array.from({ length: 64 }, (_, i) => {
  const out = [];
  for (const dx of [-1, 1]) { const j = step(i, dx, FWD[side]); if (j >= 0) out.push(j, dx); }
  return out;
}));

// Castling: the Commander's home square and its two rooks per side. Bits: 1 = Solar h1 (K),
// 2 = Solar a1 (Q), 4 = Nebula h8 (k), 8 = Nebula a8 (q). Nebula is rotated, so its short side is a8.
const KING_HOME = [60, 3];
const CASTLES = [[{ rook: 63, bit: 1 }, { rook: 56, bit: 2 }], [{ rook: 7, bit: 4 }, { rook: 0, bit: 8 }]];
const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[60] = 15 & ~3; CASTLE_MASK[63] = 15 & ~1; CASTLE_MASK[56] = 15 & ~2;
CASTLE_MASK[3] = 15 & ~12; CASTLE_MASK[7] = 15 & ~4; CASTLE_MASK[0] = 15 & ~8;

// ---------- Zobrist hashing (two 32-bit halves, fixed seed so every thread agrees) ----------

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
}
const rng = mulberry32(0x5ace5);
const rand32 = n => Int32Array.from({ length: n }, rng);
const ZL = rand32(16 * 64), ZH = rand32(16 * 64);
const ZCL = rand32(16), ZCH = rand32(16);
const ZEL = rand32(64), ZEH = rand32(64);
const ZSL = rng(), ZSH = rng();
const ZWL = rand32(64 * 64), ZWH = rand32(64 * 64);   // one key per wormhole pair (a < b)

// A position key that fits in a double exactly (53 bits).
const keyOf = (lo, hi) => (hi & 0x1fffff) * 4294967296 + (lo >>> 0);

// ---------- state ----------

function blank() {
  return {
    board: new Int8Array(64), twin: new Int8Array(64).fill(-1),
    turn: 0, castle: 0, ep: -1, halfmove: 0, fullmove: 1,
    kings: [-1, -1], lo: 0, hi: 0,
    stack: [],   // undo records, one per makeMove
    keys: [],    // position keys of the game so far, the current position last (for repetition)
  };
}

// Recomputes the hash and Commander squares from the board, and restarts the key history.
function finish(s) {
  let lo = ZCL[s.castle], hi = ZCH[s.castle];
  if (s.ep >= 0) { lo ^= ZEL[s.ep]; hi ^= ZEH[s.ep]; }
  if (s.turn) { lo ^= ZSL; hi ^= ZSH; }
  s.kings = [-1, -1];
  for (let i = 0; i < 64; i++) {
    const t = s.twin[i];
    if (t > i) { lo ^= ZWL[i * 64 + t]; hi ^= ZWH[i * 64 + t]; }
    const c = s.board[i];
    if (!c) continue;
    lo ^= ZL[c * 64 + i]; hi ^= ZH[c * 64 + i];
    if ((c & 7) === K) s.kings[c >> 3] = i;
  }
  s.lo = lo; s.hi = hi;
  s.keys = [keyOf(lo, hi)];
  return s;
}

// Puts the voids and wormholes of a layout on a board. Throws if a ship sits in a void.
function lay(s, voids, wormholes) {
  for (const i of voids) {
    if (s.board[i]) throw new Error(`FEN puts a piece in the black hole on ${sqName(i)}`);
    s.board[i] = VOID;
  }
  for (const [a, b] of wormholes) { s.twin[a] = b; s.twin[b] = a; }
}

export function newState() {
  const s = blank();
  for (const p of START) s.board[p.sq] = pc(CODE[p.type], p.side);
  lay(s, BLACK_HOLES, WORMHOLES);
  s.castle = 15;
  return finish(s);
}

// Standard 6-field FEN. Uppercase = Solar, lowercase = Nebula; 'w' = Solar to move.
// The layout (voids and wormholes) isn't part of FEN: it defaults to the standard board.
export function fromFEN(fen, { voids = BLACK_HOLES, wormholes = WORMHOLES } = {}) {
  const [place, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const rows = place.split('/');
  if (rows.length !== 8) throw new Error('FEN needs 8 ranks: ' + fen);
  const s = blank();
  rows.forEach((row, y) => {
    let x = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { x += +ch; continue; }
      const t = CODE[ch.toUpperCase()], i = y * 8 + x;
      if (!t || x > 7) throw new Error('bad FEN: ' + fen);
      s.board[i] = pc(t, ch === ch.toUpperCase() ? 0 : 1);
      x++;
    }
  });
  lay(s, voids, wormholes);
  s.turn = turn === 'b' ? 1 : 0;
  for (const ch of castling) s.castle |= { K: 1, Q: 2, k: 4, q: 8 }[ch] || 0;
  s.ep = ep === '-' ? -1 : sq(ep);
  s.halfmove = +half;
  s.fullmove = +full;
  return finish(s);
}

// Voids are written as empty squares (FEN has no way to say "missing").
export function toFEN(s) {
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let row = '', gap = 0;
    for (let x = 0; x < 8; x++) {
      const c = s.board[y * 8 + x];
      if (!c || c === VOID) { gap++; continue; }
      if (gap) { row += gap; gap = 0; }
      const l = LETTERS[c & 7];
      row += c >> 3 ? l.toLowerCase() : l;
    }
    rows.push(row + (gap || ''));
  }
  const castle = ['K', 'Q', 'k', 'q'].filter((_, k) => s.castle & (1 << k)).join('') || '-';
  return `${rows.join('/')} ${s.turn ? 'b' : 'w'} ${castle} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.halfmove} ${s.fullmove}`;
}

export function cloneState(s) {
  return { ...s, board: s.board.slice(), twin: s.twin.slice(), kings: s.kings.slice(), stack: s.stack.slice(), keys: s.keys.slice() };
}

// A plain JSON-safe copy (for postMessage), layout included. Keeps the key history since the
// last capture or pawn move, which is all repetition detection needs; the undo stack is not kept.
export function serialize(s) {
  return {
    board: Array.from(s.board), wormholes: features(s).wormholes,
    turn: s.turn, castle: s.castle, ep: s.ep,
    halfmove: s.halfmove, fullmove: s.fullmove, keys: s.keys.slice(-(s.halfmove + 1)),
  };
}

export function deserialize(o) {
  const s = blank();
  s.board = Int8Array.from(o.board);
  for (const [a, b] of o.wormholes || WORMHOLES) { s.twin[a] = b; s.twin[b] = a; }
  Object.assign(s, { turn: o.turn, castle: o.castle, ep: o.ep, halfmove: o.halfmove, fullmove: o.fullmove });
  finish(s);
  if (o.keys && o.keys.length && o.keys[o.keys.length - 1] === s.keys[0]) s.keys = o.keys.slice();
  return s;
}

export const positionKey = s => keyOf(s.lo, s.hi);
export const kingSquare = (s, side) => s.kings[side];

export function pieceAt(s, i) {
  const c = s.board[i];
  return c && c !== VOID ? { type: LETTERS[c & 7], side: c >> 3 } : null;
}

// ---------- the layout (changed by cosmic events, between moves only) ----------

export const isVoid = (s, i) => s.board[i] === VOID;
export const twinOf = (s, i) => s.twin[i];

export function features(s) {
  const voids = [], wormholes = [];
  for (let i = 0; i < 64; i++) {
    if (s.board[i] === VOID) voids.push(i);
    if (s.twin[i] > i) wormholes.push([i, s.twin[i]]);
  }
  return { voids, wormholes };
}

// The current position's key follows the layout; earlier keys in the history don't change.
function rekey(s, zl, zh) {
  s.lo ^= zl; s.hi ^= zh;
  s.keys[s.keys.length - 1] = keyOf(s.lo, s.hi);
}

// Turns square i into a void (it must be empty) or back into an empty square.
export function setVoid(s, i, on) {
  if (on ? s.board[i] !== 0 : s.board[i] !== VOID) throw new Error(`setVoid ${sqName(i)}: square is not ${on ? 'empty' : 'a void'}`);
  s.board[i] = on ? VOID : 0;
  rekey(s, ZL[VOID * 64 + i], ZH[VOID * 64 + i]);
}

export function linkWormhole(s, a, b) {
  if (a === b || s.twin[a] >= 0 || s.twin[b] >= 0 || s.board[a] === VOID || s.board[b] === VOID) {
    throw new Error(`cannot link ${sqName(a)} and ${sqName(b)}`);
  }
  s.twin[a] = b; s.twin[b] = a;
  const k = Math.min(a, b) * 64 + Math.max(a, b);
  rekey(s, ZWL[k], ZWH[k]);
}

export function unlinkWormhole(s, a) {
  const b = s.twin[a];
  if (b < 0) throw new Error(`no wormhole on ${sqName(a)}`);
  s.twin[a] = -1; s.twin[b] = -1;
  const k = Math.min(a, b) * 64 + Math.max(a, b);
  rekey(s, ZWL[k], ZWH[k]);
}

// ---------- attacks ----------

// Is square i attacked by a piece of side `by`?
export function attacked(s, i, by) {
  const b = s.board, o = by << 3;
  const H = PAWN_HITS[by ^ 1][i];   // a pawn of `by` attacks i from where an enemy pawn on i would hit
  for (let k = 0; k < H.length; k += 2) if (b[H[k]] === (P | o)) return true;
  let L = KNIGHT[i];
  for (let k = 0; k < L.length; k += 3) if (b[L[k]] === (N | o)) return true;
  L = KING[i];
  for (let k = 0; k < L.length; k += 3) if (b[L[k]] === (K | o)) return true;
  for (let d = 0; d < 8; d++) {
    const ray = RAYS[i * 8 + d], slider = (d < 4 ? R : B) | o;
    for (let k = 0; k < ray.length; k++) {
      const c = b[ray[k]];
      if (c) { if (c === slider || c === (Q | o)) return true; break; }
    }
  }
  const t = s.twin[i];
  if (t >= 0) { const c = b[t]; if (c && c !== VOID && c >> 3 === by && (c & 7) !== P) return true; }
  return false;
}

export function inCheck(s, side = s.turn) {
  const k = s.kings[side];
  return k >= 0 && attacked(s, k, side ^ 1);
}

// ---------- move generation ----------

function mv(from, to, piece, side, cap, capSq, promo, kind, vx, vy, rookFrom = -1, rookTo = -1, transit = -1) {
  return {
    from, to, piece: LETTERS[piece & 7], side, cap: cap ? LETTERS[cap & 7] : null, capSq: cap ? capSq : -1,
    promo, kind, vx, vy, rookFrom, rookTo, transit,
  };
}

// An ordinary move of a non-pawn ship from i to j. Ending on a wormhole end flings the ship out
// of the other end, if that exit is empty and isn't the square the ship just left.
function shipMove(s, i, j, c, side, tc, vx, vy) {
  const tw = s.twin[j];
  const transit = tw >= 0 && tw !== i && !s.board[tw] ? tw : -1;
  return mv(i, j, c, side, tc, j, null, 'move', vx, vy, -1, -1, transit);
}

// SEEN[j] === id marks squares the current piece already reaches, so each target is listed once.
const SEEN = new Int32Array(64);
let seenId = 0;

// Every move of the side to move, ignoring whether it leaves its own Commander in check.
// capturesOnly keeps captures and Flagship promotions (for the AI's quiescence search).
export function pseudoMoves(s, capturesOnly = false) {
  const b = s.board, side = s.turn, out = [];
  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if (!c || c === VOID || c >> 3 !== side) continue;
    const t = c & 7;
    if (t === P) { pawnMoves(s, i, c, side, capturesOnly, out); continue; }
    const id = ++seenId;
    if (t === N || t === K) {
      const L = t === N ? KNIGHT[i] : KING[i];
      for (let k = 0; k < L.length; k += 3) {
        const j = L[k], tc = b[j];
        if (tc && !isFoe(tc, side)) continue;
        SEEN[j] = id;
        if (tc || !capturesOnly) out.push(shipMove(s, i, j, c, side, tc, L[k + 1], L[k + 2]));
      }
      if (t === K && !capturesOnly) castles(s, i, side, out);
    } else {
      // Walk all of the slider's rays together, one step at a time. When the orbit lets two rays
      // reach the same square (a Station going either way round an open rank), the shorter path wins.
      const d0 = t === B ? 4 : 0, d1 = t === R ? 4 : 8;
      let open = ((1 << d1) - 1) & ~((1 << d0) - 1);
      for (let k = 0; open; k++) {
        for (let d = d0; d < d1; d++) {
          if (!(open & (1 << d))) continue;
          const ray = RAYS[i * 8 + d];
          if (k >= ray.length) { open &= ~(1 << d); continue; }
          const j = ray[k], tc = b[j];
          if (tc) open &= ~(1 << d);
          if (SEEN[j] === id || (tc && !isFoe(tc, side))) continue;
          SEEN[j] = id;
          if (tc || !capturesOnly) out.push(shipMove(s, i, j, c, side, tc, DIRS[d][0] * (k + 1), DIRS[d][1] * (k + 1)));
        }
      }
    }
    // Warping from a wormhole end: only listed when the ship can't already fly to the twin normally.
    const tw = s.twin[i];
    if (tw >= 0 && SEEN[tw] !== id) {
      const tc = b[tw];
      if (tc) { if (isFoe(tc, side)) out.push(mv(i, tw, c, side, tc, tw, null, 'warp', 0, 0)); }
      else if (!capturesOnly) out.push(mv(i, tw, c, side, 0, -1, null, 'warp', 0, 0));
    }
  }
  return out;
}

// Astronauts never transit or warp.
function pawnMoves(s, i, c, side, capturesOnly, out) {
  const b = s.board, dy = FWD[side], y = i >> 3;
  const promo = y + dy === PROMO_RANK[side];
  const add = (to, cap, capSq, kind, vx, vy) => {
    if (!promo) out.push(mv(i, to, c, side, cap, capSq, null, kind, vx, vy));
    else for (const p of capturesOnly ? ['Q'] : PROMOS) out.push(mv(i, to, c, side, cap, capSq, p, kind, vx, vy));
  };
  const one = step(i, 0, dy);
  if (one >= 0 && !b[one] && (!capturesOnly || promo)) {
    add(one, 0, -1, 'move', 0, dy);
    if (!capturesOnly && y === START_RANK[side]) {
      const two = step(i, 0, 2 * dy);
      if (two >= 0 && !b[two]) add(two, 0, -1, 'double', 0, 2 * dy);
    }
  }
  const H = PAWN_HITS[side][i];
  for (let k = 0; k < H.length; k += 2) {
    const j = H[k], tc = b[j];
    if (tc) { if (isFoe(tc, side)) add(j, tc, j, 'move', H[k + 1], dy); }
    else if (j === s.ep && b[j - 8 * dy] === pc(P, side ^ 1)) add(j, b[j - 8 * dy], j - 8 * dy, 'ep', H[k + 1], dy);
  }
}

// Castling never crosses the orbit seam: the Commander and Station must be on their home squares,
// with everything between them empty, and the Commander may not start in, cross or land in check.
function castles(s, i, side, out) {
  if (i !== KING_HOME[side]) return;
  const b = s.board, foe = side ^ 1;
  let checked = null;
  for (const { rook, bit } of CASTLES[side]) {
    if (!(s.castle & bit) || b[rook] !== pc(R, side)) continue;
    const dir = rook > i ? 1 : -1;
    let clear = true;
    for (let j = i + dir; j !== rook; j += dir) if (b[j]) { clear = false; break; }
    if (!clear) continue;
    if (checked === null) checked = attacked(s, i, foe);
    if (checked || attacked(s, i + dir, foe) || attacked(s, i + 2 * dir, foe)) continue;
    out.push(mv(i, i + 2 * dir, b[i], side, 0, -1, null, 'castle', 2 * dir, 0, rook, i + dir));
  }
}

export function legalMoves(s) {
  const side = s.turn, out = [];
  for (const m of pseudoMoves(s)) {
    makeMove(s, m);
    if (!inCheck(s, side)) out.push(m);
    unmakeMove(s);
  }
  return out;
}

// ---------- make / unmake ----------

export function makeMove(s, m) {
  const b = s.board, side = s.turn, piece = b[m.from];
  const cap = m.capSq >= 0 ? b[m.capSq] : 0;
  const dest = m.transit >= 0 ? m.transit : m.to;   // where the ship ends up
  s.stack.push({ m, cap, castle: s.castle, ep: s.ep, halfmove: s.halfmove, lo: s.lo, hi: s.hi });

  let lo = s.lo ^ ZCL[s.castle] ^ ZSL, hi = s.hi ^ ZCH[s.castle] ^ ZSH;
  if (s.ep >= 0) { lo ^= ZEL[s.ep]; hi ^= ZEH[s.ep]; }
  if (cap) { b[m.capSq] = 0; lo ^= ZL[cap * 64 + m.capSq]; hi ^= ZH[cap * 64 + m.capSq]; }
  const placed = m.promo ? pc(CODE[m.promo], side) : piece;
  b[m.from] = 0; lo ^= ZL[piece * 64 + m.from]; hi ^= ZH[piece * 64 + m.from];
  b[dest] = placed; lo ^= ZL[placed * 64 + dest]; hi ^= ZH[placed * 64 + dest];
  if ((piece & 7) === K) s.kings[side] = dest;
  if (m.kind === 'castle') {
    const rook = b[m.rookFrom];
    b[m.rookFrom] = 0; lo ^= ZL[rook * 64 + m.rookFrom]; hi ^= ZH[rook * 64 + m.rookFrom];
    b[m.rookTo] = rook; lo ^= ZL[rook * 64 + m.rookTo]; hi ^= ZH[rook * 64 + m.rookTo];
  }

  s.castle &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to] & CASTLE_MASK[dest];
  s.ep = m.kind === 'double' ? (m.from + m.to) >> 1 : -1;
  lo ^= ZCL[s.castle]; hi ^= ZCH[s.castle];
  if (s.ep >= 0) { lo ^= ZEL[s.ep]; hi ^= ZEH[s.ep]; }
  s.halfmove = (piece & 7) === P || cap ? 0 : s.halfmove + 1;
  if (side === 1) s.fullmove++;
  s.turn = side ^ 1;
  s.lo = lo; s.hi = hi;
  s.keys.push(keyOf(lo, hi));
}

// Passes the turn (the AI's null-move pruning). Undone by unmakeMove.
export function makeNull(s) {
  s.stack.push({ m: null, ep: s.ep, halfmove: s.halfmove, lo: s.lo, hi: s.hi });
  let lo = s.lo ^ ZSL, hi = s.hi ^ ZSH;
  if (s.ep >= 0) { lo ^= ZEL[s.ep]; hi ^= ZEH[s.ep]; s.ep = -1; }
  s.turn ^= 1;
  s.halfmove = 0;   // repetition checks must not look back across a null move
  s.lo = lo; s.hi = hi;
  s.keys.push(keyOf(lo, hi));
}

export function unmakeMove(s) {
  const u = s.stack.pop();
  if (!u) return false;
  s.keys.pop();
  s.ep = u.ep; s.halfmove = u.halfmove; s.lo = u.lo; s.hi = u.hi;
  const m = u.m;
  if (!m) { s.turn ^= 1; return true; }
  const b = s.board, side = s.turn ^ 1, dest = m.transit >= 0 ? m.transit : m.to;
  const moved = m.promo ? pc(P, side) : b[dest];
  b[dest] = 0;
  b[m.from] = moved;
  if (u.cap) b[m.capSq] = u.cap;
  if (m.kind === 'castle') { b[m.rookFrom] = b[m.rookTo]; b[m.rookTo] = 0; }
  if ((moved & 7) === K) s.kings[side] = m.from;
  s.turn = side;
  s.castle = u.castle;
  if (side === 1) s.fullmove--;
  return true;
}

// Counts leaf positions (for tests and debugging).
export function perft(s, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(s)) { makeMove(s, m); n += perft(s, depth - 1); unmakeMove(s); }
  return n;
}
