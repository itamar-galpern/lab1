# Space Chess

Chess in orbit: a gold Solar Fleet against a teal Nebula Fleet on a board with two black holes,
a wormhole, and edges that wrap around. Play a friend on the same device or the computer
(five levels, Cadet to Overlord).

**Play:** https://itamar-galpern.github.io/lab1/

- **Black holes (c5, f4):** missing squares. Nothing can land on them or fly through them.
- **Wormhole (b3 ↔ g6):** any ship except an Astronaut standing on one end may warp to the other.
- **Orbit:** the a-file and h-file are joined, so ships slide off one side and reappear on the other.
- **Rocket (knight):** jumps in an L or 2 squares diagonally.

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
Tests: `npm test` (Node 20+).
