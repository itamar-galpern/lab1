// Game controller: applies moves, tracks history for undo, and decides results
// (checkmate, stalemate, draws, King of the Hill, Four Kingdoms eliminations).

import {
  createState, cloneState, legalMoves, makeMove, inCheck, nextAlive, positionKey, sqName,
} from './engine.js';

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

  aliveCount() { return this.s.alive.filter(Boolean).length; }

  countPosition() {
    const k = positionKey(this.s);
    const c = (this.reps.get(k) || 0) + 1;
    this.reps.set(k, c);
    return c;
  }

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
    const notes = [];

    if (u.cap && u.cap.t === 'K') this.eliminate(u.cap.p, notes, 'lost their king');

    if (!this.result && this.mode.hill && u.pc.t === 'K' && this.mode.hill.includes(mv.to)) {
      this.result = { winner: mover, reason: 'reached the Hill' };
    }
    if (!this.result) this.resolveTurn(notes);

    let suffix = '';
    if (this.result && this.result.winner === mover && this.result.reason === 'checkmate') suffix = '#';
    else if (!this.result && inCheck(s, s.turn)) suffix = '+';
    this.log.push({ p: mover, text: text + suffix, notes });
    return notes;
  }

  // Finds the next player who can move, knocking out stuck players in multiplayer.
  resolveTurn(notes) {
    const s = this.s;
    for (;;) {
      if (this.aliveCount() === 1) {
        this.result = { winner: s.alive.indexOf(true), reason: 'last king standing' };
        return;
      }
      if (legalMoves(s).length) break;
      const check = inCheck(s, s.turn);
      if (s.n === 2) {
        this.result = check
          ? { winner: 1 - s.turn, reason: 'checkmate' }
          : { winner: null, reason: 'stalemate' };
        return;
      }
      this.eliminate(s.turn, notes, check ? 'was checkmated' : 'was stalemated');
    }
    const limit = s.n === 2 ? 100 : 200;
    if (s.halfmove >= limit) this.result = { winner: null, reason: `${limit / 2}-move rule` };
    else if (this.countPosition() >= 3) this.result = { winner: null, reason: 'threefold repetition' };
    else if (s.board.every(c => !c || c.t === 'K')) this.result = { winner: null, reason: 'only kings left' };
  }

  eliminate(p, notes, why) {
    const s = this.s;
    s.alive[p] = false;
    s.kings[p] = -1;
    s.board.forEach((c, i) => { if (c && c.p === p) s.board[i] = null; });
    if (s.turn === p) s.turn = nextAlive(s, p);
    notes.push({ p, text: `${this.mode.players[p].name} ${why} and is out!` });
    if (this.aliveCount() === 1) {
      this.result = { winner: s.alive.indexOf(true), reason: 'last king standing' };
    }
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

  describe(mv) {
    const s = this.s, pc = s.board[mv.from];
    if (mv.castle) {
      const dist = Math.abs(mv.castle.from - mv.from) % s.w || Math.abs(mv.castle.from - mv.from) / s.w;
      return dist > 3 ? 'O-O-O' : 'O-O';
    }
    const letter = pc.t === 'P' ? '' : pc.t;
    return `${letter}${sqName(s, mv.from)}${mv.cap ? '×' : '–'}${sqName(s, mv.to)}${mv.promo ? '=' + mv.promo : ''}`;
  }
}
