# Neon Dash Arena

A fast-paced 2D multiplayer browser arena game built with HTML5 Canvas, vanilla JavaScript, Node.js, Express, and Socket.IO.

Collect glowing crystals, grab power-ups, and outslither up to 5 other snakes — humans or bots — in a neon cyberpunk arena!

## Features

- Real-time multiplayer (up to 6 players per room)
- **Play vs Bots** — instant practice match with up to 5 AI snakes
- **Offline practice fallback** — the game still runs if you open `index.html` without the server
- **Kill feed with streaks** — DOUBLE KILL, TRIPLE KILL, RAMPAGE and UNSTOPPABLE callouts
- Server-authoritative scoring and game state (identical rules on the server and offline)
- Smooth camera following with interpolated remote player movement
- Cyberpunk neon visuals with particles and glow effects
- Animated MT SNAKE FIGHT ARENA welcome screen with a quick start into the existing room menu
- Host-controlled match timer (2 / 5 / 10 / 15 minutes) and bot count
- Live leaderboard, achievements, and persistent best score
- Synthesized Web Audio effects for buttons, crystal/power-up pickups, snake knockouts, respawns, and match results, with a persistent mute toggle
- Responsive mobile/tablet UI with touch controls optimized for landscape play and a portrait-orientation hint
- Responsive UI for desktop, laptop, and tablet

## Requirements

- [Node.js](https://nodejs.org/) v16 or later
- A modern web browser (Chrome, Firefox, Edge, Safari)

## Installation

1. Open a terminal in the project folder:

```bash
cd "color rush arena game"
```

2. Install dependencies:

```bash
npm install
```

## Starting the Server

```bash
npm start
```

You should see:

```
  NEON DASH ARENA server running
  Open http://localhost:3000 in your browser
```

## Playing the Game

1. Open **http://localhost:3000** in your browser.
2. Click **START GAME** on the animated welcome screen.
3. Enter a username (2–16 characters, letters, numbers, spaces, `_`, or `-`).
4. Pick how you want to play:
   - **Play vs Bots** — jumps straight into a match against AI snakes (no second player needed).
   - **Create Room** — opens a lobby; as the host you choose the match timer and how many bots fill the empty slots.
   - **Join Room** — enter a friend's 6-character room code.
5. Use **WASD** or **Arrow Keys** to steer your snake.
6. Collect crystals and power-ups to increase your score.
7. Survive until the timer reaches zero — highest score wins!

Playing without the Node server? Open `public/index.html` directly and the game falls back to
**offline practice** mode: an **OFFLINE PRACTICE** notice appears on the menu and every match is
played against bots.

### Controls

| Action | Desktop |
|--------|---------|
| Move Up | W / ↑ |
| Move Down | S / ↓ |
| Move Left | A / ← |
| Move Right | D / → |
| Mute/Unmute | Click the sound toggle |

On mobile/tablet, use the on-screen D-pad in the bottom-left corner.

## Testing Multiplayer

To test multiplayer locally:

1. Start the server with `npm start`.
2. Open **http://localhost:3000** in your first browser tab.
3. Enter a username (e.g. `Player1`) and click **PLAY**.
4. Open a **second browser tab** (or a different browser) to **http://localhost:3000**.
5. Enter a different username (e.g. `Player2`) and click **PLAY**.
6. Both players will appear in the same arena. Move around in each tab and watch positions sync in real time!

You can open up to 6 tabs for a full room test.

## Project Structure

```
├── server.js          # Node.js + Express + Socket.IO game server
├── package.json       # Dependencies and scripts
├── README.md          # This file
└── public/
    ├── index.html     # Game HTML structure
    ├── style.css      # Neon UI styling
    ├── game-core.js   # Shared rules + GameRoom + offline engine (used by server AND browser)
    ├── audio.js       # Synthesized, muteable Web Audio effects
    ├── ui.js          # Menu, HUD, and overlay management
    └── game.js        # Canvas rendering, input, and multiplayer client
```

## Game Rules

- The host picks the match length: **2, 5, 10 or 15 minutes**, with a **3-second countdown** before start.
- Collect glowing crystals to grow your snake and score energy.
- Head-to-head collisions kill both snakes; head-to-body and head-to-tail collisions kill the attacker.
- Walls, your own body, and other snakes' bodies are fatal.
- Knockouts are announced in the kill feed. Chain kills within **5 seconds** for **DOUBLE KILL**,
  **TRIPLE KILL**, **RAMPAGE** and **UNSTOPPABLE** streaks.
- Dying resets your score and snake length, so every life starts from scratch.
- Achievements appear for streaks and high scores: **ORBIT MASTER**, **SCORE BOOST**, **HIGH SCORER**.
- Your best score is saved locally in the browser (localStorage).

## Troubleshooting

- **Port in use**: Change the port with `PORT=3001 npm start` (or `set PORT=3001 && npm start` on Windows).
- **Can't connect**: Make sure the server is running and you're accessing via `http://localhost:3000`. If the server is unreachable the game automatically switches to offline practice against bots — the **OFFLINE PRACTICE** banner on the menu tells you which mode you are in, and multiplayer needs `npm start`.
- **No sound**: Click a button first (browsers require user interaction for audio). Use the sound toggle to turn effects on or off.

## License

MIT
