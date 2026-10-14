// Space Chess computer opponents: iterative-deepening alpha-beta (negamax + quiescence).
// Wormholes, black holes and orbit wrap all live in the engine's move generator, so the
// search plays them without knowing about them.

import { VALUE, cloneState, legalMoves, makeMove, unmakeMove, inCheck, relRank } from './engine.js';

export const LEVELS = [
  { id: 'cadet',    name: 'Cadet',    depth: 1, noise: 350, time: 400 },
  { id: 'pilot',    name: 'Pilot',    depth: 1, noise: 80,  time: 600 },
  { id: 'captain',  name: 'Captain',  depth: 2, noise: 25,  time: 1500 },
  { id: 'admiral',  name: 'Admiral',  depth: 3, noise: 0,   time: 2500 },
  { id: 'overlord', name: 'Overlord', depth: 6, noise: 0,   time: 3500 },
];

const MATE = 1e6;
const ABORT = Symbol('abort');

export function chooseMove(s0, levelId, rand = Math.random) {
  const lv = LEVELS.find(l => l.id === levelId) || LEVELS[2];
  const s = cloneState(s0);
  const moves = legalMoves(s);
  if (moves.length <= 1) return moves[0] || null;
  return searchDuel(s, moves, lv, rand);
}

// ---------- evaluation ----------

// On a wrapped (cylinder) board every file is as central as any other, so only the rank counts.
function centrality(s, x, y) {
  const cx = (s.w - 1) / 2, cy = (s.h - 1) / 2;
  return s.mode.wrap
    ? Math.max(0, 6 - 2 * Math.abs(y - cy))
    : Math.max(0, 6 - (Math.abs(x - cx) + Math.abs(y - cy)));
}

function pieceScore(s, c, i) {
  const x = i % s.w, y = (i - x) / s.w;
  const centre = centrality(s, x, y);
  let v = VALUE[c.t];
  // A ship on a wormhole has a long reach; a Commander on one can be checked from the far end.
  if (s.warp[i] >= 0) v += c.t === 'K' ? -30 : c.t === 'P' ? 0 : 15;
  switch (c.t) {
    case 'N': v += centre * 6; break;
    case 'B': v += centre * 4; break;
    case 'Q': v += centre * 2; break;
    case 'R': v += centre; break;
    case 'P': v += relRank(s, c.p, x, y) * 8 + centre * 2; break;
    case 'K': v -= centre * 3; break;
  }
  return v;
}

// Score from player p's point of view: own material and placement minus the opponent's.
function evaluate(s, p) {
  let v = 0;
  s.board.forEach((c, i) => { if (c) v += c.p === p ? pieceScore(s, c, i) : -pieceScore(s, c, i); });
  return v;
}

function orderMoves(s, moves, first) {
  const score = mv => {
    if (first && mv.from === first.from && mv.to === first.to && mv.promo === first.promo) return 1e9;
    let v = 0;
    if (mv.cap) {
      const victim = s.board[mv.epCap ?? mv.to];
      v += 10 * VALUE[victim.t] + (victim.t === 'K' ? 1e7 : 0) - VALUE[s.board[mv.from].t] / 10 + 1000;
    }
    if (mv.promo) v += VALUE[mv.promo];
    return v;
  };
  return moves.map(mv => [score(mv), mv]).sort((a, b) => b[0] - a[0]).map(e => e[1]);
}

// ---------- search ----------

function quiesce(s, alpha, beta, ply, ctx, qd) {
  if ((++ctx.nodes & 1023) === 0 && ctx.canAbort && Date.now() > ctx.deadline) throw ABORT;
  const me = s.turn;
  const stand = evaluate(s, me);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (qd >= 6) return stand;
  for (const mv of orderMoves(s, legalMoves(s, me, true))) {
    const u = makeMove(s, mv);
    const v = -quiesce(s, -beta, -alpha, ply + 1, ctx, qd + 1);
    unmakeMove(s, u);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(s, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 1023) === 0 && ctx.canAbort && Date.now() > ctx.deadline) throw ABORT;
  const me = s.turn;
  if (depth <= 0) return quiesce(s, alpha, beta, ply, ctx, 0);
  const moves = legalMoves(s);
  if (!moves.length) return inCheck(s, me) ? -MATE + ply : 0;
  let best = -Infinity;
  for (const mv of orderMoves(s, moves)) {
    const u = makeMove(s, mv);
    const v = -negamax(s, depth - 1, -beta, -alpha, ply + 1, ctx);
    unmakeMove(s, u);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function searchDuel(s, moves, lv, rand) {
  const ctx = { nodes: 0, deadline: Date.now() + lv.time, canAbort: false };
  let best = moves[0];
  for (let d = 1; d <= lv.depth; d++) {
    ctx.canAbort = d > 1; // depth 1 always completes, so there is always an answer
    try {
      let alpha = -Infinity, pick = null, pickV = -Infinity;
      for (const mv of orderMoves(s, moves, best)) {
        const u = makeMove(s, mv);
        // With noise we need real scores for every move, so search each with a full window.
        const a = lv.noise ? -Infinity : alpha;
        let v = -negamax(s, d - 1, -Infinity, -a, 1, ctx);
        unmakeMove(s, u);
        if (lv.noise && Math.abs(v) < MATE / 2) v += (rand() * 2 - 1) * lv.noise;
        if (v > pickV) { pickV = v; pick = mv; }
        if (v > alpha) alpha = v;
      }
      best = pick;
      if (pickV > MATE / 2) break; // found a forced win
    } catch (e) {
      if (e !== ABORT) throw e;
      break;
    }
    if (Date.now() > ctx.deadline) break;
  }
  return best;
}
