# Junkyard Armada — design notes

Working name: **Junkyard Armada** (no existing game by that name found; junkyardarmada.com responds to *something*, so check whois before committing).

## Concept

Online multiplayer, fast-paced, round-based game:

1. **Draft / build.** Players place pentomino pieces (Blokus-style 5-cell shapes) onto their own ship grid against a timer.
2. **Arena combat.** When the timer ends, all ships are dumped into one arena and fight to last ship standing. The arena edge is a **rubber ring** that slowly tightens all the way to nothing; ships bounce off it unharmed. When ships are jammed together with no slack left, sustained pressure **crushes the touching cells on both ships at once** (an open armor edge or ram facing the contact holds out, unless both sides have one). Cells pressed into the ring itself give way only as a slower fallback. A **power-up orb** sits at the centre at the start, once per fight; grabbing it gives 5s of invulnerability (crushing ignores it).
3. **Stats / chat page**, then a new round. Every round starts from scratch; nothing carries over.

### Inspirations
- **Galaxy Trucker**: frantic real-time building is the fun part; its missions are lame, so the goal is a better "after you've built it" phase. Pre-made hull shapes of different sizes.
- **Patchwork**: placing shapes onto an empty grid.
- **Lovers in a Dangerous Spacetime**, **Spacewar!** (1962): combat feel. Simple 2D ships, thrust and inertia, shooting.
- Other combat references: Star Control 2 Super Melee (*The Ur-Quan Masters*), Captain Forever, Reassembly, Cosmoteer, diep.io (ranged vs ramming balance), Starblast.io (web netcode feel).

## Draft

- Each player privately sees **3 piece offers** at a time and takes one.
- The two unused offers go into a **common pool** anyone can claim.
- Timed. Default **1 minute**; 0:30, 0:45, 1:00, 1:30 selectable in the lobby.
- Ship space: **pre-made hull layouts**, Galaxy Trucker style. Hauler is the smallest (50 squares); the rest are bigger and odder, borrowing from real planes and sci-fi: Barge, Flying Wing, Panels, Strike, Wedge, Saucer.

## Pieces and cells

- A piece is a pentomino of 5 **cells**. Most cells are plain hull; a piece may carry one (or more) special cells: engine, laser, grappling hook, ram, mirror, armor.
- **Edge pieces** protect one edge (their `dir`):
  - **Mirror**: neon edge that reflects lasers striking it (beams can bounce back at the shooter).
  - **Armor**: silver plate that deflects collisions on that edge with no damage and a strong bounce.
  - A shield piece shields the whole face it shows in its direction: every cell with nothing of the piece beyond it that way (a T facing up shields its top bar).
- Every piece carries exactly one kind of part; there are no plain-hull pieces.
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
- **Controls bar:** the arena shows each key as a clickable button that lights while held; the draft uses the same buttons for rotate (Q/E), flip (F) and discard (Esc).
  - lasers (ranged, raycasts)
  - ramming (damage scales with impact)
  - grappling hook (attaches two ships, applies force as it retracts)
  - maybe knockback / recoil
- **Damage:** parts break after `HITS_TO_BREAK` hits (currently 1: the first hit breaks them; 2 would give one warning crack). A laser shot or an impact above a speed threshold is one hit; an open ram takes none and deals two.
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

## Debugging fights

- The server records every fight to `replays/` (setup + input changes; the sim is deterministic).
- `npx tsx scripts/replay.ts [file | room code] [--quiet]` re-runs one and prints every broken cell with its cause, deaths, and whether the result matches.
- `npx tsx scripts/simulate.ts [rounds] [players] [hull|random] [idle=0|1|mixed]` plays headless bot rounds for tuning.

## Milestones

1. **Local arena sandbox.** Hard-coded ship layouts, Rapier in the browser, arrow keys fire engines, a dummy target. Tests whether the ships are fun to fly.
2. Networking: move the sim to the server.
3. Draft phase, bots, lobby, stats.
