// Space Chess: the board, the two fleets and the names of their ships.
//
// Squares are indexed i = y * 8 + x. x = 0 is the a-file, y = 0 is rank 8 (the top of the screen),
// so a8 = 0, h8 = 7, a1 = 56, h1 = 63. Solar (side 0) starts at the bottom and moves first;
// Nebula (side 1) starts at the top.

export const N = 8;
export const FILES = 'abcdefgh';

export const sq = name => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
export const sqName = i => FILES[i & 7] + (8 - (i >> 3));
export const xy = i => [i & 7, i >> 3];

export const SIDES = [
  { name: 'Solar', fleet: 'Solar Fleet', color: '#f5b342' },
  { name: 'Nebula', fleet: 'Nebula Fleet', color: '#3cc8d0' },
];

export const PIECES = {
  K: { name: 'Commander', classic: 'King', value: 0, move: 'Moves one square in any direction. Checkmate the enemy Commander to win.' },
  Q: { name: 'Flagship', classic: 'Queen', value: 900, move: 'Flies any distance in a straight line or diagonal.' },
  R: { name: 'Station', classic: 'Rook', value: 500, move: 'Flies any distance along a rank or a file.' },
  B: { name: 'Comet', classic: 'Bishop', value: 330, move: 'Flies any distance diagonally.' },
  N: { name: 'Rocket', classic: 'Knight', value: 320, move: 'Jumps in an L (2+1) or boosts 2 squares diagonally (2+2), leaping over anything.' },
  P: { name: 'Astronaut', classic: 'Pawn', value: 100, move: 'Floats one square forward (two from its start), captures one square diagonally forward, and is promoted on the far rank.' },
};

// Black holes are squares that don't exist. The wormhole links two squares.
// Both are point-symmetric (turning the board 180 degrees maps them onto themselves),
// so the two fleets face exactly the same board.
export const BLACK_HOLES = [26, 37];   // c5, f4
export const WORMHOLES = [[41, 22]];   // b3 <-> g6

const HOLE = new Uint8Array(64);
for (const i of BLACK_HOLES) HOLE[i] = 1;
const TWIN = new Int8Array(64).fill(-1);
for (const [a, b] of WORMHOLES) { TWIN[a] = b; TWIN[b] = a; }

export const isHole = i => HOLE[i] === 1;
export const warpTwin = i => TWIN[i];

// Solar's back rank is the classic one; Nebula's fleet is its 180-degree rotation
// (square i becomes 63 - i), so Nebula's Commander starts on d8 and its Flagship on e8.
const BACK = 'RNBQKBNR';
const SOLAR = [];
for (let x = 0; x < 8; x++) SOLAR.push({ type: BACK[x], side: 0, sq: 56 + x });
for (let x = 0; x < 8; x++) SOLAR.push({ type: 'P', side: 0, sq: 48 + x });
export const START = [...SOLAR, ...SOLAR.map(p => ({ type: p.type, side: 1, sq: 63 - p.sq }))];
