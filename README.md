# THE HOLLOW WARD

A first-person co-op horror game for 1–4 players that runs in the browser. You wake up in St. Mercy Psychiatric Hospital at 3:13 AM. Find the 4 fuses, get the generator running again and escape through the gate before *he* catches you.

The game uses no assets and no dependencies. It runs on a custom WebGL2 engine, and every texture, model, map and sound is generated in code.

## Play / deploy

The whole game is one self-contained file: **`dist/index.html`**.

Deploy it to surge.sh from your own computer:

```bash
npm install --global surge      # or use npx
cd hollow-ward
surge dist your-name-hollow-ward.surge.sh
```

The first run asks you to log in. Entering an email and password creates a free surge account.

## Develop

- Run locally: serve this folder with any static server and open `index.html` (it loads `src/main.js` as ES modules).
- Build the single-file release: `node tools/build.mjs` (needs [bun](https://bun.sh)), which writes `dist/index.html`.
- Debug URL flags: `?debug` (no pointer lock, arrow keys to look), `?seed=123`, `?nomonster`, `?dormant=5`, `?net=local` (co-op between tabs in one browser).

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Run (loud) |
| C / Ctrl | Crouch (quiet) |
| F / Right-click | Flashlight |
| E | Interact: doors, items, lockers, generator. Hold E to revive a teammate |
| Space | Hold your breath while hiding in a locker |
| Esc | Pause / release the mouse |

## Co-op

One player clicks **HOST CO-OP** and shares the 5-letter room code or the invite link. Everyone else enters the code and clicks **JOIN**. Connections are peer-to-peer over WebRTC, using the public PeerJS server for matchmaking, so no server of your own is needed. You can turn on proximity voice chat in the lobby.
