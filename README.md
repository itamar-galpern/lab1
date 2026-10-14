# Space Chess

3D chess among the stars. A gold Solar Fleet faces a teal Nebula Fleet on a floating space-station
deck with two black holes, a wormhole and edges that wrap around. Play a friend on the same screen
or the computer (five levels, Cadet to Overlord).

**Play:** https://itamar-galpern.github.io/lab1/

- **Black holes (c5, f4):** missing squares. Nothing can land on them or fly through them.
- **Wormhole (b3 ↔ g6):** any ship except an Astronaut that lands on one end is flung out of the
  other end if it's free; a ship parked on an end can warp across later, capturing what's there.
- **Orbit:** the a-file and h-file are joined, so ships slide off one side and reappear on the other.
- **Rocket (knight):** jumps in an L, or boosts exactly 2 squares diagonally.

Extras: **cosmic events** (every 10 turns a black hole drifts, a new wormhole opens or meteors
block squares), **8 missions** (checkmate puzzles that teach the space rules), a **hint** button,
**blitz clocks**, a slow-motion **checkmate replay** and **15 trophies** saved in your browser.

Built with three.js (loaded from a CDN) and plain ES modules, no build step.

- Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
- Tests: `npm test` (Node 20+). From WSL use Windows Node directly:
  `"/mnt/c/Program Files/nodejs/node.exe" --test tests/engine.test.js tests/ai.test.js tests/missions.test.js`
- Add `?debug` to the URL to expose a small `window.spaceChess` hook for automated browser checks.

| File | What it does |
|---|---|
| `js/rules.js` | Board layout, fleets, piece names |
| `js/engine.js` | Move generation (wrap, wormhole, black holes), make/unmake, hashing |
| `js/game.js` | Game controller: cosmic events, results, repetition, undo, move log |
| `js/ai.js`, `js/ai-worker.js` | Alpha-beta search, run in a Web Worker |
| `js/scene.js`, `js/pieces.js` | The three.js world, the 3D ships, animations and effects |
| `js/missions.js` | The mission puzzles and a forced-mate solver |
| `js/achievements.js` | Trophies and mission progress (localStorage) |
| `js/menu.js`, `js/main.js` | Pixel-art menus, HUD, clocks, hints, input and game flow |
| `js/audio.js` | Synthesized sound effects |
