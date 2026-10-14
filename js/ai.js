// MindGame computer opponents.
// Two-player modes use iterative-deepening alpha-beta (negamax + quiescence).
// Four Kingdoms uses a shallow threat-aware search: look at my move, then at what the others can grab back.

import {
  VALUE, cloneState, legalMoves, pseudoMoves, makeMove, unmakeMove, inCheck, attackedBy, relRank,
} from './engine.js';

export const LEVELS = [
  { id: 'novice', name: 'Novice', depth: 1, noise: 350, time: 400 },
  { id: 'easy',   name: 'Easy',   depth: 1, noise: 80,  time: 600 },
  { id: 'medium', name: 'Medium', depth: 2, noise: 25,  time: 1500 },
  { id: 'hard',   name: 'Hard',   depth: 3, noise: 0,   time: 2500 },
  { id: 'master', name: 'Master', depth: 6, noise: 0,   time: 3500 },
];

const MATE = 1e6;
const ABORT = Symbol('abort');

export function chooseMove(s0, levelId, rand = Math.random) {
  const lv = LEVELS.find(l => l.id === levelId) || LEVELS[2];
  const s = cloneState(s0);
  const moves = legalMoves(s);
  if (moves.length <= 1) return moves[0] || null;
  return s.n === 2 ? searchDuel(s, moves, lv, rand) : searchMulti(s, moves, lv, rand);
}

// ---------- evaluation ----------

function pieceScore(s, c, i) {
  const x = i % s.w, y = (i - x) / s.w;
  const cx = (s.w - 1) / 2, cy = (s.h - 1) / 2;
  const centre = Math.max(0, 6 - (Math.abs(x - cx) + Math.abs(y - cy)));
  let v = VALUE[c.t];
  switch (c.t) {
    case 'N': v += centre * 6; break;
    case 'B': v += centre * 4; break;
    case 'Q': v += centre * 2; break;
    case 'R': v += centre; break;
    case 'P': v += relRank(s, c.p, x, y) * 8 + centre * 2; break;
    case 'K': v += s.mode.hill ? centre * 30 : -centre * 3; break;
  }
  return v;
}

function totals(s) {
  const t = new Array(s.n).fill(0);
  s.board.forEach((c, i) => { if (c) t[c.p] += pieceScore(s, c, i); });
  return t;
}

// Score from player p's point of view: own material minus the average opponent.
function evaluate(s, p) {
  const t = totals(s);
  let others = 0, k = 0;
  for (let q = 0; q < s.n; q++) {
    if (q === p || !s.alive[q] || s.kings[q] < 0) continue;
    others += t[q]; k++;
  }
  return t[p] - (k ? others / k : 0);
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

// ---------- two-player search ----------

function onHill(s, p) {
  return s.mode.hill && s.mode.hill.includes(s.kings[p]);
}

function quiesce(s, alpha, beta, ply, ctx, qd) {
  if ((++ctx.nodes & 1023) === 0 && ctx.canAbort && Date.now() > ctx.deadline) throw ABORT;
  const me = s.turn;
  if (onHill(s, 1 - me)) return -MATE + ply;
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
  if (onHill(s, 1 - me)) return -MATE + ply;
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

// ---------- multiplayer search ----------

// The most player q could win by capturing one of `me`'s pieces right now.
function worstGrab(s, q, me) {
  let worst = 0;
  for (const c of pseudoMoves(s, q, true)) {
    const victim = s.board[c.epCap ?? c.to];
    if (victim.p !== me) continue;
    if (victim.t === 'K') return 1e5;
    const attacker = s.board[c.from];
    const defended = attackedBy(s, c.to, o => o === me);
    worst = Math.max(worst, VALUE[victim.t] - (defended ? VALUE[attacker.t] : 0));
  }
  return worst;
}

function searchMulti(s, moves, lv, rand) {
  const me = s.turn;
  let best = moves[0], bestV = -Infinity;
  for (const mv of moves) {
    const victim = mv.cap ? s.board[mv.epCap ?? mv.to] : null;
    const u = makeMove(s, mv);
    let v = evaluate(s, me);
    if (victim && victim.t === 'K') v += 1e5;
    if (lv.depth >= 2) {
      for (let q = 0; q < s.n; q++) {
        if (q === me || !s.alive[q] || s.kings[q] < 0) continue;
        const weight = q === s.turn ? 1 : lv.depth >= 3 ? 0.6 : 0;
        if (weight) v -= weight * worstGrab(s, q, me);
      }
      // Reward checkmating the next player (they'd be knocked out).
      if (lv.depth >= 3 && inCheck(s, s.turn) && !legalMoves(s).length) v += 5000;
    }
    unmakeMove(s, u);
    v += (rand() * 2 - 1) * lv.noise;
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}
