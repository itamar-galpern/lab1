# Space Chess

3D chess among the stars. A gold Solar Fleet faces a teal Nebula Fleet on a floating space-station
deck with two black holes, a wormhole and edges that wrap around. Play a friend on the same screen
or the computer (five levels, Cadet to Overlord).

**Play:** https://itamar-galpern.github.io/lab1/

- **Black holes (c5, f4):** missing squares. Nothing can land on them or fly through them.
- **Wormhole (b3 ↔ g6):** any ship except an Astronaut standing on one end may warp to the other.
- **Orbit:** the a-file and h-file are joined, so ships slide off one side and reappear on the other.
- **Rocket (knight):** jumps in an L, or boosts exactly 2 squares diagonally.

Built with three.js (loaded from a CDN) and plain ES modules, no build step.

- Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
- Tests: `npm test` (Node 20+). From WSL use Windows Node directly:
  `"/mnt/c/Program Files/nodejs/node.exe" --test tests/engine.test.js tests/ai.test.js`
- Add `?debug` to the URL to expose a small `window.spaceChess` hook for automated browser checks.

| File | What it does |
|---|---|
| `js/rules.js` | Board layout, fleets, piece names |
| `js/engine.js` | Move generation (wrap, wormhole, black holes), make/unmake, hashing |
| `js/game.js` | Game controller: results, repetition, undo, move log |
| `js/ai.js`, `js/ai-worker.js` | Alpha-beta search, run in a Web Worker |
| `js/scene.js`, `js/pieces.js` | The three.js world, the 3D ships, animations and effects |
| `js/menu.js`, `js/main.js` | Pixel-art menus, HUD, input and game flow |
| `js/audio.js` | Synthesized sound effects |
