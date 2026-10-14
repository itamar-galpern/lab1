// Game controller: applies moves, tracks history for undo, and decides results
// (checkmate, stalemate and draws).

import { createState, cloneState, legalMoves, makeMove, inCheck, positionKey, sqName } from './engine.js';
import { PIECES } from './space.js';

export class Game {
  constructor(mode) {
    this.mode = mode;
    this.s = createState(mode);
    this.history = [];
    this.log = [];
    this.result = null; // { winner: playerIndex | null, reason }
    this.lastMove = null;
    this.reps = new Map();
    this.countPosition();
  }

  get turn() { return this.s.turn; }

  legal() { return this.result ? [] : legalMoves(this.s); }

  checked() { return !this.result && inCheck(this.s, this.s.turn); }

  countPosition() {
    const k = positionKey(this.s);
    const c = (this.reps.get(k) || 0) + 1;
    this.reps.set(k, c);
    return c;
  }

  // Applies a legal move and returns the undo record (it names the captured piece, if any).
  play(mv) {
    const s = this.s;
    this.history.push({
      s: cloneState(s), logLen: this.log.length, reps: new Map(this.reps),
      result: this.result, lastMove: this.lastMove,
    });
    const mover = s.turn;
    const text = this.describe(mv);
    const u = makeMove(s, mv);
    this.lastMove = mv;
    this.resolveTurn();

    let suffix = '';
    if (this.result && this.result.reason === 'checkmate') suffix = '#';
    else if (!this.result && inCheck(s, s.turn)) suffix = '+';
    this.log.push({ p: mover, text: text + suffix, cap: u.cap ? u.cap.t : null, warp: !!mv.warp });
    return u;
  }

  resolveTurn() {
    const s = this.s;
    if (!legalMoves(s).length) {
      this.result = inCheck(s, s.turn)
        ? { winner: 1 - s.turn, reason: 'checkmate' }
        : { winner: null, reason: 'stalemate' };
    } else if (s.halfmove >= 100) this.result = { winner: null, reason: '50-move rule' };
    else if (this.countPosition() >= 3) this.result = { winner: null, reason: 'threefold repetition' };
    else if (s.board.every(c => !c || c.t === 'K')) this.result = { winner: null, reason: 'only Commanders left' };
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    this.s = h.s;
    this.log.length = h.logLen;
    this.reps = h.reps;
    this.result = h.result;
    this.lastMove = h.lastMove;
    return true;
  }

  // Move text with space names, in plain ASCII for the pixel fonts:
  // "Rocket b1-c3", "Comet c1xh6", "Station b3~g6" (a warp), "Astronaut e7-e8=Flagship".
  describe(mv) {
    const s = this.s, pc = s.board[mv.from];
    if (mv.castle) return Math.abs(mv.castle.from - mv.from) > 3 ? 'Dock O-O-O' : 'Dock O-O';
    const sep = (mv.warp ? '~' : '') + (mv.cap ? 'x' : mv.warp ? '' : '-');
    const promo = mv.promo ? '=' + PIECES[mv.promo].name : '';
    return `${PIECES[pc.t].name} ${sqName(s, mv.from)}${sep}${sqName(s, mv.to)}${promo}`;
  }
}
