const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const HEARTBEAT_GRACE_MS = 18_000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const TOTAL_SCORE = 50;
const ORGANIZER_KEY = process.env.ORGANIZER_KEY || "code-battle-organizer";
const DEFAULT_ORGANIZER_KEY = "code-battle-organizer";

const defaultQuestions = [
  {
    id: 1,
    prompt: "Which HTTP status means “Too Many Requests”?",
    options: ["301", "404", "429", "503"],
    correct: 2,
    explanation:
      "429 tells a client it has sent too many requests in a given time.",
  },
  {
    id: 2,
    prompt: "What does CSS stand for?",
    options: [
      "Cascading Style Sheets",
      "Computer Style Syntax",
      "Creative Sheet System",
      "Colorful Style Sheets",
    ],
    correct: 0,
    explanation: "CSS is Cascading Style Sheets.",
  },
  {
    id: 3,
    prompt: "Which data structure uses FIFO ordering?",
    options: ["Stack", "Queue", "Tree", "Graph"],
    correct: 1,
    explanation: "A queue removes the item that has waited longest.",
  },
  {
    id: 4,
    prompt: "What is the default port for HTTPS?",
    options: ["80", "21", "443", "8080"],
    correct: 2,
    explanation: "HTTPS conventionally uses TCP port 443.",
  },
  {
    id: 5,
    prompt: "Which keyword declares a constant in JavaScript?",
    options: ["fixed", "let", "const", "static"],
    correct: 2,
    explanation: "const creates a binding that cannot be reassigned.",
  },
  {
    id: 6,
    prompt: "Which protocol is used for secure browser connections?",
    options: ["FTP", "HTTPS", "SMTP", "SSH"],
    correct: 1,
    explanation: "HTTPS is HTTP layered over TLS.",
  },
  {
    id: 7,
    prompt: "What does JSON stand for?",
    options: [
      "JavaScript Object Notation",
      "Joined System Object Network",
      "Java Source Open Nodes",
      "JavaScript Oriented Names",
    ],
    correct: 0,
    explanation: "JSON means JavaScript Object Notation.",
  },
  {
    id: 8,
    prompt: "Which Git command creates a new branch?",
    options: ["git fork", "git branch", "git split", "git clone"],
    correct: 1,
    explanation: "git branch creates or lists branches.",
  },
  {
    id: 9,
    prompt: "Which layer handles IP routing?",
    options: ["Application", "Transport", "Network", "Presentation"],
    correct: 2,
    explanation: "The network layer handles logical addressing and routing.",
  },
  {
    id: 10,
    prompt: "What does REST commonly describe?",
    options: [
      "A database engine",
      "An API architectural style",
      "A CSS framework",
      "A testing language",
    ],
    correct: 1,
    explanation: "REST is an architectural style for networked applications.",
  },
  {
    id: 11,
    prompt: "Which value is falsy in JavaScript?",
    options: ["[]", "{}", '"0"', "0"],
    correct: 3,
    explanation:
      "The number 0 is falsy; arrays, objects, and non-empty strings are truthy.",
  },
  {
    id: 12,
    prompt: "What is the purpose of a database index?",
    options: [
      "Encrypt rows",
      "Speed up lookups",
      "Delete duplicates",
      "Create backups",
    ],
    correct: 1,
    explanation: "Indexes accelerate reads by organizing lookup paths.",
  },
  {
    id: 13,
    prompt: "Which HTTP method is conventionally idempotent for replacement?",
    options: ["POST", "PATCH", "PUT", "CONNECT"],
    correct: 2,
    explanation:
      "PUT replaces a resource and repeating it has the same intended effect.",
  },
  {
    id: 14,
    prompt: "What does DNS translate?",
    options: [
      "Ports to protocols",
      "Names to IP addresses",
      "HTML to CSS",
      "Users to roles",
    ],
    correct: 1,
    explanation: "DNS resolves domain names to network addresses.",
  },
  {
    id: 15,
    prompt: "Which is a symmetric encryption algorithm?",
    options: ["AES", "RSA", "DSA", "ECDSA"],
    correct: 0,
    explanation: "AES uses the same secret key to encrypt and decrypt.",
  },
  {
    id: 16,
    prompt: "What does a 2xx HTTP response indicate?",
    options: ["Redirect", "Client error", "Success", "Server error"],
    correct: 2,
    explanation: "The 2xx class indicates successful processing.",
  },
  {
    id: 17,
    prompt: "Which tool packages applications into isolated units?",
    options: ["Docker", "Figma", "Postman", "Vite"],
    correct: 0,
    explanation: "Docker packages applications into containers.",
  },
  {
    id: 18,
    prompt: "What is a race condition?",
    options: [
      "A slow query",
      "Timing-dependent shared-state behavior",
      "A syntax error",
      "A network protocol",
    ],
    correct: 1,
    explanation:
      "Race conditions occur when timing changes the outcome of competing operations.",
  },
  {
    id: 19,
    prompt: "Which browser API lets same-origin tabs exchange messages?",
    options: ["BroadcastChannel", "Canvas", "FileReader", "History"],
    correct: 0,
    explanation:
      "BroadcastChannel broadcasts messages between browsing contexts on the same origin.",
  },
  {
    id: 20,
    prompt: "What is the primary authority for quiz tab ownership here?",
    options: [
      "The browser title",
      "The client UI",
      "The server",
      "The URL hash",
    ],
    correct: 2,
    explanation:
      "The server authorizes the active tab and rejects unauthorized submissions.",
  },
];

const sessions = new Map();
const roster = [];
const questionBank = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "data", "python-questions.json"),
    "utf8",
  ),
);
let competition = {
  state: "waiting",
  fullscreen: false,
  fullscreenExitMode: "warning",
  selectedParticipantIds: [],
  durationMinutes: 30,
  startedAt: null,
  endsAt: null,
  revealDurationMinutes: 10,
  revealEndsAt: null,
};

const stateFile = path.join(__dirname, "data", "state.json");

function saveState() {
  try {
    const data = {
      competition,
      roster,
      sessions: Array.from(sessions.entries()).map(([k, v]) => [
        k,
        {
          ...v,
          answers: Object.fromEntries(v.answers),
          reviewStatus: Array.from(v.reviewStatus || []),
        },
      ]),
      questionBank,
    };
    fs.writeFileSync(stateFile, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      if (data.competition) competition = data.competition;
      if (data.roster) {
        roster.length = 0;
        roster.push(...data.roster);
      }
      if (data.questionBank) {
        questionBank.length = 0;
        questionBank.push(...data.questionBank);
      }
      if (data.sessions) {
        sessions.clear();
        for (const [k, v] of data.sessions) {
          const answersMap = new Map();
          for (const [key, val] of Object.entries(v.answers || {})) {
            answersMap.set(Number(key), val);
          }
          v.answers = answersMap;
          v.reviewStatus = new Set(v.reviewStatus || []);
          sessions.set(k, v);
        }
      }
    }
  } catch (err) {
    console.error("Failed to load state:", err);
  }
}

loadState();

function id() {
  return crypto.randomUUID();
}
function now() {
  return Date.now();
}
function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
function isLive(session) {
  return session && now() - session.lastHeartbeat < HEARTBEAT_GRACE_MS;
}
function revealIsOpen() {
  return (
    (competition.state === "results" || competition.state === "answers") &&
    (!competition.revealEndsAt || now() < competition.revealEndsAt)
  );
}
function publicQuestions() {
  return questionBank.map(({ id, prompt, options, correct, explanation }) =>
    competition.state === "answers" && revealIsOpen()
      ? { id, prompt, options, correct, explanation }
      : { id, prompt, options },
  );
}
function organizerQuestions() {
  return questionBank.map((question) => ({ ...question }));
}
function publicSession(session) {
  return {
    participantId: session.participantId,
    participantName: session.participantName,
    sessionId: session.sessionId,
    tabId: session.activeTabId,
    currentQuestion: session.currentQuestion,
    answers: Object.fromEntries(session.answers),
    reviewStatus: session.reviewStatus ? Array.from(session.reviewStatus) : [],
    state: session.state,
    score: session.score,
    connected: isLive(session),
    tabStatus: session.multipleTabDetected
      ? "MULTIPLE TAB DETECTED"
      : isLive(session)
        ? "ACTIVE"
        : "RECONNECTING",
    multipleTabAt: session.multipleTabAt || null,
    lastHeartbeat: session.lastHeartbeat,
    resultsRevealed: competition.state === "results" && revealIsOpen(),
    answersRevealed: competition.state === "answers" && revealIsOpen(),
    revealEndsAt: competition.revealEndsAt,
    questions: publicQuestions(),
  };
}
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function findSession(body) {
  return sessions.get(body.sessionId);
}
function validIdentity(session, body) {
  return (
    session &&
    session.participantId === body.participantId &&
    session.activeTabId === body.tabId &&
    isLive(session)
  );
}
function scoreSession(session) {
  if (!questionBank || questionBank.length === 0) return 0;
  return Number(
    questionBank
      .reduce((sum, item) => {
        const ans = session.answers.get(item.id) ?? session.answers.get(String(item.id));
        return sum + (ans === item.correct ? TOTAL_SCORE / questionBank.length : 0);
      }, 0)
      .toFixed(1),
  );
}
function finalizeSession(session) {
  if (session.state !== "submitted") {
    session.state = "submitted";
    session.score = scoreSession(session);
  }
}
function isOrganizer(req, body) {
  const suppliedKey = req.headers["x-organizer-key"] || body.organizerKey;
  return suppliedKey === ORGANIZER_KEY || suppliedKey === DEFAULT_ORGANIZER_KEY;
}
function organizerHeaderIsValid(req) {
  const suppliedKey = req.headers["x-organizer-key"];
  return suppliedKey === ORGANIZER_KEY || suppliedKey === DEFAULT_ORGANIZER_KEY;
}
function refreshCompetition() {
  if (
    competition.state === "running" &&
    competition.endsAt &&
    now() >= competition.endsAt
  ) {
    competition = { ...competition, state: "stopped" };
    for (const session of sessions.values())
      if (session.state === "quiz") finalizeSession(session);
    saveState();
  }
  return competition;
}
function cleanup() {
  let changed = false;
  for (const [key, session] of sessions) {
    if (now() - session.lastHeartbeat > SESSION_TTL_MS) {
      sessions.delete(key);
      changed = true;
    }
  }
  if (changed) saveState();
}
setInterval(cleanup, 10_000).unref();

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  refreshCompetition();
  if (req.method === "GET" && url.pathname === "/api/state") {
    if (!organizerHeaderIsValid(req)) {
      return send(res, 200, { competition, questions: publicQuestions() });
    }
    return send(res, 200, {
      competition,
      roster: [...roster],
      questions: organizerQuestions(),
      sessions: [...sessions.values()].map(publicSession),
    });
  }
  if (req.method === "POST") {
    let body;
    try {
      body = await parseBody(req);
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
    if (url.pathname.startsWith("/api/organizer/") && !isOrganizer(req, body)) {
      return send(res, 401, { error: "Organizer authorization required." });
    }

    if (url.pathname === "/api/organizer/verify") {
      return send(res, 200, { authorized: true });
    }

    if (url.pathname === "/api/session/register") {
      const participantName =
        String(body.participantName || "Participant")
          .trim()
          .slice(0, 60) || "Participant";
      const normalizedName = normalizeName(participantName);
      const participantId = String(
        body.participantId ||
          participantName.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
            "-" +
            id().slice(0, 8),
      );

      const existing = [...sessions.values()].find(
        (session) =>
          session.participantId === participantId && session.state !== "ended",
      );
      if (existing && isLive(existing))
        return send(res, 409, {
          code: "MULTIPLE_TAB",
          message: "Another quiz tab is already active.",
          session: publicSession(existing),
        });
      const sameName = [...sessions.values()].find(
        (session) =>
          session.normalizedName === normalizedName &&
          session.state !== "ended" &&
          isLive(session),
      );
      if (sameName)
        return send(res, 409, {
          code: "PARTICIPANT_ALREADY_LOGGED_IN",
          message: `${sameName.participantName} is already logged in from another quiz session.`,
        });

      const session = {
        participantId,
        participantName,
        normalizedName,
        sessionId: body.sessionId || id(),
        activeTabId: body.tabId || id(),
        currentQuestion: 0,
        answers: new Map(),
        reviewStatus: new Set(),
        score: null,
        state: "waiting",
        lastHeartbeat: now(),
        multipleTabDetected: false,
        multipleTabAt: null,
      };
      sessions.set(session.sessionId, session);
      saveState();
      return send(res, 201, publicSession(session));
    }

    if (url.pathname === "/api/session/reconnect") {
      const session = findSession(body);
      if (
        !session ||
        session.participantId !== body.participantId ||
        session.state === "ended"
      )
        return send(res, 404, { error: "Session not found." });
      if (isLive(session) && session.activeTabId !== body.tabId)
        return send(res, 409, {
          code: "MULTIPLE_TAB",
          message: "Another quiz tab is already active.",
        });
      session.activeTabId = body.tabId;
      session.lastHeartbeat = now();
      saveState();
      return send(res, 200, publicSession(session));
    }

    if (url.pathname === "/api/session/heartbeat") {
      const session = findSession(body);
      if (!validIdentity(session, body))
        return send(res, 403, { error: "Unauthorized or expired quiz tab." });
      session.lastHeartbeat = now();
      return send(res, 200, { connected: true, competitionState: competition.state });
    }

    if (url.pathname === "/api/session/state") {
      const session = findSession(body);
      if (!validIdentity(session, body))
        return send(res, 403, {
          error: "Unauthorized or expired quiz session.",
        });
      return send(res, 200, { competition, session: publicSession(session) });
    }

    if (url.pathname === "/api/session/event") {
      const session = findSession(body);
      if (!validIdentity(session, body))
        return send(res, 403, { error: "Unauthorized quiz tab." });
      if (body.type === "MULTIPLE_TAB") {
        session.multipleTabDetected = true;
        session.multipleTabAt = now();
      }
      if (
        body.type === "FULLSCREEN_VIOLATION" ||
        body.type === "NAVIGATION_VIOLATION"
      )
        session.violationCount = Math.max(
          session.violationCount || 0,
          Number(body.count) || 0,
        );
      saveState();
      return send(res, 200, { recorded: true });
    }

    if (url.pathname === "/api/session/submit") {
      const session = findSession(body);
      if (!validIdentity(session, body))
        return send(res, 403, { error: "Unauthorized quiz tab." });
      if (session.state === "submitted")
        return send(res, 409, { error: "Quiz already submitted." });
      session.state = "submitted";
      session.score = scoreSession(session);
      saveState();
      return send(res, 200, publicSession(session));
    }

    if (url.pathname === "/api/session/answer") {
      const session = findSession(body);
      if (!validIdentity(session, body))
        return send(res, 403, { error: "Unauthorized quiz tab." });
      refreshCompetition();
      if (competition.state !== "running" || session.state !== "quiz")
        return send(res, 409, { error: "The quiz is not accepting answers." });
      const question = questionBank.find(
        (item) => item.id === Number(body.questionId),
      );
      if (!question) return send(res, 400, { error: "Invalid question." });

      if (!session.reviewStatus) session.reviewStatus = new Set();

      if (body.action === "clear") {
        session.answers.delete(question.id);
        session.reviewStatus.delete(question.id);
      } else {
        if (body.optionIndex !== undefined && body.optionIndex !== null) {
          if (
            !Number.isInteger(body.optionIndex) ||
            body.optionIndex < 0 ||
            body.optionIndex >= question.options.length
          )
            return send(res, 400, { error: "Invalid answer." });
          session.answers.set(question.id, body.optionIndex);
        }
        if (body.action === "mark_review") {
          session.reviewStatus.add(question.id);
        } else if (body.action === "save") {
          session.reviewStatus.delete(question.id);
        }
      }

      if (body.nextQuestionIndex !== undefined) {
        session.currentQuestion = body.nextQuestionIndex;
      }
      saveState();
      return send(res, 200, publicSession(session));
    }

    if (url.pathname === "/api/organizer/start") {
      competition.selectedParticipantIds = Array.from(
        new Set(
          body.selectedParticipantIds ||
            competition.selectedParticipantIds ||
            [],
        ),
      );
      if (competition.selectedParticipantIds.length === 0) {
        return send(res, 400, {
          error: "Select at least one participant before starting the test.",
        });
      }
      competition.durationMinutes = Math.max(
        1,
        Math.min(
          180,
          Number(body.durationMinutes) || competition.durationMinutes || 30,
        ),
      );
      competition.startedAt = now();
      competition.endsAt =
        competition.startedAt + competition.durationMinutes * 60 * 1000;
      competition.state = "running";
      for (const session of sessions.values()) {
        if (
          competition.selectedParticipantIds.includes(session.participantName)
        ) {
          session.state = "quiz";
        }
      }
      saveState();
      return send(res, 200, { competition });
    }

    if (url.pathname === "/api/organizer/stop") {
      competition = { ...competition, state: "stopped", endsAt: now() };
      for (const session of sessions.values()) {
        finalizeSession(session);
      }
      saveState();
      return send(res, 200, { competition });
    }

    if (url.pathname === "/api/organizer/session/delete") {
      const session = sessions.get(body.sessionId);
      if (!session)
        return send(res, 404, { error: "Participant session not found." });
      session.state = "ended";
      sessions.delete(body.sessionId);
      competition.selectedParticipantIds =
        competition.selectedParticipantIds.filter(
          (name) => name !== session.participantName,
        );
      saveState();
      return send(res, 200, {
        deleted: true,
        participantName: session.participantName,
      });
    }

    if (url.pathname === "/api/organizer/reveal-results") {
      const minutes = Math.max(
        1,
        Math.min(
          180,
          Number(body.revealDurationMinutes) ||
            competition.revealDurationMinutes ||
            10,
        ),
      );
      competition = {
        ...competition,
        state: "results",
        revealDurationMinutes: minutes,
        revealEndsAt: now() + minutes * 60 * 1000,
      };
      saveState();
      return send(res, 200, { competition });
    }

    if (url.pathname === "/api/organizer/reveal-answers") {
      const minutes = Math.max(
        1,
        Math.min(
          180,
          Number(body.revealDurationMinutes) ||
            competition.revealDurationMinutes ||
            10,
        ),
      );
      competition = {
        ...competition,
        state: "answers",
        revealDurationMinutes: minutes,
        revealEndsAt: now() + minutes * 60 * 1000,
      };
      saveState();
      return send(res, 200, { competition });
    }

    if (url.pathname === "/api/organizer/settings") {
      competition = {
        ...competition,
        fullscreen: Boolean(body.fullscreen),
        fullscreenExitMode:
          body.fullscreenExitMode === "lock" ? "lock" : "warning",
        durationMinutes: Math.max(
          1,
          Math.min(
            180,
            Number(body.durationMinutes) || competition.durationMinutes || 30,
          ),
        ),
        revealDurationMinutes: Math.max(
          1,
          Math.min(
            180,
            Number(body.revealDurationMinutes) ||
              competition.revealDurationMinutes ||
              10,
          ),
        ),
        selectedParticipantIds: Array.from(
          new Set(
            body.selectedParticipantIds ||
              competition.selectedParticipantIds ||
              [],
          ),
        ),
      };
      saveState();
      return send(res, 200, { competition });
    }

    if (url.pathname === "/api/organizer/roster") {
      const students = Array.isArray(body.students)
        ? body.students.map((name) => String(name).trim()).filter(Boolean)
        : [];
      roster.length = 0;
      roster.push(
        ...students.map((name) => ({
          id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name,
        })),
      );
      if (Array.isArray(body.selectedParticipantIds)) {
        competition.selectedParticipantIds = body.selectedParticipantIds
          .map((name) => String(name).trim())
          .filter(Boolean);
      }
      saveState();
      return send(res, 200, { roster: [...roster], competition });
    }

    if (url.pathname === "/api/organizer/questions") {
      const item = body.question;
      if (
        !item ||
        !item.prompt ||
        !Array.isArray(item.options) ||
        item.options.length !== 4 ||
        !Number.isInteger(item.correct)
      ) {
        return send(res, 400, { error: "Question payload is invalid." });
      }
      const nextId = questionBank.length
        ? Math.max(...questionBank.map((q) => q.id)) + 1
        : 1;
      questionBank.push({
        id: nextId,
        prompt: item.prompt,
        options: item.options,
        correct: Number(item.correct),
        explanation: item.explanation || "Answer explanation not provided.",
      });
      saveState();
      return send(res, 201, { questions: organizerQuestions() });
    }

    if (url.pathname === "/api/organizer/questions/update") {
      const item = body.question;
      const index = questionBank.findIndex(
        (question) => question.id === Number(body.questionId),
      );
      if (index < 0) return send(res, 404, { error: "Question not found." });
      if (
        !item ||
        !item.prompt ||
        !Array.isArray(item.options) ||
        item.options.length !== 4 ||
        !Number.isInteger(item.correct) ||
        item.correct < 0 ||
        item.correct > 3
      ) {
        return send(res, 400, { error: "Question payload is invalid." });
      }
      questionBank[index] = {
        ...questionBank[index],
        prompt: item.prompt,
        options: item.options,
        correct: item.correct,
        explanation: item.explanation || "Answer explanation not provided.",
      };
      saveState();
      return send(res, 200, { questions: organizerQuestions() });
    }

    if (url.pathname === "/api/organizer/questions/delete") {
      const index = questionBank.findIndex(
        (question) => question.id === Number(body.questionId),
      );
      if (index < 0) return send(res, 404, { error: "Question not found." });
      if (questionBank.length <= 1)
        return send(res, 400, {
          error: "Keep at least one question in the question bank.",
        });
      questionBank.splice(index, 1);
      saveState();
      return send(res, 200, {
        deleted: true,
        questionId: Number(body.questionId),
        questions: organizerQuestions(),
      });
    }
  }

  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.join(__dirname, "public", file);
  if (!filePath.startsWith(path.join(__dirname, "public")))
    return send(res, 404, { error: "Not found" });
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, { error: "Not found" });
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
    };
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

http
  .createServer((req, res) =>
    route(req, res).catch((error) => send(res, 500, { error: error.message })),
  )
  .listen(PORT, () =>
    console.log(`CODE BATTLE 2026 listening on http://localhost:${PORT}`),
  );
