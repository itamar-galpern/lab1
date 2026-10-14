// Space Chess app: boots the 3D scene and the menu, runs games (input, HUD, dialogs) and drives the AI.

import { SIDES, PIECES, isHole, warpTwin, sqName } from './rules.js';
import { Game } from './game.js';
import { LEVELS, chooseMove } from './ai.js';
import { serialize, kingSquare } from './engine.js';
import { initMenu } from './menu.js';
import * as sfx from './audio.js';

const $ = s => document.querySelector(s);
const up = s => s.toUpperCase();
const levelName = id => up(LEVELS.find(l => l.id === id)?.name || id);

let scene = null, portraits = null, menu = null;
let game = null;
let controllers = ['human', 'human']; // per side: 'human' or an AI level id
let viewSide = 0;
let selected = -1, targets = [];
let anim = null;          // promise of the move animation in flight
let thinking = false;
let session = 0;          // bumped on restart / undo / quit so stale async work drops out
let aiToken = 0;
let worker = null;
const pendingAI = new Map();

// ---------- boot ----------

async function boot() {
  try {
    const mod = await import('./scene.js');
    scene = await mod.createScene($('#world'), { onSquareClick, onHover, onFx: name => sfx.play(name) });
    portraits = mod.renderPortraits(160);
  } catch (err) {
    console.error(err);
    $('#boot-err').textContent = 'COULD NOT START THE 3D ENGINE. ' + up(err.message || String(err));
    return;
  }
  menu = initMenu({ portraits, onLaunch: startGame, sfx });
  // The fleets stand ready behind the menu (this also compiles their shaders during loading).
  scene.setBoard(new Game().board());
  $('#boot').classList.add('done');
  setTimeout(() => $('#boot').remove(), 900);
  toMenu(false);
  addEventListener('pointerdown', sfx.unlock, { once: true });
  addEventListener('keydown', sfx.unlock, { once: true });
}

// ---------- screens ----------

function toMenu(fly = true) {
  cancelAI();
  session++;
  game = null;
  selected = -1; targets = [];
  document.body.classList.add('in-menu');
  document.body.classList.remove('in-game');
  $('#hud').classList.add('hidden');
  $('#tip').classList.add('hidden');
  closeDialog();
  scene.setHighlights({});
  scene.setInsets({});
  if (fly) { scene.setBoard(new Game().board()); scene.setMode('menu'); }
  menu.show();
}

async function startGame({ players, side = 0, level = 'captain' }) {
  cancelAI();
  await anim;
  session++;
  controllers = players === 2 ? ['human', 'human'] : side === 0 ? ['human', level] : [level, 'human'];
  viewSide = players === 2 ? 0 : side;
  game = new Game();
  selected = -1; targets = [];
  closeDialog();
  menu.hide();
  document.body.classList.remove('in-menu');
  document.body.classList.add('in-game');
  $('#hud').classList.remove('hidden');
  scene.setBoard(game.board());
  paint();
  renderHud();
  layoutInsets();
  const sess = session;
  await scene.setMode('game', viewSide);
  if (sess !== session) return;
  toast(players === 2 ? 'ENGAGE!' : `${up(SIDES[viewSide].fleet)} · ENGAGE!`, SIDES[viewSide].color);
  maybeAI();
}

function layoutInsets() {
  const panel = $('#hud-panel');
  if (!panel || $('#hud').classList.contains('hidden')) return scene.setInsets({});
  const r = panel.getBoundingClientRect();
  if (innerWidth > 820) scene.setInsets({ right: r.width + 24 });
  else scene.setInsets({ bottom: innerHeight - r.top + 8 });
}
addEventListener('resize', () => { if (game) layoutInsets(); });

// ---------- board input ----------

const isHumanTurn = () => game && !game.result && controllers[game.turn] === 'human';

function onSquareClick(i) {
  if (!isHumanTurn() || anim || thinking) return;
  const options = targets.filter(m => m.to === i);
  if (options.length) {
    if (options.length > 1) choosePromotion(options);
    else doMove(options[0]);
    return;
  }
  const p = game.pieceAt(i);
  if (p && p.side === game.turn && i !== selected) {
    selected = i;
    targets = game.movesFrom(i);
    sfx.play('pick');
  } else {
    selected = -1;
    targets = [];
  }
  paint();
}

function paint() {
  if (!game) return scene.setHighlights({});
  const lm = game.lastMove;
  scene.setHighlights({
    selected,
    targets: targets.map(m => ({ to: m.to, cap: !!m.cap, warp: m.kind === 'warp' })),
    last: lm ? { from: lm.from, to: lm.to } : null,
    check: game.inCheck() ? kingSquare(game.state, game.turn) : -1,
  });
}

function onHover(i, x, y) {
  const tip = $('#tip');
  let text = '';
  if (i >= 0 && game) {
    const p = game.pieceAt(i);
    const name = up(sqName(i));
    if (isHole(i)) text = `<b class="violet">BLACK HOLE</b> ${name}<br>NOTHING CAN ENTER OR CROSS IT`;
    else if (p) {
      text = `<b style="color:${SIDES[p.side].color}">${up(SIDES[p.side].name)} ${up(PIECES[p.type].name)}</b> ${name}`;
      if (warpTwin(i) >= 0 && p.type !== 'P') text += `<br><span class="violet">ON A WORMHOLE · CAN WARP TO ${up(sqName(warpTwin(i)))}</span>`;
    } else if (warpTwin(i) >= 0) text = `<b class="violet">WORMHOLE</b> ${name}<br>LINKED TO ${up(sqName(warpTwin(i)))}`;
  }
  if (!text) return tip.classList.add('hidden');
  tip.innerHTML = text;
  tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, x + 16) + 'px';
  tip.style.top = Math.min(innerHeight - h - 8, y + 18) + 'px';
}

// ---------- moves ----------

async function doMove(mv) {
  const sess = session;
  selected = -1; targets = [];
  const fromX = mv.from % 8;
  const rec = game.play(mv);
  scene.setHighlights({});
  if (mv.kind !== 'warp') sfx.play(mv.piece === 'N' ? 'jump' : 'move');
  renderHud();
  anim = scene.animateMove(mv, game.board());
  await anim;
  anim = null;
  if (sess !== session) return;
  paint();
  renderHud();
  if (rec.mate || game.result?.reason === 'checkmate') toast('CHECKMATE!', '#ff6b5b');
  else if (rec.check) { toast('CHECK!', '#ff6b5b'); sfx.play('check'); }
  else if (mv.promo) toast(`PROMOTED · ${up(PIECES[mv.promo].name)}`, '#ffd34d');
  else if (mv.kind === 'warp') toast('WARP!', '#c69bff');
  else if (mv.kind !== 'castle' && (fromX + mv.vx < 0 || fromX + mv.vx > 7)) toast('ORBIT WRAP!', '#4ff0ff');
  else if (mv.kind === 'castle') toast('DOCKED!', '#ffd34d');
  if (game.result) return endGame();
  maybeAI();
}

function choosePromotion(options) {
  const side = game.turn;
  const d = dialog('PROMOTION', 'YOUR ASTRONAUT BECOMES A...');
  const row = document.createElement('div');
  row.className = 'promo';
  for (const mv of options) {
    const b = document.createElement('button');
    b.className = 'promo-btn';
    b.innerHTML = `<img src="${portraits[side][mv.promo]}" alt=""><span>${up(PIECES[mv.promo].name)}</span>`;
    b.onclick = () => { closeDialog(); doMove(mv); };
    row.append(b);
  }
  d.append(row);
  d.append(actions([['CANCEL', 'red', closeDialog]]));
}

// ---------- AI ----------

function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => { const cb = pendingAI.get(data.id); pendingAI.delete(data.id); cb?.(data.move); };
      worker.onerror = e => {
        console.warn('AI worker failed, thinking on the main thread instead', e);
        worker = false;
        for (const [, cb] of pendingAI) cb(null);
        pendingAI.clear();
      };
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
  renderHud();
  const token = ++aiToken, sess = session, started = performance.now();
  const done = mv => {
    if (token !== aiToken || sess !== session) return;
    if (!mv) mv = chooseMove(game.state, level); // the worker died: think here instead
    const wait = Math.max(0, 700 - (performance.now() - started));
    setTimeout(() => {
      if (token !== aiToken || sess !== session) return;
      thinking = false;
      const legal = game.moves();
      const pick = legal.find(m => m.from === mv?.from && m.to === mv?.to && (m.promo || null) === (mv?.promo || null)) || legal[0];
      if (pick) doMove(pick);
    }, wait);
  };
  const w = getWorker();
  if (w) {
    pendingAI.set(token, done);
    w.postMessage({ id: token, state: serialize(game.state), level });
  } else setTimeout(() => done(chooseMove(game.state, level)), 60);
}

function cancelAI() {
  aiToken++;
  pendingAI.clear();
  thinking = false;
}

// ---------- game over ----------

function endGame() {
  const r = game.result;
  const vsAI = controllers.includes('human') && controllers.some(c => c !== 'human');
  const humanWon = r.winner !== null && controllers[r.winner] === 'human';
  let title, color;
  if (r.winner === null) { title = 'DRAW'; color = '#f3e3c3'; sfx.play('draw'); }
  else if (vsAI) { title = humanWon ? 'VICTORY!' : 'DEFEAT'; color = humanWon ? '#5fd068' : '#ff6b5b'; sfx.play(humanWon ? 'win' : 'lose'); }
  else { title = `${up(SIDES[r.winner].name)} WINS!`; color = SIDES[r.winner].color; sfx.play('win'); }
  scene.celebrate(r.winner);
  renderHud();
  const sess = session;
  setTimeout(() => {
    if (sess !== session) return;
    const who = r.winner === null ? 'NO FLEET PREVAILS' : `THE ${up(SIDES[r.winner].fleet)} WINS BY ${up(r.reason)}`;
    const d = dialog(title, r.winner === null ? up(r.reason) : who, color);
    const n = Math.ceil(game.log.length / 2);
    d.insertAdjacentHTML('beforeend', `<p class="note center">${n} MOVE${n === 1 ? '' : 'S'}</p>`);
    d.append(actions([
      ['VIEW BOARD', 'cream', closeDialog],
      ['MENU', 'red', () => toMenu()],
      ['PLAY AGAIN', 'green', () => startGame(currentSetup())],
    ]));
  }, 1500);
}

function currentSetup() {
  const humans = controllers.filter(c => c === 'human').length;
  if (humans === 2) return { players: 2 };
  const side = controllers[0] === 'human' ? 0 : 1;
  return { players: 1, side, level: controllers[1 - side] };
}

// ---------- HUD ----------

function renderHud() {
  if (!game) return;
  const r = game.result;
  const banner = $('#banner');
  const turn = game.turn, fleet = SIDES[turn];
  const twoHumans = controllers.every(c => c === 'human');
  if (r) {
    banner.innerHTML = r.winner === null
      ? `DRAW · ${up(r.reason)}`
      : `<span style="color:${SIDES[r.winner].color}">${up(SIDES[r.winner].fleet)}</span> WINS · ${up(r.reason)}`;
  } else if (thinking) {
    banner.innerHTML = `<span style="color:${fleet.color}">${up(fleet.fleet)}</span> IS THINKING<i class="dots"></i>`;
  } else {
    const who = twoHumans ? `<span style="color:${fleet.color}">${up(fleet.fleet)}</span> TO MOVE` : `<span style="color:${fleet.color}">YOUR MOVE</span>`;
    banner.innerHTML = who + (game.inCheck() ? ' · <span class="alert">CHECK!</span>' : '');
  }
  banner.classList.toggle('alert-pulse', !r && game.inCheck());

  const material = side => game.captured[side].reduce((s, t) => s + PIECES[t].value, 0);
  $('#fleets').innerHTML = SIDES.map((s, side) => {
    const ctrl = controllers[side] === 'human' ? (twoHumans ? 'HUMAN' : 'YOU') : `CPU · ${levelName(controllers[side])}`;
    const lead = Math.round((material(side) - material(1 - side)) / 100);
    const caps = [...game.captured[side]].sort((a, b) => PIECES[b].value - PIECES[a].value)
      .map(t => `<img src="${portraits[1 - side][t]}" alt="${PIECES[t].name}" title="${PIECES[t].name}">`).join('');
    const active = !r && turn === side;
    return `<div class="fleet${active ? ' active' : ''}" style="--fc:${s.color}">
      <div class="fleet-head"><i class="sw"></i><b>${up(s.name)}</b><span class="ctrl">${ctrl}${active && thinking ? '<i class="dots"></i>' : ''}</span></div>
      <div class="caps">${caps || '<span class="dim">NO CAPTURES YET</span>'}${lead > 0 ? `<span class="lead">+${lead}</span>` : ''}</div>
    </div>`;
  }).join('');

  const log = $('#log');
  log.innerHTML = game.log.map((e, k) =>
    `<li><span class="n">${k % 2 === 0 ? (k / 2 + 1) + '.' : ''}</span><i class="sw" style="background:${SIDES[e.side].color}"></i>${e.text}</li>`).join('');
  log.scrollTop = log.scrollHeight;

  const humanMoved = game.log.some(e => controllers[e.side] === 'human');
  $('#btn-undo').disabled = !humanMoved;
  $('#btn-sound').textContent = sfx.isEnabled() ? 'SOUND ON' : 'SOUND OFF';
}

let toastTimer = 0;
function toast(text, color = '#ffd34d') {
  const t = $('#toast');
  t.textContent = text;
  t.style.color = color;
  t.classList.remove('show');
  void t.offsetWidth; // restart the animation
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
}

// ---------- dialogs ----------

function dialog(title, sub = '', color = '#ffd34d') {
  $('#overlay').classList.remove('hidden');
  const d = $('#dialog');
  d.innerHTML = `<h2 class="dlg-title" style="color:${color}">${title}</h2>${sub ? `<p class="dlg-sub">${sub}</p>` : ''}`;
  return d;
}

function actions(list) {
  const row = document.createElement('div');
  row.className = 'dlg-actions';
  for (const [label, color, fn] of list) {
    const b = document.createElement('button');
    b.className = `pill ${color}`;
    b.textContent = label;
    b.onclick = () => { sfx.play('select'); fn(); };
    row.append(b);
  }
  return row;
}

function closeDialog() { $('#overlay').classList.add('hidden'); }

// ---------- HUD buttons ----------

$('#btn-menu').onclick = () => {
  if (!game || game.result || !game.log.length) return toMenu();
  const d = dialog('ABANDON MISSION?', 'THIS GAME WILL BE LOST.', '#ff6b5b');
  d.append(actions([['STAY', 'cream', closeDialog], ['LEAVE', 'red', () => toMenu()]]));
};

$('#btn-restart').onclick = () => {
  if (!game) return;
  if (game.result || !game.log.length) return startGame(currentSetup());
  const d = dialog('RESTART?', 'START THIS GAME OVER FROM THE BEGINNING.');
  d.append(actions([['NO', 'cream', closeDialog], ['RESTART', 'green', () => startGame(currentSetup())]]));
};

$('#btn-undo').onclick = async () => {
  if (!game) return;
  cancelAI();
  await anim;
  if (!game.log.some(e => controllers[e.side] === 'human')) return;
  session++;
  // Take back moves until it is a human's turn again, with at least one human move undone.
  let undoneHuman = false;
  while (game.canUndo && (!undoneHuman || controllers[game.turn] !== 'human')) {
    const last = game.log[game.log.length - 1];
    if (controllers[last.side] === 'human') undoneHuman = true;
    game.undo();
  }
  selected = -1; targets = [];
  closeDialog();
  scene.setBoard(game.board());
  paint();
  renderHud();
  sfx.play('back');
  maybeAI();
};

$('#btn-view').onclick = () => {
  if (!game) return;
  const twoHumans = controllers.every(c => c === 'human');
  scene.resetView(twoHumans ? game.turn : viewSide);
  sfx.play('nav');
};

$('#btn-sound').onclick = () => {
  sfx.setEnabled(!sfx.isEnabled());
  sfx.play('select');
  renderHud();
};

$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay' && game?.result) closeDialog(); });

addEventListener('keydown', e => {
  if (!game || $('#hud').classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    if (!$('#overlay').classList.contains('hidden')) closeDialog();
    else { selected = -1; targets = []; paint(); }
  }
});

// Test hook for automated browser checks: open the page with ?debug.
if (new URLSearchParams(location.search).has('debug')) {
  window.spaceChess = {
    click: i => onSquareClick(i),
    square: i => scene.project(i),
    // Replace the current game's position (keeps the players): spaceChess.setup('FEN').
    setup(fen) { cancelAI(); session++; game = new Game(fen); selected = -1; targets = []; scene.setBoard(game.board()); paint(); renderHud(); maybeAI(); },
    get game() { return game; },
    get busy() { return !!anim || thinking; },
  };
}

boot();
