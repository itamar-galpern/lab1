// Runs the AI search off the main thread so the page stays smooth while the computer thinks.
import { deserialize } from './engine.js';
import { chooseMove } from './ai.js';

self.onmessage = ({ data: { id, state, level } }) => {
  const m = chooseMove(deserialize(state), level);
  self.postMessage({ id, move: m && { from: m.from, to: m.to, promo: m.promo } });
};
