// MindGame UI: menu, setup, 3D board rendering, input, and driving the AI worker.

import { MODES, GLOBAL_RULES } from './modes.js';
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

function renderMenu() {
  $('#global-rules').innerHTML = GLOBAL_RULES.map(r => `<li>${r}</li>`).join('');
  const box = $('#mode-cards');
  box.innerHTML = '';
  for (const mode of MODES) {
    const card = el('article', 'mode card');
    const dots = mode.players.map(p => `<i style="background:${p.color}"></i>`).join('');
    card.innerHTML = `
      <h3>${mode.name}</h3>
      <div class="tag">${mode.tagline}</div>
      <div class="chips">
        <span class="chip"><span class="dots">${dots}</span> ${mode.players.length} players</span>
        <span class="chip">${mode.w}×${mode.h} board</span>
      </div>
      <ul>${mode.rules.map(r => `<li>${r}</li>`).join('')}</ul>`;
    const btn = el('button', 'primary', 'Play ' + mode.name);
    btn.onclick = () => openSetup(mode);
    card.append(btn);
    box.append(card);
  }
}

function openSetup(mode) {
  const d = dialog();
  d.innerHTML = `<h2>${mode.name}</h2><p>Who controls each army?</p>`;
  const options = [['human', 'Human'], ...LEVELS.map(l => [l.id, `Computer — ${l.name}`])];
  const selects = mode.players.map((pl, i) => {
    const row = el('div', 'row');
    row.innerHTML = `<span class="sw" style="background:${pl.color}"></span><label>${pl.name}</label>`;
    const sel = el('select');
    sel.innerHTML = options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    sel.value = i === 0 ? 'human' : 'medium';
    row.append(sel);
    d.append(row);
    return sel;
  });
  const actions = el('div', 'actions');
  const cancel = el('button', '', 'Back');
  cancel.onclick = closeDialog;
  const start = el('button', 'primary', 'Start game');
  start.onclick = () => {
    closeDialog();
    startGame(mode, selects.map(s => s.value));
  };
  actions.append(cancel, start);
  d.append(actions);
}

// ---------- dialogs ----------

function dialog() {
  $('#overlay').classList.remove('hidden');
  const d = $('#dialog');
  d.innerHTML = '';
  return d;
}

function closeDialog() {
  $('#overlay').classList.add('hidden');
}

// ---------- game ----------

function startGame(mode, ctrls) {
  cancelAI();
  game = new Game(mode);
  controllers = ctrls;
  selected = -1;
  targets = [];
  setRot(0);
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
  $('#board-wrap').classList.toggle('rect', !mode.holes);
  squares = [];
  for (let y = 0; y < mode.h; y++) {
    for (let x = 0; x < mode.w; x++) {
      const i = y * mode.w + x;
      const sq = el('div', 'sq ' + ((x + y) % 2 ? 'dark' : 'light'));
      if (!game.s.valid[i]) sq.classList.add('hole');
      if (mode.hill && mode.hill.includes(i)) sq.classList.add('hill');
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
    const notes = e.notes.map(n => `<span class="note">${n.text}</span>`).join('');
    return `<li style="${pcVars(pl)}"><span class="mv">${pl.name}</span> ${e.text}${notes}</li>`;
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
  d.innerHTML = '<h2>Promote pawn</h2><p>Choose a new piece.</p>';
  const row = el('div', 'promo');
  row.style.cssText = pcVars(pl);
  for (const mv of options) {
    const b = el('button', '', glyph(mv.promo));
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
  again.onclick = () => { closeDialog(); startGame(mode, controllers); };
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
$('#btn-restart').onclick = () => startGame(game.mode, controllers);
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
  if (e.target.id === 'overlay' && game && game.result) closeDialog();
});
addEventListener('resize', fitBoard);

renderMenu();
