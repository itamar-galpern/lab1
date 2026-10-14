// Space Chess rules engine: board representation, move generation, make/unmake.
// Pure logic with no DOM access, so it runs in the page, in the AI worker and under Node tests.
//
// Board squares are indexed i = y * w + x, with y = 0 at the top of the screen.
// A piece is { t: 'K'|'Q'|'R'|'B'|'N'|'P', p: playerIndex, m: hasMoved }.
//
// Space rules, all driven by the mode object:
//   mode.wrap       - orbit wrap: the left and right edges are joined, so files wrap around.
//   mode.holes      - black holes: squares that don't exist (nothing lands on or passes through them).
//   mode.wormholes  - [[a, b], ...] linked squares: a non-pawn piece on one may warp to the other.

export const VALUE = { P: 100, N: 350, B: 330, R: 500, Q: 900, K: 0 };
export const PROMOS = ['Q', 'R', 'B', 'N'];

const N_CLASSIC = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const N_PLUS = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
const N_ALL = N_CLASSIC.concat(N_PLUS);
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KING = ORTHO.concat(DIAG);

export function knightJumps(mode) {
  return mode.knightPlus ? N_ALL : N_CLASSIC;
}

export function validMask(mode) {
  const valid = new Uint8Array(mode.w * mode.h);
  for (let y = 0; y < mode.h; y++)
    for (let x = 0; x < mode.w; x++)
      valid[y * mode.w + x] = mode.holes && mode.holes(x, y) ? 0 : 1;
  return valid;
}

// For each square, the square its wormhole leads to (or -1).
export function warpMap(mode) {
  const warp = new Int16Array(mode.w * mode.h).fill(-1);
  for (const [a, b] of mode.wormholes || []) { warp[a] = b; warp[b] = a; }
  return warp;
}

export function createState(mode) {
  const n = mode.players.length;
  const board = new Array(mode.w * mode.h).fill(null);
  const kings = new Array(n).fill(-1);
  for (const { t, p, x, y } of mode.setup) {
    const i = y * mode.w + x;
    board[i] = { t, p, m: false };
    if (t === 'K') kings[p] = i;
  }
  return {
    mode, w: mode.w, h: mode.h, n, board, valid: validMask(mode), warp: warpMap(mode), kings,
    turn: 0, alive: new Array(n).fill(true), ep: null, halfmove: 0, ply: 0,
  };
}

// Deep copy of everything mutable; the hole mask and wormhole map are shared because they never change.
export function cloneState(s) {
  return {
    ...s,
    board: s.board.map(c => c && { ...c }),
    kings: s.kings.slice(),
    alive: s.alive.slice(),
    ep: s.ep && { ...s.ep },
  };
}

// Plain-data form for postMessage; restore() rebuilds it with the mode object.
export function snapshot(s) {
  const { mode, valid, warp, ...rest } = cloneState(s);
  return { ...rest, modeId: mode.id };
}

export function restore(snap, mode) {
  const { modeId, ...rest } = snap;
  return { ...rest, mode, valid: validMask(mode), warp: warpMap(mode) };
}

// Loads a standard FEN into a 2-player 8x8 mode (used by tests). White = player 0.
export function fromFEN(mode, fen) {
  const [rows, side, castling, ep] = fen.trim().split(/\s+/);
  const s = createState({ ...mode, setup: [] });
  rows.split('/').forEach((row, y) => {
    let x = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { x += +ch; continue; }
      const p = ch === ch.toUpperCase() ? 0 : 1;
      const t = ch.toUpperCase();
      const homePawnRow = p === 0 ? 6 : 1;
      const m = t === 'P' ? y !== homePawnRow : t === 'K' || t === 'R';
      s.board[y * 8 + x] = { t, p, m };
      if (t === 'K') s.kings[p] = y * 8 + x;
      x++;
    }
  });
  const unmove = i => { if (s.board[i]) s.board[i].m = false; };
  for (const r of castling === '-' ? '' : castling) {
    const p = r === r.toUpperCase() ? 0 : 1;
    const k = s.kings[p], y = (k - (k % 8)) / 8;
    unmove(k);
    const rook = y * 8 + ('Kk'.includes(r) ? 7 : 0);
    if (s.board[rook]?.t === 'R') unmove(rook);
  }
  s.turn = side === 'w' ? 0 : 1;
  if (ep && ep !== '-') {
    const x = ep.charCodeAt(0) - 97, y = 8 - +ep[1];
    const capY = s.turn === 0 ? y + 1 : y - 1;
    s.ep = { to: y * 8 + x, cap: capY * 8 + x, p: 1 - s.turn };
  }
  return s;
}

// Square index at (x, y), or -1 if it is off the board or a black hole. Files wrap in orbit mode.
export function sqAt(s, x, y) {
  if (y < 0 || y >= s.h) return -1;
  if (x < 0 || x >= s.w) {
    if (!s.mode.wrap) return -1;
    x = ((x % s.w) + s.w) % s.w;
  }
  const i = y * s.w + x;
  return s.valid[i] ? i : -1;
}

// Like sqAt but never wraps (castling stays on its own side of the seam).
function sqFlat(s, x, y) {
  return x >= 0 && y >= 0 && x < s.w && y < s.h && s.valid[y * s.w + x] ? y * s.w + x : -1;
}

// Longest useful ray. On a wrapped rank a longer ray would come back around to its start.
const rayLen = s => Math.max(s.w, s.h) - 1;

// On a wrapped board two rays can reach the same square (a rook going left or right around
// an empty rank), so slide() stamps each target to emit every move only once.
const stamp = new Int32Array(4096);
let stampId = 0;

export function sqName(s, i) {
  const x = i % s.w, y = (i - x) / s.w;
  return 'abcdefghijklmnop'[x] + (s.h - y);
}

// How far a square is from player p's back row (0 = back row).
export function relRank(s, p, x, y) {
  const [dx, dy] = s.mode.players[p].dir;
  return dy < 0 ? s.h - 1 - y : dy > 0 ? y : dx > 0 ? x : s.w - 1 - x;
}

export function nextAlive(s, t) {
  for (let k = 1; k <= s.n; k++) {
    const q = (t + k) % s.n;
    if (s.alive[q]) return q;
  }
  return t;
}

export function pseudoMoves(s, p, capturesOnly = false) {
  const out = [];
  const { w, board } = s;
  for (let i = 0; i < board.length; i++) {
    const pc = board[i];
    if (!pc || pc.p !== p) continue;
    const x = i % w, y = (i - x) / w;
    const start = out.length;
    switch (pc.t) {
      case 'N': leap(s, p, i, x, y, knightJumps(s.mode), out, capturesOnly); break;
      case 'K':
        leap(s, p, i, x, y, KING, out, capturesOnly);
        if (!capturesOnly) castles(s, p, i, x, y, pc, out);
        break;
      case 'R': slide(s, p, i, x, y, ORTHO, out, capturesOnly); break;
      case 'B': slide(s, p, i, x, y, DIAG, out, capturesOnly); break;
      case 'Q': slide(s, p, i, x, y, KING, out, capturesOnly); break;
      case 'P': pawn(s, p, i, x, y, pc, out, capturesOnly); break;
    }
    if (s.warp[i] >= 0 && pc.t !== 'P') warpMove(s, p, i, s.warp[i], out, start, capturesOnly);
  }
  return out;
}

// A non-pawn piece standing on a wormhole may warp to its twin, capturing an enemy there.
// If the piece could already reach the twin normally (e.g. along a wrapped diagonal),
// the ordinary move covers it.
function warpMove(s, p, i, j, out, start, capturesOnly) {
  for (let k = start; k < out.length; k++) if (out[k].to === j) return;
  const t = s.board[j];
  if (t) { if (t.p !== p) out.push({ from: i, to: j, cap: true, warp: true }); }
  else if (!capturesOnly) out.push({ from: i, to: j, warp: true });
}

function leap(s, p, i, x, y, dirs, out, capturesOnly) {
  for (const [dx, dy] of dirs) {
    const j = sqAt(s, x + dx, y + dy);
    if (j < 0) continue;
    const t = s.board[j];
    if (t) { if (t.p !== p) out.push({ from: i, to: j, cap: true }); }
    else if (!capturesOnly) out.push({ from: i, to: j });
  }
}

function slide(s, p, i, x, y, dirs, out, capturesOnly) {
  const id = ++stampId, len = rayLen(s);
  for (const [dx, dy] of dirs) {
    for (let k = 1, cx = x + dx, cy = y + dy; k <= len; k++, cx += dx, cy += dy) {
      const j = sqAt(s, cx, cy);
      if (j < 0) break;
      const t = s.board[j];
      const fresh = stamp[j] !== id;
      stamp[j] = id;
      if (t) { if (t.p !== p && fresh) out.push({ from: i, to: j, cap: true }); break; }
      if (!capturesOnly && fresh) out.push({ from: i, to: j });
    }
  }
}

function pawn(s, p, i, x, y, pc, out, capturesOnly) {
  const [dx, dy] = s.mode.players[p].dir;
  const sx = dy ? 1 : 0, sy = dx ? 1 : 0; // sideways axis
  const add = (to, extra) => {
    const tx = to % s.w, ty = (to - tx) / s.w;
    if (relRank(s, p, tx, ty) >= s.mode.promoteRank) {
      for (const t of PROMOS) out.push({ from: i, to, promo: t, ...extra });
    } else out.push({ from: i, to, ...extra });
  };
  const f = sqAt(s, x + dx, y + dy);
  if (f >= 0 && !s.board[f] && !capturesOnly) {
    add(f, {});
    if (!pc.m && s.mode.doubleStep) {
      const f2 = sqAt(s, x + 2 * dx, y + 2 * dy);
      if (f2 >= 0 && !s.board[f2]) out.push({ from: i, to: f2, double: f });
    }
  }
  for (const k of [-1, 1]) {
    const c = sqAt(s, x + dx + k * sx, y + dy + k * sy);
    if (c < 0) continue;
    const t = s.board[c];
    if (t) { if (t.p !== p) add(c, { cap: true }); }
    else if (s.ep && s.ep.to === c && s.ep.p !== p) out.push({ from: i, to: c, cap: true, epCap: s.ep.cap });
  }
}

// Generic castling: an unmoved king slides 2 squares along its back row toward an
// unmoved rook (at least 3 squares away, path empty), and the rook hops over it.
function castles(s, p, i, x, y, pc, out) {
  if (pc.m || !s.mode.castling) return;
  const [dx, dy] = s.mode.players[p].dir;
  const ax = dy ? 1 : 0, ay = dx ? 1 : 0;
  let inCheckNow = null;
  for (const k of [-1, 1]) {
    let cx = x + k * ax, cy = y + k * ay, dist = 1, j;
    while ((j = sqFlat(s, cx, cy)) >= 0 && !s.board[j]) { cx += k * ax; cy += k * ay; dist++; }
    if (j < 0) continue;
    const r = s.board[j];
    if (r.p !== p || r.t !== 'R' || r.m || dist < 3) continue;
    if (inCheckNow === null) inCheckNow = attacked(s, i, p);
    if (inCheckNow) return;
    const a = sqFlat(s, x + k * ax, y + k * ay), b = sqFlat(s, x + 2 * k * ax, y + 2 * k * ay);
    if (attacked(s, a, p) || attacked(s, b, p)) continue;
    out.push({ from: i, to: b, castle: { from: j, to: a } });
  }
}

// Is square i attacked by any piece whose owner satisfies isAttacker(owner)?
export function attackedBy(s, i, isAttacker) {
  const { w, board } = s;
  const x = i % w, y = (i - x) / w;
  for (const [dx, dy] of knightJumps(s.mode)) {
    const j = sqAt(s, x + dx, y + dy);
    if (j < 0) continue;
    const t = board[j];
    if (t && t.t === 'N' && isAttacker(t.p)) return true;
  }
  for (const [dx, dy] of KING) {
    const j = sqAt(s, x + dx, y + dy);
    if (j < 0) continue;
    const t = board[j];
    if (t && t.t === 'K' && isAttacker(t.p)) return true;
  }
  const len = rayLen(s);
  for (const [dirs, a, b] of [[ORTHO, 'R', 'Q'], [DIAG, 'B', 'Q']]) {
    for (const [dx, dy] of dirs) {
      for (let k = 1, cx = x + dx, cy = y + dy; k <= len; k++, cx += dx, cy += dy) {
        const j = sqAt(s, cx, cy);
        if (j < 0) break;
        const t = board[j];
        if (!t) continue;
        if ((t.t === a || t.t === b) && isAttacker(t.p)) return true;
        break;
      }
    }
  }
  for (let q = 0; q < s.n; q++) {
    if (!isAttacker(q)) continue;
    const [dx, dy] = s.mode.players[q].dir;
    const sx = dy ? 1 : 0, sy = dx ? 1 : 0;
    for (const k of [-1, 1]) {
      const j = sqAt(s, x - dx - k * sx, y - dy - k * sy);
      if (j < 0) continue;
      const t = board[j];
      if (t && t.t === 'P' && t.p === q) return true;
    }
  }
  // A non-pawn piece on the twin wormhole can warp here.
  const j = s.warp[i];
  if (j >= 0) {
    const t = board[j];
    if (t && t.t !== 'P' && isAttacker(t.p)) return true;
  }
  return false;
}

// Is square i attacked by anyone other than player p?
export function attacked(s, i, p) {
  return attackedBy(s, i, q => q !== p);
}

export function inCheck(s, p) {
  const k = s.kings[p];
  return k >= 0 && attacked(s, k, p);
}

export function makeMove(s, mv) {
  const b = s.board, pc = b[mv.from];
  const capSq = mv.epCap ?? mv.to;
  const u = { mv, pc, cap: b[capSq], capSq, m: pc.m, t: pc.t, ep: s.ep, half: s.halfmove, turn: s.turn, rm: false };
  if (u.cap) {
    b[capSq] = null;
    if (u.cap.t === 'K') s.kings[u.cap.p] = -1;
  }
  b[mv.from] = null;
  b[mv.to] = pc;
  pc.m = true;
  if (mv.promo) pc.t = mv.promo;
  if (pc.t === 'K') s.kings[pc.p] = mv.to;
  if (mv.castle) {
    const r = b[mv.castle.from];
    u.rm = r.m;
    b[mv.castle.from] = null;
    b[mv.castle.to] = r;
    r.m = true;
  }
  s.ep = mv.double !== undefined && s.mode.enPassant ? { to: mv.double, cap: mv.to, p: pc.p } : null;
  s.halfmove = u.t === 'P' || u.cap ? 0 : s.halfmove + 1;
  s.ply++;
  s.turn = nextAlive(s, s.turn);
  return u;
}

export function unmakeMove(s, u) {
  const b = s.board, mv = u.mv, pc = u.pc;
  if (mv.castle) {
    const r = b[mv.castle.to];
    b[mv.castle.to] = null;
    b[mv.castle.from] = r;
    r.m = u.rm;
  }
  b[mv.to] = null;
  b[mv.from] = pc;
  pc.m = u.m;
  pc.t = u.t;
  if (pc.t === 'K') s.kings[pc.p] = mv.from;
  if (u.cap) {
    b[u.capSq] = u.cap;
    if (u.cap.t === 'K') s.kings[u.cap.p] = u.capSq;
  }
  s.ep = u.ep;
  s.halfmove = u.half;
  s.turn = u.turn;
  s.ply--;
}

// Moves for player p that don't leave p's own king attacked.
export function legalMoves(s, p = s.turn, capturesOnly = false) {
  const out = [];
  for (const mv of pseudoMoves(s, p, capturesOnly)) {
    const u = makeMove(s, mv);
    const k = s.kings[p];
    if (k < 0 || !attacked(s, k, p)) out.push(mv);
    unmakeMove(s, u);
  }
  return out;
}

// The (dx, dy) a move travels on screen. On a wrapped board a slide may cross the seam, so take
// the shortest direction whose path is actually clear (call this before making the move).
export function travel(s, mv) {
  const fx = mv.from % s.w, fy = (mv.from - fx) / s.w, tx = mv.to % s.w, ty = (mv.to - tx) / s.w;
  const dy = ty - fy, dx = tx - fx;
  if (!s.mode.wrap || mv.warp || mv.castle) return [dx, dy];
  const options = [dx, dx - s.w, dx + s.w].sort((a, b) => Math.abs(a) - Math.abs(b));
  const pc = s.board[mv.from];
  if (!pc || !'RBQ'.includes(pc.t)) return [options[0], dy];
  for (const ox of options) {
    if (!(ox === 0 || dy === 0 || Math.abs(ox) === Math.abs(dy))) continue;
    const n = Math.max(Math.abs(ox), Math.abs(dy)), sx = Math.sign(ox), sy = Math.sign(dy);
    let clear = true;
    for (let k = 1; k < n && clear; k++) {
      const j = sqAt(s, fx + k * sx, fy + k * sy);
      clear = j >= 0 && !s.board[j];
    }
    if (clear) return [ox, dy];
  }
  return [options[0], dy];
}

export function positionKey(s) {
  let k = s.turn + ':' + (s.ep ? s.ep.to : '-') + ':';
  for (const c of s.board) k += c ? c.p + c.t + (c.m ? '' : '*') : '.';
  return k;
}

export function perft(s, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const mv of moves) {
    const u = makeMove(s, mv);
    n += perft(s, depth - 1);
    unmakeMove(s, u);
  }
  return n;
}
