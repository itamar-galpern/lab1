// Space Chess UI: main menu, rules, board rendering, input, and driving the AI worker.

import { SPACE, PIECES, BLACK_HOLES, WORMHOLES } from './space.js';
import { Game } from './game.js';
import { LEVELS, chooseMove } from './ai.js';
import { snapshot } from './engine.js';

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const glyph = t => GLYPH[t] + '︎'; // force text (not emoji) rendering

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const pcVars = pl => `--pc:${pl.color};--pd:${pl.dark}`;

let game = null;
let controllers = []; // 'human' or a level id, per player
let selected = -1;
let targets = [];
let aiToken = 0;
let thinking = false;
let rot = 0;
let squares = [];
let worker = null;
let pending = null; // { token, started } for the AI move in flight

// ---------- menu ----------

const RULES = [
  `<b>${SPACE.players[0].fleet}</b> (gold) moves first. <b>${SPACE.players[1].fleet}</b> (teal) moves second.`,
  'Checkmate the enemy Commander to win. You may never leave your own Commander in check.',
  `<b>Black holes</b> (${BLACK_HOLES.join(', ')}): these squares are gone. Nothing can land on them or fly through them.`,
  `<b>Wormhole</b> (${WORMHOLES.map(w => w.join(' ↔ ')).join(', ')}): any ship except an Astronaut standing on one end may warp to the other end as its move, capturing an enemy there. Ships attack through the wormhole too.`,
  '<b>Orbit</b>: the left and right edges of the board are joined. A ship sliding off the a-file comes back on the h-file (and the other way around). Docking (castling) never crosses the edge.',
  'Astronauts reaching the far rank are promoted. Docking and en passant work like in normal chess.',
  'Draws: stalemate, 50 moves without a capture or Astronaut move, threefold repetition, or only Commanders left.',
];

function openRules() {
  const d = dialog();
  d.classList.add('wide');
  const pieces = Object.entries(PIECES).map(([t, pc]) =>
    `<li><span class="g">${glyph(t)}</span> <b>${pc.name}</b> <small>(${pc.classic})</small>: ${pc.move}</li>`).join('');
  d.innerHTML = `<h2>Rules</h2><ul class="rules">${RULES.map(r => `<li>${r}</li>`).join('')}</ul>
    <h3>The fleet</h3><ul class="rules pieces">${pieces}</ul>`;
  const actions = el('div', 'actions');
  const back = el('button', 'primary', 'Back');
  back.onclick = closeDialog;
  actions.append(back);
  d.append(actions);
}

function openPlay() {
  const d = dialog();
  d.innerHTML = '<h2>Play</h2><p>Who are you playing against?</p>';
  const choice = el('div', 'actions stack');
  const ai = el('button', 'primary big', 'vs Computer');
  ai.onclick = openAISetup;
  const human = el('button', 'big', 'vs Human <small>(same device)</small>');
  human.onclick = () => { closeDialog(); startGame(['human', 'human']); };
  const back = el('button', '', 'Back');
  back.onclick = closeDialog;
  choice.append(ai, human, back);
  d.append(choice);
}

function openAISetup() {
  const d = dialog();
  d.innerHTML = '<h2>vs Computer</h2>';
  const sideRow = el('div', 'row');
  sideRow.innerHTML = '<label>Your fleet</label>';
  const side = el('select');
  side.innerHTML = SPACE.players.map((pl, i) => `<option value="${i}">${pl.fleet}${i === 0 ? ' (moves first)' : ''}</option>`).join('');
  sideRow.append(side);
  const lvRow = el('div', 'row');
  lvRow.innerHTML = '<label>Difficulty</label>';
  const level = el('select');
  level.innerHTML = LEVELS.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  level.value = 'captain';
  lvRow.append(level);
  d.append(sideRow, lvRow);
  const actions = el('div', 'actions');
  const back = el('button', '', 'Back');
  back.onclick = openPlay;
  const start = el('button', 'primary', 'Launch');
  start.onclick = () => {
    const ctrls = ['human', 'human'];
    ctrls[1 - +side.value] = level.value;
    closeDialog();
    startGame(ctrls);
  };
  actions.append(back, start);
  d.append(actions);
}

// ---------- dialogs ----------

function dialog() {
  $('#overlay').classList.remove('hidden');
  const d = $('#dialog');
  d.className = 'dialog card';
  d.innerHTML = '';
  return d;
}

function closeDialog() {
  $('#overlay').classList.add('hidden');
}

// ---------- game ----------

function startGame(ctrls) {
  const mode = SPACE;
  cancelAI();
  game = new Game(mode);
  controllers = ctrls;
  selected = -1;
  targets = [];
  // Face the board from the human's side (Nebula sits at the top, so turn it around).
  setRot(ctrls[0] !== 'human' && ctrls[1] === 'human' ? 180 : 0);
  $('#menu').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#game-title').textContent = mode.name;
  buildBoard();
  render();
  maybeAI();
}

function buildBoard() {
  const { mode } = game;
  const board = $('#board');
  board.innerHTML = '';
  board.style.setProperty('--w', mode.w);
  $('#board-wrap').classList.add('rect');
  squares = [];
  for (let y = 0; y < mode.h; y++) {
    for (let x = 0; x < mode.w; x++) {
      const i = y * mode.w + x;
      const sq = el('div', 'sq ' + ((x + y) % 2 ? 'dark' : 'light'));
      if (!game.s.valid[i]) sq.classList.add('hole');
      if (game.s.warp[i] >= 0) sq.classList.add('wormhole');
      if (x === 0) sq.classList.add('seam-l');
      if (x === mode.w - 1) sq.classList.add('seam-r');
      sq.dataset.i = i;
      board.append(sq);
      squares.push(sq);
    }
  }
  fitBoard();
}

// Size squares so the tilted, perspective-projected board fits the stage.
// The projection isn't easy to predict, so measure it and rescale a few times.
function fitBoard() {
  if (!game) return;
  const stage = $('#stage'), wrap = $('#board-wrap');
  const narrow = innerWidth <= 860;
  const availW = stage.clientWidth - 24;
  const availH = narrow ? innerHeight * 0.62 : innerHeight - 110;
  let sq = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sq')) || 60;
  for (let k = 0; k < 4; k++) {
    const r = wrap.getBoundingClientRect();
    const piecesAbove = sq * 1.1; // far-rank pieces stand up above the board edge
    const scale = Math.min(availW / r.width, availH / (r.height + piecesAbove));
    const next = Math.max(20, Math.min(84, Math.floor(sq * scale)));
    if (next === sq) break;
    sq = next;
    document.documentElement.style.setProperty('--sq', sq + 'px');
  }
}

function render() {
  const s = game.s;
  const lm = game.lastMove;
  const checkKing = game.checked() ? s.kings[s.turn] : -1;
  squares.forEach((sq, i) => {
    if (!s.valid[i]) return;
    const c = s.board[i];
    sq.classList.toggle('sel', i === selected);
    sq.classList.toggle('last', !!lm && (i === lm.from || i === lm.to));
    sq.classList.toggle('check', i === checkKing);
    const tgt = targets.find(m => m.to === i);
    sq.classList.toggle('target', !!tgt);
    sq.classList.toggle('capture', !!tgt && !!tgt.cap);
    const key = c ? c.p + c.t : '';
    if (sq.dataset.key !== key) {
      sq.dataset.key = key;
      sq.innerHTML = '';
      if (c) {
        const pl = game.mode.players[c.p];
        sq.append(el('div', 'shadow'));
        const piece = el('div', 'piece', `<span class="g">${glyph(c.t)}</span>`);
        piece.style.cssText = pcVars(pl);
        if (lm && lm.to === i) piece.classList.add('moved');
        sq.append(piece);
      }
    }
  });
  renderPanel();
}

function renderPanel() {
  const s = game.s, mode = game.mode;
  const status = $('#status');
  const r = game.result;
  if (r) {
    status.innerHTML = r.winner === null
      ? `Draw<small>${r.reason}</small>`
      : `<span style="color:${mode.players[r.winner].color}">${mode.players[r.winner].name} wins!</span><small>${r.reason}</small>`;
  } else {
    const pl = mode.players[s.turn];
    const who = controllers[s.turn] === 'human' ? 'to move' : `is thinking<span class="thinking"></span>`;
    status.innerHTML = `<span style="color:${pl.color}">${pl.name}</span> ${who}` +
      (game.checked() ? '<small>Check!</small>' : '<small>&nbsp;</small>');
  }

  $('#player-list').innerHTML = mode.players.map((pl, p) => {
    const ctrl = controllers[p] === 'human' ? 'Human' : 'CPU · ' + LEVELS.find(l => l.id === controllers[p]).name;
    const cls = [!s.alive[p] && 'out', !r && s.turn === p && 'turn'].filter(Boolean).join(' ');
    return `<li class="${cls}" style="${pcVars(pl)}"><span class="sw"></span>${pl.name}<span class="who">${ctrl}</span></li>`;
  }).join('');

  const log = $('#move-log');
  log.innerHTML = game.log.map(e => {
    const pl = mode.players[e.p];
    return `<li style="${pcVars(pl)}"><span class="mv">${pl.name}</span> ${e.text}</li>`;
  }).join('');
  log.scrollTop = log.scrollHeight;

  $('#btn-undo').disabled = thinking || !game.history.length || !controllers.includes('human');
}

function onSquareClick(i) {
  if (!game || game.result || thinking || controllers[game.turn] !== 'human') return;
  const s = game.s;
  const options = targets.filter(m => m.to === i);
  if (options.length) {
    if (options.length > 1) choosePromotion(options);
    else doMove(options[0]);
    return;
  }
  const c = s.board[i];
  if (c && c.p === s.turn && i !== selected) {
    selected = i;
    targets = game.legal().filter(m => m.from === i);
  } else {
    selected = -1;
    targets = [];
  }
  render();
}

function choosePromotion(options) {
  const pl = game.mode.players[game.turn];
  const d = dialog();
  d.innerHTML = '<h2>Promote Astronaut</h2><p>Choose a new ship.</p>';
  const row = el('div', 'promo');
  row.style.cssText = pcVars(pl);
  for (const mv of options) {
    const b = el('button', '', glyph(mv.promo));
    b.title = PIECES[mv.promo].name;
    b.onclick = () => { closeDialog(); doMove(mv); };
    row.append(b);
  }
  d.append(row);
}

function doMove(mv) {
  game.play(mv);
  selected = -1;
  targets = [];
  render();
  if (game.result) setTimeout(showResult, 700);
  else maybeAI();
}

function showResult() {
  const r = game.result, mode = game.mode;
  const d = dialog();
  if (r.winner === null) {
    d.innerHTML = `<div class="winner" style="--pc:#c4b5fd">½</div><h2>Draw</h2><p>${r.reason}</p>`;
  } else {
    const pl = mode.players[r.winner];
    d.innerHTML = `<div class="winner" style="${pcVars(pl)}">${glyph('K')}</div>
      <h2 style="color:${pl.color}">${pl.name} wins!</h2><p>${r.reason}</p>`;
  }
  const actions = el('div', 'actions');
  const view = el('button', '', 'View board');
  view.onclick = closeDialog;
  const menu = el('button', '', 'Menu');
  menu.onclick = () => { closeDialog(); toMenu(); };
  const again = el('button', 'primary', 'Play again');
  again.onclick = () => { closeDialog(); startGame(controllers); };
  actions.append(view, menu, again);
  d.append(actions);
}

// ---------- AI ----------

function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => onAIMove(e.data.token, e.data.mv);
      worker.onerror = () => { worker = false; };
    } catch {
      worker = false;
    }
  }
  return worker;
}

function maybeAI() {
  if (!game || game.result) return;
  const level = controllers[game.turn];
  if (level === 'human') return;
  thinking = true;
  renderPanel();
  const token = ++aiToken;
  const started = Date.now();
  const w = getWorker();
  const send = () => {
    if (w) w.postMessage({ token, snap: snapshot(game.s), level });
    else setTimeout(() => onAIMove(token, chooseMove(game.s, level)), 30);
  };
  pending = { token, started };
  send();
}

function onAIMove(token, mv) {
  if (!pending || token !== pending.token || !game) return;
  // Keep a minimum pause so humans can follow the computer's moves.
  const wait = Math.max(0, 450 - (Date.now() - pending.started));
  setTimeout(() => {
    if (!pending || token !== pending.token) return;
    pending = null;
    thinking = false;
    const legal = game.legal().find(m => m.from === mv.from && m.to === mv.to && m.promo === mv.promo);
    doMove(legal);
  }, wait);
}

function cancelAI() {
  aiToken++;
  pending = null;
  thinking = false;
}

// ---------- controls ----------

function toMenu() {
  cancelAI();
  game = null;
  $('#game').classList.add('hidden');
  $('#menu').classList.remove('hidden');
}

function setRot(deg) {
  rot = deg;
  document.documentElement.style.setProperty('--rot', rot + 'deg');
  setTimeout(fitBoard, 650); // refit once the rotation animation settles
}

$('#board').addEventListener('click', e => {
  const sq = e.target.closest('.sq');
  if (sq) onSquareClick(+sq.dataset.i);
});
$('#btn-menu').onclick = toMenu;
$('#btn-restart').onclick = () => startGame(controllers);
$('#btn-play').onclick = openPlay;
$('#btn-rules').onclick = openRules;
$('#btn-undo').onclick = () => {
  cancelAI();
  // Step back to the most recent position where a human was to move.
  do game.undo(); while (game.history.length && controllers[game.turn] !== 'human');
  selected = -1;
  targets = [];
  render();
  maybeAI();
};
$('#btn-rotl').onclick = () => setRot(rot - 90);
$('#btn-rotr').onclick = () => setRot(rot + 90);
$('#tilt').oninput = e => {
  document.documentElement.style.setProperty('--tilt', e.target.value + 'deg');
  fitBoard();
};
$('#overlay').addEventListener('click', e => {
  if (e.target.id === 'overlay' && (!game || game.result)) closeDialog();
});
addEventListener('resize', fitBoard);
