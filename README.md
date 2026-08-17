# Neon Dash Arena

A fast-paced 2D multiplayer browser arena game built with HTML5 Canvas, vanilla JavaScript, Node.js, Express, and Socket.IO.

Collect glowing energy orbs, dodge moving obstacles, and compete against up to 11 other players in a neon cyberpunk arena!

## Features

- Real-time multiplayer (up to 12 players per room)
- Server-authoritative scoring and game state
- Smooth camera following with interpolated remote player movement
- Cyberpunk neon visuals with particles and glow effects
- Match timer with automatic round restarts
- Live leaderboard, achievements, and persistent best score
- Optional Web Audio sound effects with mute toggle
- Mobile/tablet virtual D-pad controls
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
2. Enter a username (2–16 characters, letters, numbers, spaces, `_`, or `-`).
3. Click **PLAY**.
4. Use **WASD** or **Arrow Keys** to move your glowing character.
5. Collect energy orbs to increase your score.
6. Avoid moving purple obstacles.
7. Survive until the timer reaches zero — highest score wins!

### Controls

| Action | Desktop |
|--------|---------|
| Move Up | W / ↑ |
| Move Down | S / ↓ |
| Move Left | A / ← |
| Move Right | D / → |
| Mute/Unmute | Click 🔊 button |

On mobile/tablet, use the on-screen D-pad in the bottom-left corner.

## Testing Multiplayer

To test multiplayer locally:

1. Start the server with `npm start`.
2. Open **http://localhost:3000** in your first browser tab.
3. Enter a username (e.g. `Player1`) and click **PLAY**.
4. Open a **second browser tab** (or a different browser) to **http://localhost:3000**.
5. Enter a different username (e.g. `Player2`) and click **PLAY**.
6. Both players will appear in the same arena. Move around in each tab and watch positions sync in real time!

You can open up to 12 tabs for a full room test.

## Project Structure

```
├── server.js          # Node.js + Express + Socket.IO game server
├── package.json       # Dependencies and scripts
├── README.md          # This file
└── public/
    ├── index.html     # Game HTML structure
    ├── style.css      # Neon UI styling
    ├── ui.js          # Menu, HUD, and overlay management
    └── game.js        # Canvas rendering, input, and multiplayer client
```

## Game Rules

- Each round lasts **90 seconds** with a **5-second countdown** before start.
- Collecting an orb awards **10 points**.
- After a round ends, results are shown and a new round starts automatically.
- Achievements appear for streaks and high scores: **ORBIT MASTER**, **SCORE BOOST**, **HIGH SCORER**.
- Your best score is saved locally in the browser (localStorage).

## Troubleshooting

- **Port in use**: Change the port with `PORT=3001 npm start` (or `set PORT=3001 && npm start` on Windows).
- **Can't connect**: Make sure the server is running and you're accessing via `http://localhost:3000`, not opening the HTML file directly.
- **No sound**: Click anywhere in the game first (browsers require user interaction for audio). Use the mute button to toggle sound.

## License

MIT
