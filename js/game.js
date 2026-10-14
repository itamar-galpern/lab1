// Game controller: plays legal moves, keeps the move log and captures, takes moves back,
// runs cosmic events, and decides results (checkmate, stalemate and the draw rules).

import {
  newState, fromFEN, legalMoves, makeMove, unmakeMove, inCheck, pieceAt, step, DIRS,
  features, setVoid, linkWormhole, unlinkWormhole,
} from './engine.js';
import { PIECES, sqName } from './rules.js';

export const EVENT_EVERY = 10;   // a cosmic event fires after every 10th ply
const WORMHOLE_TTL = 12, METEOR_TTL = 6;
const NAME = i => sqName(i).toUpperCase();

export class Game {
  // fen is optional: tests and missions can start from any position.
  // cosmic turns on cosmic events; seed makes them reproducible.
  constructor(fen, { cosmic = false, seed = Math.floor(Math.random() * 2 ** 31) } = {}) {
    this.state = fen ? fromFEN(fen) : newState();
    this.cosmic = cosmic;
    this.seed = seed;
    this.rng = seed | 0;                       // mulberry32 state
    this.temp = { meteors: [], wormholes: [] };   // temporary features: { sq, ttl } and { a, b, ttl }
    this.log = [];              // [{ side, text, move, events }]
    this.captured = [[], []];   // ship types each side has captured
    this.result = null;         // null | { winner: 0 | 1 | null, reason }
    this._moves = null;
    this._snaps = [];           // per ply: the cosmic state before that ply's events (for undo)
  }

  get turn() { return this.state.turn; }
  get canUndo() { return this.log.length > 0; }
  get lastMove() { return this.log.length ? this.log[this.log.length - 1].move : null; }
  get nextEvent() { return this.cosmic ? EVENT_EVERY - (this.log.length % EVENT_EVERY) : null; }

  // The current layout: permanent black holes, temporary meteor blocks and every wormhole.
  // ttl is how many plies a temporary feature has left (null = permanent).
  get features() {
    const f = features(this.state);
    const met = new Map(this.temp.meteors.map(m => [m.sq, m.ttl]));
    return {
      holes: f.voids.filter(i => !met.has(i)),
      meteors: [...met].map(([sq, ttl]) => ({ sq, ttl: Math.max(1, ttl) })),
      wormholes: f.wormholes.map(([a, b]) => {
        const t = this.temp.wormholes.find(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
        return { a, b, ttl: t ? t.ttl : null };
      }),
    };
  }

  moves() {
    if (this.result) return [];
    return this._moves || (this._moves = legalMoves(this.state));
  }

  movesFrom(i) { return this.moves().filter(m => m.from === i); }

  inCheck() { return !this.result && inCheck(this.state); }

  pieceAt(i) { return pieceAt(this.state, i); }

  board() { return Array.from({ length: 64 }, (_, i) => pieceAt(this.state, i)); }

  // Accepts any { from, to, promo } that matches a legal move.
  play(move) {
    const m = this.moves().find(x => x.from === move.from && x.to === move.to && x.promo === (move.promo || null));
    if (!m) throw new Error(`illegal move ${sqName(move.from)}-${sqName(move.to)}`);
    const text = describe(m);
    makeMove(this.state, m);
    this._moves = null;
    if (m.cap) this.captured[m.side].push(m.cap);
    this._snaps.push(this.cosmic ? { rng: this.rng, temp: copyTemp(this.temp) } : null);
    const events = this.cosmic ? this.cosmicTurn(this.log.length + 1) : [];
    this.result = this.judge();
    const check = inCheck(this.state);
    const mate = !!this.result && this.result.reason === 'checkmate';
    const full = text + (mate ? '#' : check ? '+' : '');
    this.log.push({ side: m.side, text: full, move: m, events });
    return { move: m, text: full, check, mate, result: this.result, events };
  }

  // Takes back one ply: its cosmic events first (newest first), then the move.
  undo() {
    if (!this.log.length) return false;
    const { side, move, events } = this.log.pop();
    for (let k = events.length - 1; k >= 0; k--) this.revert(events[k]);
    const snap = this._snaps.pop();
    if (snap) { this.rng = snap.rng; this.temp = snap.temp; }
    unmakeMove(this.state);
    if (move.cap) this.captured[side].pop();
    this.result = null;
    this._moves = null;
    return true;
  }

  judge() {
    const s = this.state;
    this._moves = legalMoves(s);
    if (!this._moves.length) {
      return inCheck(s) ? { winner: s.turn ^ 1, reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
    }
    if (s.halfmove >= 100) return { winner: null, reason: 'fifty-move rule' };
    if (this.repetitions() >= 3) return { winner: null, reason: 'threefold repetition' };
    if (insufficient(s)) return { winner: null, reason: 'insufficient material' };
    return null;
  }

  // How many times the current position has occurred (same side to move, castling rights, ep
  // and layout: voids and wormholes are part of the hash).
  repetitions() {
    const { keys, halfmove } = this.state, last = keys.length - 1;
    let n = 0;
    for (let k = 0; k <= halfmove && k <= last; k += 2) if (keys[last - k] === keys[last]) n++;
    return n;
  }

  // ---------- cosmic events ----------

  // Seeded random number in [0, 1).
  random() {
    let a = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  shuffle(list) {
    const a = list.slice();
    for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(this.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
  }

  // An empty middle square (ranks 3-6) with no wormhole on it, other than the en passant square.
  free(i) {
    const s = this.state, y = i >> 3;
    return y >= 2 && y <= 5 && s.board[i] === 0 && s.twin[i] < 0 && i !== s.ep;
  }

  freeSquares() { return this.shuffle(Array.from({ length: 64 }, (_, i) => i).filter(i => this.free(i))); }

  // Called right after a move (ply = how many plies have been played): temporary features age,
  // expired ones end, and every EVENT_EVERY plies a new random event fires.
  cosmicTurn(ply) {
    const s = this.state, events = [];
    for (const w of this.temp.wormholes) w.ttl--;
    for (const m of this.temp.meteors) m.ttl--;
    for (const w of this.temp.wormholes.filter(w => w.ttl <= 0)) {
      unlinkWormhole(s, w.a);   // ships standing on it just stay
      events.push({ type: 'wormhole-close', a: w.a, b: w.b, text: `The wormhole between ${NAME(w.a)} and ${NAME(w.b)} collapses` });
    }
    this.temp.wormholes = this.temp.wormholes.filter(w => w.ttl > 0);
    // Clearing debris may reopen a line onto the Commander of the fleet that just moved, which
    // would be an illegal position; that debris lingers another ply.
    const cleared = [];
    for (const m of this.temp.meteors.filter(m => m.ttl <= 0)) {
      setVoid(s, m.sq, false);
      if (inCheck(s, s.turn ^ 1)) setVoid(s, m.sq, true);
      else cleared.push(m.sq);
    }
    if (cleared.length) {
      this.temp.meteors = this.temp.meteors.filter(m => !cleared.includes(m.sq));
      events.push({ type: 'meteor-clear', squares: cleared, text: `The meteor debris on ${cleared.map(NAME).join(' and ')} clears` });
    }
    if (ply % EVENT_EVERY === 0) {
      const r = this.random() * 100;
      const order = r < 40 ? ['drift', 'opening', 'meteor'] : r < 70 ? ['opening', 'meteor', 'drift'] : ['meteor', 'drift', 'opening'];
      for (const type of order) {
        const e = this[type]();
        if (e) { events.push(e); break; }
      }
    }
    return events;
  }

  // A black hole drifts to a neighbouring empty square (or anywhere in the middle if it's boxed in).
  // A change may never leave the Commander of the fleet that just moved in check.
  drift() {
    const s = this.state, met = new Set(this.temp.meteors.map(m => m.sq));
    const holes = this.shuffle(features(s).voids.filter(i => !met.has(i)));
    for (const from of holes) {
      const near = this.shuffle(DIRS.map(([dx, dy]) => step(from, dx, dy)).filter(i => i >= 0 && this.free(i)));
      const far = this.freeSquares().filter(i => !near.includes(i));
      for (const to of [...near, ...far]) {
        setVoid(s, from, false);
        setVoid(s, to, true);
        if (!inCheck(s, s.turn ^ 1)) return { type: 'drift', from, to, text: `A black hole drifts from ${NAME(from)} to ${NAME(to)}` };
        setVoid(s, to, false);
        setVoid(s, from, true);
      }
    }
    return null;
  }

  // A second, temporary wormhole opens between two empty middle squares at least 3 steps apart.
  opening() {
    const s = this.state;
    if (features(s).wormholes.length !== 1) return null;
    const cand = this.freeSquares();
    const apart = (a, b) => { const dx = Math.abs((a & 7) - (b & 7)); return Math.min(dx, 8 - dx) + Math.abs((a >> 3) - (b >> 3)) >= 3; };
    for (let x = 0; x < cand.length; x++) {
      for (let y = x + 1; y < cand.length; y++) {
        const a = cand[x], b = cand[y];
        if (!apart(a, b)) continue;
        linkWormhole(s, a, b);
        if (!inCheck(s, s.turn ^ 1)) {
          this.temp.wormholes.push({ a, b, ttl: WORMHOLE_TTL });
          return { type: 'wormhole-open', a, b, ttl: WORMHOLE_TTL, text: `A new wormhole opens between ${NAME(a)} and ${NAME(b)}` };
        }
        unlinkWormhole(s, a);
      }
    }
    return null;
  }

  // A meteor shower blocks two empty middle squares for a few plies (new voids can't expose anyone).
  meteor() {
    const squares = this.freeSquares().slice(0, 2);
    if (squares.length < 2) return null;
    for (const i of squares) { setVoid(this.state, i, true); this.temp.meteors.push({ sq: i, ttl: METEOR_TTL }); }
    return { type: 'meteor', squares, ttl: METEOR_TTL, text: `A meteor shower blocks ${squares.map(NAME).join(' and ')}` };
  }

  // Undoes one event on the board (the temporary-feature lists and RNG come back from the snapshot).
  revert(e) {
    const s = this.state;
    if (e.type === 'drift') { setVoid(s, e.to, false); setVoid(s, e.from, true); }
    else if (e.type === 'wormhole-open') unlinkWormhole(s, e.a);
    else if (e.type === 'wormhole-close') linkWormhole(s, e.a, e.b);
    else if (e.type === 'meteor') for (const i of e.squares) setVoid(s, i, false);
    else if (e.type === 'meteor-clear') for (const i of e.squares) setVoid(s, i, true);
  }
}

const copyTemp = t => ({ meteors: t.meteors.map(m => ({ ...m })), wormholes: t.wormholes.map(w => ({ ...w })) });

// Commanders alone, or a Commander and one Comet or Rocket against a lone Commander.
function insufficient(s) {
  let minors = 0;
  for (let i = 0; i < 64; i++) {
    const p = pieceAt(s, i);
    if (!p || p.type === 'K') continue;
    if (p.type === 'B' || p.type === 'N') minors++;
    else return false;
  }
  return minors <= 1;
}

// Move text with space names, e.g. 'Rocket g1-f3', 'Comet c4xf7', 'Station b3~g6' (a warp),
// 'Rocket d4-b3~g6' (a transit: into the wormhole at b3, out at g6), 'Commander O-O',
// 'Astronaut e7-e8=Flagship'. Check and mate marks are added by play().
export function describe(m) {
  const name = PIECES[m.piece].name;
  if (m.kind === 'castle') return `${name} ${Math.abs(m.rookFrom - m.from) === 3 ? 'O-O' : 'O-O-O'}`;
  const sep = m.kind === 'warp' ? (m.cap ? '~x' : '~') : m.cap ? 'x' : '-';
  const exit = m.transit >= 0 ? '~' + sqName(m.transit) : '';
  return `${name} ${sqName(m.from)}${sep}${sqName(m.to)}${exit}${m.promo ? '=' + PIECES[m.promo].name : ''}`;
}
