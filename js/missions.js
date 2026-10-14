// Space Chess missions: short checkmate puzzles, each teaching a space rule.
// Solar is to move in every mission, on the standard layout (black holes c5 and f4, wormhole b3-g6).

import { legalMoves, makeMove, unmakeMove, inCheck } from './engine.js';

export const MISSIONS = [
  {
    id: 'm1', title: 'WORMHOLE STRIKE', mateIn: 1,
    fen: '6rk/6nr/8/8/3N4/8/8/4K3 w - - 0 1',
    brief: 'Any ship that lands on a wormhole is flung out of the other end at once. Send your Rocket through the b3 wormhole to checkmate the Commander on h8.',
    hint: 'Jump the Rocket onto b3 and watch where it comes out.',
  },
  {
    id: 'm2', title: 'PARKED AND READY', mateIn: 1,
    fen: '5rkr/5n1n/6b1/8/8/1R6/8/4K3 w - - 0 1',
    brief: 'Your Station is parked on the b3 wormhole. A ship standing on a wormhole can warp to the other end as its move, capturing whatever waits there.',
    hint: 'Warp to g6 and take the Comet.',
  },
  {
    id: 'm3', title: 'ORBIT STRIKE', mateIn: 1,
    fen: 'kn6/pp5p/8/8/8/8/8/3R2K1 w - - 0 1',
    brief: 'The left and right edges are joined, so the corner a8 sits right next to h8. The Rocket on b8 shields its Commander from one side only.',
    hint: 'Fly the Station to the back rank: the check goes the long way round.',
  },
  {
    id: 'm4', title: 'ROCKET BOOST', mateIn: 1,
    fen: 'r6k/b7/8/8/3N4/8/8/3NBK2 w - - 0 1',
    brief: 'Rockets can boost exactly two squares diagonally, leaping over anything. Use a boost to checkmate the Commander on h8.',
    hint: 'Boost from d4 to f6. Your Comet covers g7 round the orbit.',
  },
  {
    id: 'm5', title: 'EVENT HORIZON', mateIn: 1,
    fen: '8/6R1/8/N2R4/8/4kp2/3r4/4K3 w - - 0 1',
    brief: 'The Nebula Commander on e3 would love to escape to f4, but f4 is a black hole and nothing can enter it.',
    hint: 'Check down the e-file with a Station.',
  },
  {
    id: 'm6', title: 'THROUGH THE WORMHOLE', mateIn: 2,
    fen: 'kr6/bp6/8/8/8/8/Q7/1NB1K3 w - - 0 1',
    brief: 'Two space rules in a row: send your Flagship through the wormhole with check, then finish the Commander when it escapes round the orbit.',
    hint: 'Flagship to b3: it comes out on g6, checking a8 round the orbit.',
  },
  {
    id: 'm7', title: 'CLOSING THE ORBIT', mateIn: 2,
    fen: '6nk/7p/2N5/8/8/6Q1/8/7K w - - 0 1',
    brief: 'A quiet first move sets up a mate that flies across the edge of the board. Whatever Nebula does, it is too late.',
    hint: 'Line your Flagship up on c3, then strike along a diagonal that wraps round the orbit.',
  },
  {
    id: 'm8', title: 'GRAND TOUR', mateIn: 2,
    fen: '6nk/p5p1/3B3N/8/8/8/2K5/2N5 w - - 0 1',
    brief: 'The final exam: wormhole, orbit and Rocket boost in one combination.',
    hint: 'Send the c1 Rocket into the b3 wormhole, then boost the other Rocket across the seam.',
  },
];

// Can the side to move force checkmate within n of its own moves? (Brute force, fine for n <= 2.)
export function forcedMate(s, n) {
  return mateMove(s, n) !== null;
}

// A first move that forces checkmate within n moves, or null.
export function mateMove(s, n) {
  for (const m of legalMoves(s)) {
    makeMove(s, m);
    const ok = matedWithin(s, n - 1);
    unmakeMove(s);
    if (ok) return m;
  }
  return null;
}

// The side to move is checkmated now, or every reply still allows a forced mate within n.
function matedWithin(s, n) {
  const replies = legalMoves(s);
  if (!replies.length) return inCheck(s);
  if (n <= 0) return false;
  for (const r of replies) {
    makeMove(s, r);
    const ok = mateMove(s, n) !== null;
    unmakeMove(s);
    if (!ok) return false;
  }
  return true;
}

// The defence that holds out longest: a reply after which the attacker has no forced mate within
// n - 1, if there is one; otherwise any reply. (For the computer's moves in a mission.)
export function defend(s, n) {
  const replies = legalMoves(s);
  for (const r of replies) {
    makeMove(s, r);
    const holds = n <= 1 || mateMove(s, n - 1) === null;
    unmakeMove(s);
    if (holds) return r;
  }
  return replies[0] || null;
}
