// Space Chess trophies and mission progress, saved in this browser (localStorage).
// Storage can be missing (private windows, blocked site data), so every access is guarded.

const KEY = 'spacechess.trophies', MKEY = 'spacechess.missions';

export const TROPHIES = [
  { id: 'first-warp', icon: '🌀', name: 'FIRST WARP', text: 'Send a ship through a wormhole.' },
  { id: 'orbit', icon: '🪐', name: 'ROUND THE WORLD', text: 'Capture a ship by flying round the orbit.' },
  { id: 'boost', icon: '🚀', name: 'ROCKET BOOST', text: "Capture with a Rocket's 2+2 boost." },
  { id: 'promote', icon: '⭐', name: 'FIELD PROMOTION', text: 'Promote an Astronaut.' },
  { id: 'mate-warp', icon: '✨', name: 'MATE THROUGH THE WORMHOLE', text: 'Checkmate with a ship that just used a wormhole.' },
  { id: 'mate-orbit', icon: '💫', name: 'ORBITAL MATE', text: 'Checkmate with a move round the orbit.' },
  { id: 'cosmic', icon: '☄️', name: 'COSMIC SURVIVOR', text: 'Win a game with cosmic events on.' },
  { id: 'blitz', icon: '⚡', name: 'SPEED OF LIGHT', text: 'Win a game against the clock.' },
  { id: 'beat-cadet', icon: '🥉', name: 'CADET DEFEATED', text: 'Beat the computer on Cadet.' },
  { id: 'beat-pilot', icon: '🥈', name: 'PILOT DEFEATED', text: 'Beat the computer on Pilot.' },
  { id: 'beat-captain', icon: '🥇', name: 'CAPTAIN DEFEATED', text: 'Beat the computer on Captain.' },
  { id: 'beat-admiral', icon: '🎖️', name: 'ADMIRAL DEFEATED', text: 'Beat the computer on Admiral.' },
  { id: 'beat-overlord', icon: '👑', name: 'BEAT THE OVERLORD', text: 'Beat the computer on Overlord.' },
  { id: 'first-mission', icon: '🎯', name: 'MISSION ACCOMPLISHED', text: 'Complete a mission.' },
  { id: 'all-missions', icon: '🏆', name: 'MISSION COMMANDER', text: 'Complete every mission.' },
];

function load(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function save(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

export const unlocked = () => load(KEY);

// Returns the trophy if this call unlocked it, or null if it was already unlocked (or unknown).
export function unlock(id) {
  const have = load(KEY);
  const t = TROPHIES.find(x => x.id === id);
  if (!t || have.has(id)) return null;
  have.add(id);
  save(KEY, have);
  return t;
}

export const missionsDone = () => load(MKEY);
export function markMission(id) {
  const done = load(MKEY);
  done.add(id);
  save(MKEY, done);
  return done;
}
