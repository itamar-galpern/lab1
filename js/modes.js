// MindGame game modes. Each mode describes its board, players, starting position and rules text.

export const PLAYERS = {
  blue:  { name: 'Blue',  color: '#3b82f6', dark: '#1d4ed8' },
  pink:  { name: 'Pink',  color: '#f472b6', dark: '#be185d' },
  green: { name: 'Green', color: '#34d399', dark: '#047857' },
  gold:  { name: 'Gold',  color: '#fbbf24', dark: '#b45309' },
};

export const GLOBAL_RULES = [
  'Blue plays the classic White role and always moves first; Pink plays the classic Black role.',
  'The MindGame knight: besides the usual L-jump (2 squares then 1), a knight may also jump 2 then 2 — two squares diagonally — leaping over anything in between.',
  'Every other piece moves exactly as in chess. You may never make a move that leaves your own king attacked.',
];

const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

// Two players facing each other: Pink on top (rows 0–1), Blue at the bottom.
function duel(w, h, back) {
  const setup = [];
  back.forEach((t, x) => {
    setup.push({ t, p: 1, x, y: 0 }, { t: 'P', p: 1, x, y: 1 });
    setup.push({ t, p: 0, x, y: h - 1 }, { t: 'P', p: 0, x, y: h - 2 });
  });
  return setup;
}

const DUEL_PLAYERS = [
  { ...PLAYERS.blue, dir: [0, -1] },
  { ...PLAYERS.pink, dir: [0, 1] },
];

const classicBase = {
  w: 8, h: 8,
  players: DUEL_PLAYERS,
  knightPlus: true, castling: true, enPassant: true, doubleStep: true, promoteRank: 7,
  setup: duel(8, 8, BACK),
};

// Four players on a 14x14 cross: Blue bottom, Green left, Pink top, Gold right (clockwise turn order).
function fourKingdomsSetup() {
  const setup = [];
  const a = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const b = ['R', 'N', 'B', 'K', 'Q', 'B', 'N', 'R'];
  for (let k = 0; k < 8; k++) {
    const c = 3 + k;
    setup.push({ t: a[k], p: 0, x: c, y: 13 }, { t: 'P', p: 0, x: c, y: 12 });
    setup.push({ t: b[k], p: 1, x: 0, y: c }, { t: 'P', p: 1, x: 1, y: c });
    setup.push({ t: b[k], p: 2, x: c, y: 0 }, { t: 'P', p: 2, x: c, y: 1 });
    setup.push({ t: a[k], p: 3, x: 13, y: c }, { t: 'P', p: 3, x: 12, y: c });
  }
  return setup;
}

export const MODES = [
  {
    ...classicBase,
    id: 'classic',
    name: 'Classic',
    tagline: 'The game you know — with a bolder knight.',
    rules: [
      'Standard 8×8 board and starting position.',
      'Castling, en passant, two-square pawn first moves and promotion all work as in chess.',
      'Checkmate wins. Stalemate, 50 moves without a capture or pawn move, threefold repetition, or bare kings are draws.',
    ],
  },
  {
    ...classicBase,
    id: 'half',
    name: 'Half Board',
    tagline: 'Half the files, twice the knife fight.',
    w: 4, h: 8,
    castling: false,
    setup: duel(4, 8, ['R', 'Q', 'K', 'N']),
    rules: [
      'A narrow board: 4 files × 8 ranks.',
      'Each side has a Rook, Queen, King and Knight, plus 4 pawns.',
      'No castling. Pawns may still move two squares on their first move, capture en passant and promote on the last rank.',
      'Checkmate wins; draws as in Classic.',
    ],
  },
  {
    ...classicBase,
    id: 'four',
    name: 'Four Kingdoms',
    tagline: 'Four armies, one crown. Free-for-all.',
    w: 14, h: 14,
    holes: (x, y) => (x < 3 || x > 10) && (y < 3 || y > 10),
    players: [
      { ...PLAYERS.blue, dir: [0, -1] },
      { ...PLAYERS.green, dir: [1, 0] },
      { ...PLAYERS.pink, dir: [0, 1] },
      { ...PLAYERS.gold, dir: [-1, 0] },
    ],
    enPassant: false,
    setup: fourKingdomsSetup(),
    rules: [
      'Four players on a 14×14 cross-shaped board, everyone against everyone.',
      'Turn order goes clockwise: Blue → Green → Pink → Gold.',
      'You may not leave your king in check — but a king left under attack after your turn can be captured by any later player. A captured king knocks that player out.',
      'A player with no legal move on their turn (checkmate or stalemate) is out. A knocked-out player’s pieces vanish from the board.',
      'Pawns promote on reaching the 8th rank from their own side (just past the middle). Castling is allowed; there is no en passant.',
      'The last king standing wins.',
    ],
  },
  {
    ...classicBase,
    id: 'hill',
    name: 'King of the Hill',
    tagline: 'March your king to the summit.',
    hill: [27, 28, 35, 36], // d5, e5, d4, e4
    rules: [
      'Classic board, pieces and rules.',
      'The four glowing centre squares are the Hill. Move your king onto the Hill and you win instantly.',
      'Checkmate also wins as usual.',
    ],
  },
  {
    ...classicBase,
    id: 'knightmare',
    name: 'Knightmare',
    tagline: 'Bishops out. Knights everywhere.',
    setup: duel(8, 8, ['R', 'N', 'N', 'Q', 'K', 'N', 'N', 'R']),
    rules: [
      'Classic board, but both bishops are replaced by knights — four MindGame knights per side.',
      'With 2+2 jumps, knights can now cover diagonals too. Watch every square.',
      'All other Classic rules apply.',
    ],
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map(m => [m.id, m]));
