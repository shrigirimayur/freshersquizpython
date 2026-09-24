# CODE BATTLE 2026

A small strict single-tab quiz prototype with a server-authoritative session registry.

## Run

```powershell
node server.js
```

Open `http://localhost:3000/` for the participant page.

Open `http://localhost:3000/organizer.html` for the private control room. The default local organizer key is `code-battle-organizer`. Set a private key before an event:

```powershell
$env:ORGANIZER_KEY = "your-private-key"
node server.js
```

Students should never be given the organizer URL or key. The server stores sessions in memory for this prototype; production should use a durable store and proper organizer authentication.

## Test-room flow

1. Students open `http://localhost:3000/`, enter their names, and wait. They appear as `ONLINE` in the organizer room.
2. The organizer opens `/organizer.html`, selects the logged-in students, enters the duration in minutes, and clicks `START TEST`.
3. Selected students enter the timed quiz. The server owns the end time; answers are rejected after the timer expires.
4. The organizer can click `STOP TEST` at any time, then reveal results and answers separately.

## Enforcement model

Each answer request carries `participantId`, `sessionId`, and `tabId`. The server verifies all three, checks the heartbeat grace period, rejects duplicate submissions, and never sends correct answers until the organizer reveals them. The browser adds BroadcastChannel detection, heartbeats, reconnection, visibility/focus status, and fullscreen deterrence.

Browser-based applications cannot completely control a participant's computer or forcibly close unrelated browser tabs. CODE BATTLE therefore uses server-side session control, single active quiz-tab enforcement, tab detection, timed sessions and supervised event rules.

For the college event, use one computer per participant, prohibit mobile phones, supervise a computer lab, allow only the quiz website during the competition, and use fullscreen mode if desired.
