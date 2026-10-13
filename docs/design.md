# Junkyard Armada — design notes

Working name: **Junkyard Armada** (no existing game by that name found; junkyardarmada.com responds to *something*, so check whois before committing).

## Concept

Online multiplayer, fast-paced, round-based game:

1. **Draft / build.** Players place pentomino pieces (Blokus-style 5-cell shapes) onto their own ship grid against a timer.
2. **Arena combat.** When the timer ends, all ships are dumped into one arena and fight to last ship standing. Hazard idea: a ring of fire that slowly tightens, battle-royale style.
3. **Stats / chat page**, then a new round. Every round starts from scratch; nothing carries over.

### Inspirations
- **Galaxy Trucker**: frantic real-time building is the fun part; its missions are lame, so the goal is a better "after you've built it" phase. Pre-made hull shapes of different sizes.
- **Patchwork**: placing shapes onto an empty grid.
- **Lovers in a Dangerous Spacetime**, **Spacewar!** (1962): combat feel. Simple 2D ships, thrust and inertia, shooting.
- Other combat references: Star Control 2 Super Melee (*The Ur-Quan Masters*), Captain Forever, Reassembly, Cosmoteer, diep.io (ranged vs ramming balance), Starblast.io (web netcode feel).

## Draft

- Each player privately sees **3 piece offers** at a time and takes one.
- The two unused offers go into a **common pool** anyone can claim.
- Timed. Default **2 minutes**; several lengths selectable in the lobby (values TBD).
- Ship space: **pre-made hull layouts of different sizes**, Galaxy Trucker style (exact sizes TBD).

## Pieces and cells

- A piece is a pentomino of 5 **cells**. Most cells are plain hull; a piece may carry one (or more) special cells: engine, laser, grappling hook, ram, mirror, armor.
- **Edge pieces** protect one edge (their `dir`):
  - **Mirror**: neon edge that reflects lasers striking it (beams can bounce back at the shooter).
  - **Armor**: silver plate that deflects collisions on that edge with no damage and a strong bounce.
- Special cells have a facing that rotates with the piece.
- **Damage is per cell**: single cells get destroyed / fall off. A piece is only a placement unit; after placement the ship is just a grid of cells.
- **Covered parts do nothing.** A directional part (engine exhaust, laser, grapple, ram, mirror/armor edge) works only while the straight line from it in that direction has none of its own ship's cells. Shooting away the cover switches it on. Covered parts are drawn dimmed.
- One **core / cockpit** cell per ship. If destroying cells disconnects part of the ship from the core, that part breaks off as debris. Ship dies when the core dies.

## Art

- **Material families:** physical parts (ram, grapple, armor) share bare silver metal; energy parts (laser, mirror) share neon yellow. Engines are hot orange; the core and small trim use the player colour.
- Each cell looks independent for now; long-term each placed piece should look like one cohesive salvaged chunk.

- Theme: junkyard / scrapyard salvage. Crisp pentomino shapes that snap satisfyingly to the grid, with grimy mismatched salvage art.
- Prototype with flat programmer art. The renderer draws per-cell sprites keyed by cell type, so real art can drop in later without architecture changes.

## Combat

- **Movement:** arrow keys. Each direction fires all engines facing the matching way (up fires back-facing engines), in the ship's frame.
- **Physics:** thrust is applied at each engine's actual position, so a lopsided engine layout spins the ship. Ships are only sensible to pilot with weight-symmetric engines, and get weirder as cells fly off. That's intended.
- **Rotation** will be hard with this scheme; dedicated rotation pieces (gyros) are a likely addition.
- **Weapons:** fixed-direction, one key per weapon type. Currently Z = lasers, X = grapple (toggle).
  - lasers (ranged, raycasts)
  - ramming (damage scales with impact)
  - grappling hook (attaches two ships, applies force as it retracts)
  - maybe knockback / recoil
- Players pilot in real time. Not an autobattler.

## Bots

Needed early: simple, human-like, easy bots to play against during development, both for drafting and for flying.

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

## Milestones

1. **Local arena sandbox.** Hard-coded ship layouts, Rapier in the browser, arrow keys fire engines, a dummy target. Tests whether the ships are fun to fly.
2. Networking: move the sim to the server.
3. Draft phase, bots, lobby, stats.
