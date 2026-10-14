// Space Chess computer opponents: iterative-deepening negamax with alpha-beta (PVS), a
// transposition table, null-move pruning, killer/history move ordering and a quiescence search.
// The space rules live in the engine's move generator, so the search plays them without knowing.

import {
  P, N, B, R, Q, K, FWD, RAYS, KNIGHT, step,
  pseudoMoves, legalMoves, makeMove, unmakeMove, makeNull, attacked, cloneState,
} from './engine.js';
import { warpTwin, isHole } from './rules.js';

export const LEVELS = [
  { id: 'cadet', name: 'Cadet', blurb: 'Fresh out of the academy and prone to blunders.' },
  { id: 'pilot', name: 'Pilot', blurb: 'Knows the controls but misses deeper tricks.' },
  { id: 'captain', name: 'Captain', blurb: 'A solid opponent who looks a few moves ahead.' },
  { id: 'admiral', name: 'Admiral', blurb: 'Calculates carefully and punishes loose ships.' },
  { id: 'overlord', name: 'Overlord', blurb: 'Thinks deep and plays to win. Good luck.' },
];

// depth: deepest iteration; time: budget in ms; noise: random centipawns added to each root move.
const SETTINGS = {
  cadet: { depth: 1, time: 300, noise: 260 },
  pilot: { depth: 2, time: 500, noise: 70 },
  captain: { depth: 3, time: 800, noise: 12 },
  admiral: { depth: 6, time: 1500, noise: 0 },
  overlord: { depth: 40, time: 3000, noise: 0 },
};

const MATE = 100000, INF = 1e9, MAX_PLY = 64;
const ABORT = Symbol('abort');
const now = () => performance.now();

// ---------- evaluation ----------

const VAL = [0, 100, 320, 330, 500, 900, 0];
const LVAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 2000 };
const PHASE = [0, 0, 1, 1, 2, 4, 0];

// Bonuses by rank counted from the piece's own back rank (0) to the far rank (7). Files wrap
// around the orbit, so no file is an edge and only the ranks matter.
const RANK = [
  null,
  [0, 0, 4, 10, 20, 35, 60, 0],         // Astronaut
  [-15, -4, 6, 12, 15, 10, 0, -10],     // Rocket
  [-8, 2, 6, 8, 8, 6, 2, -6],           // Comet
  [0, 0, 0, 0, 2, 6, 18, 8],            // Station
  [-6, 0, 3, 5, 5, 3, 0, -4],           // Flagship
];
const KING_MID = [12, -8, -25, -35, -45, -50, -50, -50];
const KING_END = [-25, -8, 6, 14, 14, 6, -8, -25];
const PASSED = [0, 5, 10, 18, 30, 50, 80, 0];

// STUCK[side][i]: an Astronaut on i has a black hole somewhere ahead on its file, so it can
// never walk to promotion (it can still capture its way out).
const STUCK = [0, 1].map(side => Array.from({ length: 64 }, (_, i) => {
  for (let j = i + 8 * FWD[side]; j >= 0 && j < 64; j += 8 * FWD[side]) if (isHole(j)) return true;
  return false;
}));
const WARP = Array.from({ length: 64 }, (_, i) => warpTwin(i) >= 0);

// Score from the point of view of the side to move.
function evaluate(s) {
  const b = s.board;
  let score = 0, mid = 0, end = 0, phase = 0;
  // Pawn extents per file for passed-pawn checks: the most advanced Solar pawn rank is the
  // smallest y, so track Solar's largest y (rearmost) and Nebula's smallest y (rearmost).
  const solarBack = [-1, -1, -1, -1, -1, -1, -1, -1], nebulaBack = [8, 8, 8, 8, 8, 8, 8, 8];
  const files = [new Int8Array(8), new Int8Array(8)];
  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if ((c & 7) !== P) continue;
    const x = i & 7, y = i >> 3;
    if (c >> 3) { if (y < nebulaBack[x]) nebulaBack[x] = y; files[1][x]++; }
    else { if (y > solarBack[x]) solarBack[x] = y; files[0][x]++; }
  }
  for (let i = 0; i < 64; i++) {
    const c = b[i];
    if (!c) continue;
    const t = c & 7, side = c >> 3, sign = side ? -1 : 1;
    const y = i >> 3, r = side ? y : 7 - y;
    phase += PHASE[t];
    if (t === K) {
      mid += sign * KING_MID[r];
      end += sign * KING_END[r];
      // Astronauts sheltering the Commander (files wrap, so every Commander has three in front).
      let shield = 0;
      for (let dx = -1; dx <= 1; dx++) { const j = step(i, dx, FWD[side]); if (j >= 0 && b[j] === (P | (side << 3))) shield++; }
      mid += sign * shield * 10;
      continue;
    }
    let v = VAL[t] + RANK[t][r];
    if (t === P) {
      const x = i & 7;
      if (files[side][x] > 1) v -= 8;
      if (STUCK[side][i]) v -= 10;
      else {
        let passed = true;
        for (let dx = -1; dx <= 1 && passed; dx++) {
          const f = (x + dx) & 7;
          passed = side ? solarBack[f] <= y : nebulaBack[f] >= y;
        }
        if (passed) { mid += sign * PASSED[r] / 2; end += sign * PASSED[r]; }
      }
    } else {
      if (WARP[i]) v += 8;   // a ship on a wormhole controls both ends
      // Mobility.
      let moves = 0;
      if (t === N) {
        const L = KNIGHT[i];
        for (let k = 0; k < L.length; k += 3) { const tc = b[L[k]]; if (!tc || tc >> 3 !== side) moves++; }
        v += moves * 3;
      } else {
        const d0 = t === B ? 4 : 0, d1 = t === R ? 4 : 8;
        for (let d = d0; d < d1; d++) {
          const ray = RAYS[i * 8 + d];
          for (let k = 0; k < ray.length; k++) { const tc = b[ray[k]]; if (!tc) moves++; else { if (tc >> 3 !== side) moves++; break; } }
        }
        v += moves * (t === B ? 4 : t === R ? 2 : 1);
      }
    }
    score += sign * v;
  }
  const ph = Math.min(phase, 24);
  score += Math.round((mid * ph + end * (24 - ph)) / 24);
  return (s.turn ? -score : score) + 10;   // small bonus for having the move
}

// ---------- transposition table ----------

const TT_SIZE = 1 << 19, TT_MASK = TT_SIZE - 1;
const EXACT = 0, LOWER = 1, UPPER = 2;
let tt = null;
function table() {
  return tt || (tt = {
    key: new Int32Array(TT_SIZE), move: new Int32Array(TT_SIZE), score: new Int32Array(TT_SIZE),
    depth: new Int8Array(TT_SIZE).fill(-1), flag: new Int8Array(TT_SIZE),
  });
}
// Mate scores are stored relative to the node so they stay right at any distance from the root.
const toTT = (v, ply) => (v > MATE - 1000 ? v + ply : v < -MATE + 1000 ? v - ply : v);
const fromTT = (v, ply) => (v > MATE - 1000 ? v - ply : v < -MATE + 1000 ? v + ply : v);
const encode = m => 1 + m.from + (m.to << 6) + ((m.promo ? 'QRBN'.indexOf(m.promo) + 1 : 0) << 12);

// ---------- search ----------

function scoreMoves(ctx, moves, ttMove, ply) {
  const sc = new Int32Array(moves.length);
  const k0 = ctx.killers[ply * 2], k1 = ctx.killers[ply * 2 + 1], side = ctx.s.turn;
  for (let k = 0; k < moves.length; k++) {
    const m = moves[k], e = encode(m);
    if (e === ttMove) sc[k] = 1 << 30;
    else if (m.cap) sc[k] = 100000000 + LVAL[m.cap] * 16 - LVAL[m.piece] / 10;
    else if (m.promo) sc[k] = 90000000 + LVAL[m.promo];
    else if (e === k0) sc[k] = 80000000;
    else if (e === k1) sc[k] = 79000000;
    else sc[k] = ctx.history[side * 4096 + m.from * 64 + m.to];
  }
  return sc;
}

// Selection sort, one step at a time: cutoffs usually come early, so most moves are never sorted.
function pick(moves, sc, k) {
  let best = k;
  for (let j = k + 1; j < moves.length; j++) if (sc[j] > sc[best]) best = j;
  if (best !== k) {
    const m = moves[k]; moves[k] = moves[best]; moves[best] = m;
    const v = sc[k]; sc[k] = sc[best]; sc[best] = v;
  }
  return moves[k];
}

// Has this position occurred before since the last capture or pawn move? (Treated as a draw.)
function repeated(s) {
  const keys = s.keys, last = keys.length - 1;
  for (let k = 2; k <= s.halfmove && k <= last; k += 2) if (keys[last - k] === keys[last]) return true;
  return false;
}

function hasPieces(s, side) {
  for (let i = 0; i < 64; i++) {
    const c = s.board[i];
    if (c && c >> 3 === side && (c & 7) !== P && (c & 7) !== K) return true;
  }
  return false;
}

function tick(ctx) {
  if ((++ctx.nodes & 1023) === 0 && ctx.canAbort && now() > ctx.deadline) throw ABORT;
}

function search(ctx, depth, alpha, beta, ply, nullOk) {
  tick(ctx);
  const s = ctx.s, side = s.turn;
  if (ply > 0 && (s.halfmove >= 100 || repeated(s))) return 0;
  if (ply >= MAX_PLY) return evaluate(s);
  const check = attacked(s, s.kings[side], side ^ 1);
  if (check) depth++;
  if (depth <= 0) return quiesce(ctx, alpha, beta, ply);

  const t = table(), idx = s.lo & TT_MASK;
  let ttMove = 0;
  if (t.key[idx] === s.hi && t.depth[idx] >= 0) {
    ttMove = t.move[idx];
    if (ply > 0 && t.depth[idx] >= depth) {
      const v = fromTT(t.score[idx], ply), f = t.flag[idx];
      if (f === EXACT || (f === LOWER && v >= beta) || (f === UPPER && v <= alpha)) return v;
    }
  }

  // Null move: if passing still beats beta, a real move surely does.
  if (nullOk && !check && depth >= 3 && ply > 0 && beta < MATE - 1000 && hasPieces(s, side)) {
    makeNull(s);
    const v = -search(ctx, depth - 3, -beta, -beta + 1, ply + 1, false);
    unmakeMove(s);
    if (v >= beta) return beta;
  }

  const moves = pseudoMoves(s);
  const sc = scoreMoves(ctx, moves, ttMove, ply);
  const alpha0 = alpha;
  let best = -INF, bestMove = 0, legal = 0;
  for (let k = 0; k < moves.length; k++) {
    const m = pick(moves, sc, k);
    makeMove(s, m);
    if (attacked(s, s.kings[side], side ^ 1)) { unmakeMove(s); continue; }
    legal++;
    let v;
    if (legal === 1) v = -search(ctx, depth - 1, -beta, -alpha, ply + 1, true);
    else {
      v = -search(ctx, depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (v > alpha && v < beta) v = -search(ctx, depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmakeMove(s);
    if (v > best) {
      best = v;
      bestMove = encode(m);
      if (v > alpha) {
        alpha = v;
        if (v >= beta) {
          if (!m.cap && !m.promo) {
            if (ctx.killers[ply * 2] !== bestMove) { ctx.killers[ply * 2 + 1] = ctx.killers[ply * 2]; ctx.killers[ply * 2] = bestMove; }
            const h = side * 4096 + m.from * 64 + m.to;
            ctx.history[h] = Math.min(ctx.history[h] + depth * depth, 50000000);
          }
          break;
        }
      }
    }
  }
  if (!legal) return check ? -MATE + ply : 0;

  t.key[idx] = s.hi;
  t.move[idx] = bestMove;
  t.score[idx] = toTT(best, ply);
  t.depth[idx] = depth;
  t.flag[idx] = best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER;
  return best;
}

// Only captures (and Flagship promotions), so the evaluation is never taken mid-exchange.
function quiesce(ctx, alpha, beta, ply) {
  tick(ctx);
  const s = ctx.s, side = s.turn;
  const stand = evaluate(s);
  if (stand >= beta || ply >= MAX_PLY) return stand;
  if (stand > alpha) alpha = stand;
  const moves = pseudoMoves(s, true);
  const sc = scoreMoves(ctx, moves, 0, Math.min(ply, MAX_PLY - 1));
  for (let k = 0; k < moves.length; k++) {
    const m = pick(moves, sc, k);
    if (m.cap && !m.promo && stand + LVAL[m.cap] + 200 < alpha) continue;   // delta pruning
    makeMove(s, m);
    if (attacked(s, s.kings[side], side ^ 1)) { unmakeMove(s); continue; }
    const v = -quiesce(ctx, -beta, -alpha, ply + 1);
    unmakeMove(s);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

// Picks a move for the side to move. Never touches the caller's state.
// Returns { from, to, promo, ... } (one of legalMoves(state)) or null when there is no legal move.
export function chooseMove(state, levelId, { rand = Math.random, timeScale = 1 } = {}) {
  const lv = SETTINGS[levelId] || SETTINGS.captain;
  const s = cloneState(state);
  const roots = legalMoves(s);
  if (roots.length <= 1) return roots[0] || null;

  const ctx = {
    s, nodes: 0, canAbort: false, deadline: now() + lv.time * timeScale,
    killers: new Int32Array(MAX_PLY * 2 + 2), history: new Int32Array(2 * 4096),
  };
  const start = now();
  const noise = roots.map(() => (lv.noise ? (rand() * 2 - 1) * lv.noise : 0));
  // First guess: captures of valuable ships first.
  let order = roots.map((_, k) => k).sort((a, b) => (roots[b].cap ? LVAL[roots[b].cap] : 0) - (roots[a].cap ? LVAL[roots[a].cap] : 0));
  let scores = null, reached = 0;

  for (let depth = 1; depth <= lv.depth; depth++) {
    ctx.canAbort = depth > 1;   // the first iteration always finishes, so there is always an answer
    const cur = new Array(roots.length).fill(-INF);
    try {
      let alpha = -INF;
      for (const k of order) {
        makeMove(s, roots[k]);
        let v;
        // With noise every root move needs an exact score; otherwise a null window will do.
        if (lv.noise || alpha === -INF) v = -search(ctx, depth - 1, -INF, INF, 1, true);
        else {
          v = -search(ctx, depth - 1, -alpha - 1, -alpha, 1, true);
          if (v > alpha) v = -search(ctx, depth - 1, -INF, -alpha, 1, true);
        }
        unmakeMove(s);
        cur[k] = v;
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      break;
    }
    scores = cur;
    reached = depth;
    order = order.slice().sort((a, b) => cur[b] - cur[a]);
    if (Math.abs(cur[order[0]]) > MATE - 1000) break;          // a forced mate either way
    if (now() - start > lv.time * timeScale * 0.55) break;      // the next iteration won't finish
  }

  // Without noise, trust the sorted order: moves that failed low only have upper bounds as scores.
  let best = order[0];
  if (lv.noise) {
    let bestScore = -INF;
    for (let k = 0; k < roots.length; k++) {
      const v = scores[k] + noise[k];
      if (v > bestScore) { bestScore = v; best = k; }
    }
  }
  chooseMove.stats = { depth: reached, nodes: ctx.nodes, ms: Math.round(now() - start) };
  return roots[best];
}
