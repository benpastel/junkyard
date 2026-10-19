# Junkyard Armada — design notes

Working name: **Junkyard Armada** (no existing game by that name found; junkyardarmada.com responds to *something*, so check whois before committing).

## Concept

Online multiplayer, fast-paced, round-based game:

1. **Draft / build.** Players place pentomino pieces (Blokus-style 5-cell shapes) onto their own ship grid against a timer.
2. **Arena combat.** When the timer ends, all ships are dumped into one arena (spread well apart) and, after a 3-2-1 countdown over the frozen ships, fight to last ship standing. The arena edge is a **rubber ring** that starts at twice the spawn circle (+ padding) and tightens all the way to nothing over 90s; ships bounce off it unharmed. When ships are jammed together with no slack left, sustained pressure **crushes the touching cells on both ships at once** (an open armor edge or ram facing the contact holds out, unless both sides have one). Cells pressed into the ring itself give way only as a slower fallback. A **power-up orb** sits at the centre at the start, once per fight; grabbing it gives 5s of **mirror skin**: every outer surface of the ship reflects lasers and glows bright yellow (saws, impacts and crushing still hurt).
3. When the fight is decided, the arena keeps running for a few seconds (ring frozen, no damage) while the winner's name flashes over a rain of screws, bolts and nuts.
4. **Stats / chat page**, then a new round. Every round starts from scratch; nothing carries over.

### Inspirations
- **Galaxy Trucker**: frantic real-time building is the fun part; its missions are lame, so the goal is a better "after you've built it" phase. Pre-made hull shapes of different sizes.
- **Patchwork**: placing shapes onto an empty grid.
- **Lovers in a Dangerous Spacetime**, **Spacewar!** (1962): combat feel. Simple 2D ships, thrust and inertia, shooting.
- Other combat references: Star Control 2 Super Melee (*The Ur-Quan Masters*), Captain Forever, Reassembly, Cosmoteer, diep.io (ranged vs ramming balance), Starblast.io (web netcode feel).

## Draft

- Each player privately sees **3 piece offers**. Pick one up and the others stay on offer; switch to another, or put it back (Esc). Placing a piece deals a fresh hand of 5.
- Offers come from an endless bag but only in shapes that fit somewhere on your ship right now. Empty pockets of fewer than 5 squares can never be filled and are hatched dark. Once nothing fits, your ship is full and counts as Done.
- **Reroll** (R / hourglass): throw the hand away; 3 new offers arrive after a 1s wait, so you can't cycle for free.
- The shared pool (unused offers go to a tray anyone can grab) is still in the code but switched off (POOL_ENABLED).
- **Pace** (setup): Frantic / Fast (default) / Strategic / Unlimited (no timer). A Done button in the draft starts the fight early once every connected human has clicked it (in Unlimited, that is the only way it starts). Build time scales with hull tier: small 25/40/60s, medium 35/60/90s, large 50/80/120s.
- **Hulls**, three classes of five, every hull in a class the same number of squares: small (60) Skiff, Hammerhead, Starfish, Catamaran, Chevron; medium (80) Crab, Trident, Flying Wing, Panels, Strike; large (110) Station, Wedge, Manta, Saucer, Dreadnought. Every arm is at least 2 squares wide so pentominoes can reach it.
- The host picks the **class**; each player picks their own hull within it (or Random, which bots always use), and can change it every round.

## Tables

- The **lobby** lists every table with a connected human (players, class, pace, phase); anyone with a name can create one or join any. A table link (`?r=CODE`) still joins directly.
- A table's pre-round phase is **setup** (internal name): pick ships, host sets class / build time / bots, then Launch. Results' **Next round** (host) goes back to setup; **Quit** leaves for the lobby.
- Joining mid-build starts your own ship with whatever time is left; joining mid-fight or on the results lets you watch until the next round.

## Pieces and cells

- A piece is a pentomino of 5 **cells**. Most cells are plain hull; a piece may carry one (or more) special cells: engine, laser, grappling hook, saw, mirror, armor.
- **Edge pieces** protect one edge (their `dir`):
  - **Mirror**: a mirror piece is mirror all over, so its whole outer edge reflects lasers (beams can bounce back at the shooter). A mirror cell reflects off any side a beam can reach; its strips are drawn on every side except those inside the same mirror piece (cells remember which placed piece they came from); where two different mirror pieces meet, the shared edge is drawn once. Buried edges stay visible and start working once uncovered.
  - **Armor**: silver plate that deflects collisions on that edge with no damage and a strong bounce.
  - A shield piece shields the whole face it shows in its direction: every cell with nothing of the piece beyond it that way (a T facing up shields its top bar).
- Each piece carries **1.5 or 2 points** of parts in any combination: laser 1, saw 1, engine ½, mirror coat 1 (all its remaining plain cells become mirror). Parts never overlap each other's overhang squares, every part works on the piece as it stands, and engines on one piece never push opposite ways.
- No part is ever generated blocked by its own piece (same full-line rule as in play).
- Special cells have a facing that rotates with the piece.
- **Damage is per cell**: single cells get destroyed / fall off. A piece is only a placement unit; after placement the ship is just a grid of cells.
- **Covered parts do nothing.** Lasers and grapples work only while the straight line from them to the ship's edge is clear (so they never shoot their own ship). Engines, saws and armor just need the square next to them in their working direction open (a saw also needs its two front diagonals). Saws never cut their own ship. Shooting away the cover switches it on. Covered parts are drawn dimmed.
- The **cockpit** is four core cells laid out like the arrow keys (up on top; left, down, right below), drawn as one dome with a backlit arrow per key that glows while it's held (for other ships: while those engines fire). Lose any part of it and the whole cockpit blows, killing the ship. If destroying cells disconnects part of the ship from the core, that part breaks off as debris. Ship dies when the core dies.

## Art

- **Overhanging parts:** a part sticks out past its square in its working direction (laser barrels, saw blades, engine bells, shield strips), so its silhouette says what it is and which way it points. Ships are drawn in two passes (all plates, then all parts). A part whose overhang would land on another cell is covered, so it does nothing and is drawn faded.
- Engines are drawn firing during the draft (easier to read) and off in the arena until they fire.
- The core is a teardrop canopy pointing forward with swept tail fins in the player colour (so it alone shows which way the ship faces), and a googly-eyed pilot looking forward.
- Each cell looks independent for now; long-term each placed piece should look like one cohesive salvaged chunk.

- Theme: junkyard / scrapyard salvage. Crisp pentomino shapes that snap satisfyingly to the grid, with grimy mismatched salvage art.
- Prototype with flat programmer art. The renderer draws per-cell sprites keyed by cell type, so real art can drop in later without architecture changes.

## Combat

- **Movement:** arrow keys. Each direction fires all engines facing the matching way (up fires back-facing engines), in the ship's frame.
- **Physics:** thrust is applied at each engine's actual position, so a lopsided engine layout spins the ship. Ships are only sensible to pilot with weight-symmetric engines, and get weirder as cells fly off. That's intended.
- **Rotation** will be hard with this scheme; dedicated rotation pieces (gyros) are a likely addition.
- **Weapons:** fixed-direction, one key per weapon type. Lasers fire automatically whenever their line is clear; X = grapple (toggle).
- **Fast-forward:** an F button in the arena; once every connected human in the fight (dead ones too) has voted, the fight runs at 4× until it is decided. Snapshots stay at 20/s, and the client playback clock follows the sim speed.
- **Cockpit arrows** grey out for directions with no working engine; pressing one shows a red X.
- **Camera:** C (or the camera button, which names the current mode) flips between the fixed view and the ship-up view (prototype; remembered per browser). Both show a fading trail behind your ship and a distant dust layer.
- Once every human in the fight is dead, it fast-forwards on its own.
- **Controls bar:** the arena shows each key as a clickable button that lights while held; the draft uses the same buttons for rotate (Q/E), flip (F) and discard (Esc).
  - lasers (ranged, raycasts; auto-firing, one shot every 2.0s, light knockback; range 12 cells, just short of the window edge on a laptop screen)
  - collisions above a speed threshold break one cell on each side
  - **anti-stuck:** cells of two ships that stay touching for 5s explode, on both sides at once, and the blast shoves the two ships apart
  - **saw**: a spinning blade with its own round hitbox past the cell, sitting half on its block (hub on the cell edge), wide enough to reach the tile in front and both tiles diagonally in front; it cuts whatever it touches (one hit every 0.2s, at any speed) and takes no harm from it. Armor facing the blade turns it. It only works with its line and both front diagonals clear.
  - grapple and armor are switched off in the piece mix for now (the parts still work).
  - grappling hook (attaches two ships, applies force as it retracts)
  - maybe knockback / recoil
- **Damage:** parts break after `HITS_TO_BREAK` hits (currently 1: the first hit breaks them; 2 would give one warning crack). A laser shot or an impact above a speed threshold is one hit; an open ram takes none and deals two.
- Players pilot in real time. Not an autobattler.

## Bots

- Skill (setup): **Easy / Medium (default) / Hard**.
  - Building: hard bots take a draft action every 1.5–3s, medium 2.4–4.8s, easy 3.75–7.5s. This is the biggest difficulty lever: slower builders field smaller ships.
  - Flying: easy reacts slowest with the sloppiest aim; medium as before; hard aims steadier, goes after small nearby ships, side-steps enemy laser lines, and fights from the edge of laser range when outgunned.
  - Faster reactions measured worse (the thrust controller over-corrects), so hard thinks as often as medium.
- All bots only charge in to ram with a working saw lined up; otherwise they hold distance (lasers ~8, unarmed ~12) and turn round to retreat if they can't thrust in reverse.

## Architecture

### Constraints
- **Distributed via website only.** "Send a link, friend is in a game in seconds," so load time matters.
- **Vibe-coded.** The LLM writes essentially all the code. When choosing libraries, **LLM legibility / familiarity is the top criterion**. Large volumes of simple, explicit code are fine.
- The owner is an experienced Python/ML engineer and a beginner at JS / frontend / fullstack. Explain frontend or networking concepts when they matter.

### Decisions
- **TypeScript everywhere**, npm workspaces: `shared/` (sim, types, protocol), `server/` (Node, `tsx`), `client/` (Vite + React).
- **Networking:** plain WebSockets (`ws` on the server) with a hand-written typed message protocol. Rooms are a `Map<roomId, Room>` on the server; the room code goes in the URL. No Colyseus.
- **Physics:** Rapier 2D, deterministic build (`@dimforge/rapier2d-deterministic-compat`).
  - Ship = one rigid body with one collider per cell; Rapier computes mass, center of mass, and inertia.
  - Engines apply force at the engine's world position. Grapple = joint, shortened to retract. Ramming damage from contact forces. Lasers = raycasts. Cell destruction removes colliders.
  - The client lazy-loads Rapier during the draft phase (for the local sandbox and later prediction), so it never blocks first load.
- **Draft UI:** React with DOM/SVG elements for snapping and dragging pieces.
- **Arena rendering:** Canvas 2D behind a thin `render(snapshot)` interface. Switch to PixiJS only if effects demand it.
- **Server-authoritative netcode:**
  - Clients send only **inputs** (key states).
  - The server runs physics at a fixed 60Hz timestep and broadcasts state at ~20–30Hz.
  - Clients interpolate between snapshots. No client-side prediction in v1.

### Design around latency
Expect ~50–100ms of input lag. Hide it with game feel:
- Thrust-based, inertia-heavy ships make lag read as "heavy ship."
- Engines have a visible ramp-up animation.
- Lasers charge briefly before firing; the charge time covers the round trip.

### Keep rollback / prediction possible later
- The sim steps at a **fixed timestep** from inputs only.
- Clients send inputs, never positions.
- Sim code has **no rendering, networking, or wall-clock dependencies** and lives in `shared/`.
- No unseeded randomness in the sim. Pass a seeded RNG through state.
- No full rollback or client prediction yet.

## Debugging fights

- The server records every fight to `replays/` (setup + input changes; the sim is deterministic).
- `npx tsx scripts/replay.ts [file | room code] [--quiet]` re-runs one and prints every broken cell with its cause, deaths, and whether the result matches.
- `npx tsx scripts/simulate.ts [rounds] [players] [hull|random] [idle=0|1|mixed]` plays headless bot rounds for tuning.

## Milestones

1. **Local arena sandbox.** Hard-coded ship layouts, Rapier in the browser, arrow keys fire engines, a dummy target. Tests whether the ships are fun to fly.
2. Networking: move the sim to the server.
3. Draft phase, bots, lobby, stats.

## Phones and fullscreen

- Build screen on phones (< 720px wide): status bar (timer, Done, fullscreen), offers (smaller than the board), board, then the buttons at the bottom. A touched piece floats 1.2 squares above the finger. Sized with `100dvh` so the page never scrolls under a drag.
- Fight on touch screens: a big copy of the cockpit's arrow keys bottom left (hold to fire; dead directions grey).
- A compass rose (top right) turns with the view; north is the way your ship faced at the start.
- While building, cockpit arrows with no engine yet carry a red X; hovering a piece that would add one clears it and lights the arrow.
- Camera is ship-up only for now; the fixed-north view is still in the code behind `CAMERA_SWITCHING`.
- Fullscreen: a button (top right of the fight, right column / phone status bar while building). No shortcut key, so it can't be hit by accident; Esc or the back gesture leaves. Hidden where unsupported (iPhone Safari).
