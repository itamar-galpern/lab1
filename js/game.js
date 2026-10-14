// Game controller: plays legal moves, keeps the move log and captures, takes moves back,
// and decides results (checkmate, stalemate and the draw rules).

import { newState, fromFEN, legalMoves, makeMove, unmakeMove, inCheck, pieceAt } from './engine.js';
import { PIECES, sqName } from './rules.js';

export class Game {
  // fen is optional: tests and puzzles can start from any position.
  constructor(fen) {
    this.state = fen ? fromFEN(fen) : newState();
    this.log = [];              // [{ side, text, move }]
    this.captured = [[], []];   // ship types each side has captured
    this.result = null;         // null | { winner: 0 | 1 | null, reason }
    this._moves = null;
  }

  get turn() { return this.state.turn; }
  get canUndo() { return this.log.length > 0; }
  get lastMove() { return this.log.length ? this.log[this.log.length - 1].move : null; }

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
    this.result = this.judge();
    const check = inCheck(this.state);
    const mate = !!this.result && this.result.reason === 'checkmate';
    const full = text + (mate ? '#' : check ? '+' : '');
    this.log.push({ side: m.side, text: full, move: m });
    return { move: m, text: full, check, mate, result: this.result };
  }

  undo() {
    if (!this.log.length) return false;
    const { side, move } = this.log.pop();
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

  // How many times the current position has occurred (same side to move, castling rights and ep).
  repetitions() {
    const { keys, halfmove } = this.state, last = keys.length - 1;
    let n = 0;
    for (let k = 0; k <= halfmove && k <= last; k += 2) if (keys[last - k] === keys[last]) n++;
    return n;
  }
}

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
// 'Commander O-O', 'Astronaut e7-e8=Flagship'. Check and mate marks are added by play().
export function describe(m) {
  const name = PIECES[m.piece].name;
  if (m.kind === 'castle') return `${name} ${Math.abs(m.rookFrom - m.from) === 3 ? 'O-O' : 'O-O-O'}`;
  const sep = m.kind === 'warp' ? (m.cap ? '~x' : '~') : m.cap ? 'x' : '-';
  return `${name} ${sqName(m.from)}${sep}${sqName(m.to)}${m.promo ? '=' + PIECES[m.promo].name : ''}`;
}
