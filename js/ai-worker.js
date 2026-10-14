// Runs the AI search off the main thread so the page stays responsive.
import { restore } from './engine.js';
import { chooseMove } from './ai.js';
import { SPACE } from './space.js';

self.onmessage = e => {
  const { token, snap, level } = e.data;
  const mv = chooseMove(restore(snap, SPACE), level);
  self.postMessage({ token, mv });
};
