# CODE BATTLE 2026

Server-authoritative single-tab quiz platform with separate participant and organizer pages.

## Run locally

```powershell
node server.js
```

Participant page: <http://localhost:3000/>

Organizer page: <http://localhost:3000/organizer.html>

Default local organizer key: `code-battle-organizer`

For an event, set a private key before starting the server:

```powershell
$env:ORGANIZER_KEY = "your-private-key"
node server.js
```

## Test flow

1. Students open the participant page and enter their names.
2. The organizer sees logged-in students as `ONLINE`.
3. The organizer selects students and chooses the duration.
4. `START TEST` begins the server-controlled timer.
5. Students answer one question at a time using the question map.
6. `STOP TEST` ends the room. Results and answers are revealed separately.

## Security model

Each answer includes `participantId`, `sessionId`, and `tabId`. The server verifies the active tab, heartbeat, session, participant name, competition state, duplicate submissions, and timer. Correct answers are not sent to participants until the organizer reveals them.

The browser also uses BroadcastChannel detection, reconnection, heartbeat status, and optional fullscreen deterrence. Browsers cannot forcibly close unrelated tabs, so use one computer per participant and supervise the room.

## Deployment

GitHub Pages only displays static files and cannot run `server.js` or the `/api/*` endpoints. Deploy this project to a Node-compatible host such as Render using [render.yaml](render.yaml), then set `ORGANIZER_KEY` as a private environment variable.

Repositories:

- <https://github.com/shrigirimayur/freshersquizpython>
- <https://github.com/shrigirimayur/freshersquizpythonorganization>
