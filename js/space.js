// Space Chess: the one and only mode. Board layout, fleets, pieces and rules text live here.

// Square index from algebraic name ('a8' = 0, 'h1' = 63) on the 8x8 board.
export const sq = name => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

export const SIDES = [
  { name: 'Solar', fleet: 'Solar Fleet', color: '#f5b342', dark: '#a8641a', dir: [0, -1] },
  { name: 'Nebula', fleet: 'Nebula Fleet', color: '#3cc8d0', dark: '#16627a', dir: [0, 1] },
];

export const PIECES = {
  K: { name: 'Commander', classic: 'King', move: 'One square in any direction. Lose your Commander and the battle is lost.' },
  Q: { name: 'Flagship', classic: 'Queen', move: 'Any distance in a straight line or diagonal.' },
  R: { name: 'Station', classic: 'Rook', move: 'Any distance along a file or rank.' },
  B: { name: 'Comet', classic: 'Bishop', move: 'Any distance diagonally.' },
  N: { name: 'Rocket', classic: 'Knight', move: 'Jumps in an L (2+1), or boosts 2 squares diagonally (2+2). Leaps over anything.' },
  P: { name: 'Astronaut', classic: 'Pawn', move: 'Floats one square forward (two on its first move), captures diagonally forward.' },
};

export const BLACK_HOLES = ['c5', 'f4'];
export const WORMHOLES = [['b3', 'g6']];

const VOIDS = new Set(BLACK_HOLES.map(sq));
const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

// Solar at the bottom (rows 6-7), Nebula on top (rows 0-1). The black holes and wormholes are
// point-symmetric (turn the board 180 degrees and they land on themselves), so Nebula's fleet is
// the 180-degree rotation of Solar's: Commander on d8, Flagship on e8. Both fleets then face
// exactly the same board.
function setup() {
  const out = [];
  BACK.forEach((t, x) => {
    out.push({ t, p: 0, x, y: 7 }, { t: 'P', p: 0, x, y: 6 });
    out.push({ t, p: 1, x: 7 - x, y: 0 }, { t: 'P', p: 1, x: 7 - x, y: 1 });
  });
  return out;
}

export const SPACE = {
  id: 'space',
  name: 'Space Chess',
  w: 8, h: 8,
  players: SIDES,
  knightPlus: true, castling: true, enPassant: true, doubleStep: true, promoteRank: 7,
  wrap: true,
  holes: (x, y) => VOIDS.has(y * 8 + x),
  wormholes: WORMHOLES.map(([a, b]) => [sq(a), sq(b)]),
  setup: setup(),
};
