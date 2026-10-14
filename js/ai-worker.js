// Runs the AI off the main thread so the board stays responsive while the computer thinks.
import { MODE_BY_ID } from './modes.js';
import { restore } from './engine.js';
import { chooseMove } from './ai.js';

self.onmessage = e => {
  const { token, snap, level } = e.data;
  const mv = chooseMove(restore(snap, MODE_BY_ID[snap.modeId]), level);
  self.postMessage({ token, mv });
};
