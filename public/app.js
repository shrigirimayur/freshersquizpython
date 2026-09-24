const app = document.querySelector('#app');
const tabId = crypto.randomUUID();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('code-battle-quiz') : null;
let session = JSON.parse(localStorage.getItem('codeBattleSession') || 'null');
let localMode = null;
let heartbeatTimer;
let examTimer;
let competition = null;

const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
const post = async (url, payload) => {
  const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || 'Request failed'), { code:data.code, data });
  return data;
};

function base(payload = '') {
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">CODE <span>BATTLE</span> / 2026</div><div class="status"><i class="dot" id="connection-dot"></i><span id="connection-label">Connected</span></div></header>${payload}</div>`;
}

function showBlocker(title, message, button = 'CHECK AGAIN', action = checkSession) {
  app.innerHTML = `<div class="blocker"><section class="blocker-card"><div class="eyebrow">Strict quiz mode</div><h1>${title}</h1><p class="subhead" style="color:#d7e0d8">${message}</p><div class="actions"><button class="btn" id="blocker-action">${button}</button></div></section></div>`;
  document.querySelector('#blocker-action').onclick = action;
}

function renderHome() {
  base(`<section class="hero"><div class="eyebrow">Participant entrance</div><h1>One tab.<br>One shot.</h1><p class="subhead">CODE BATTLE 2026 is a supervised challenge. The organizer controls the room separately; this page is only for taking the quiz.</p></section><section class="panel lime"><div class="eyebrow">Student waiting room</div><h2>Enter the quiz</h2><p>Use your assigned name. Reopening the browser can reconnect to the same attempt.</p><div class="field"><label for="participant-name">Participant name</label><input id="participant-name" placeholder="e.g. Mayur Shah" maxlength="60"></div><button class="btn" id="join">JOIN QUIZ</button><div id="join-error" class="notice" hidden></div></section>`);
  document.querySelector('#join').onclick = join;
}

async function join() {
  const name = document.querySelector('#participant-name').value.trim() || 'Participant';
  try {
    const result = await post('/api/session/register', { participantName: name, participantId: session?.participantId, tabId });
    session = result;
    localStorage.setItem('codeBattleSession', JSON.stringify({ participantId: session.participantId, sessionId: session.sessionId }));
    localMode = 'participant';
    broadcast();
    startHeartbeat();
    renderParticipant();
  } catch (error) {
    if (error.code === 'MULTIPLE_TAB') {
      showBlocker('ANOTHER QUIZ TAB IS ALREADY ACTIVE', 'Please return to your original quiz tab. This tab cannot become active automatically.');
    } else if (error.code === 'PARTICIPANT_ALREADY_LOGGED_IN') {
      showBlocker('PARTICIPANT ALREADY LOGGED IN', 'This participant name is already active in another quiz session. Use your own assigned participant name.');
    } else if (error.code === 'NOT_SELECTED') {
      showBlocker('STUDENT NOT SELECTED', 'This student is not currently selected for the active test. Please wait for the organizer to start the room or choose a valid student.');
    } else {
      document.querySelector('#join-error').textContent = error.message;
      document.querySelector('#join-error').hidden = false;
    }
  }
}

function broadcast() {
  channel?.postMessage({ type:'ACTIVE_TAB', tabId, participantId: session?.participantId, sessionId: session?.sessionId });
}

async function checkSession() {
  if (!session) return renderHome();
  try {
    session = await post('/api/session/reconnect', { ...session, tabId });
    localMode = 'participant';
    startHeartbeat();
    renderParticipant();
  } catch {
    renderHome();
  }
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    try {
      await post('/api/session/heartbeat', { participantId: session.participantId, sessionId: session.sessionId, tabId });
      setConnection(true);
    } catch {
      setConnection(false);
    }
  }, 4000);
}

function setConnection(connected) {
  const dot = document.querySelector('#connection-dot');
  const label = document.querySelector('#connection-label');
  if (dot) dot.classList.toggle('off', !connected);
  if (label) label.textContent = connected ? 'Connected' : 'Reconnecting...';
}

async function renderParticipant() {
  const state = await post('/api/session/state', session);
  competition = state.competition;
  session = state.session;
  if (!session) return renderHome();
  startExamClock();
  if (session.state === 'ended' || competition?.state === 'stopped') return renderStopped();
  if (session.state === 'submitted' || competition?.state === 'results' || competition?.state === 'answers') return renderComplete();
  if (session.state === 'waiting') return renderWaiting();
  if (competition.fullscreen && !document.fullscreenElement) return renderFullscreenGate();
  renderQuestion();
}

function startExamClock() {
  clearInterval(examTimer);
  const update = () => {
    const remaining = competition?.endsAt ? Math.max(0, competition.endsAt - Date.now()) : null;
    const label = document.querySelector('#exam-clock');
    if (label) label.textContent = remaining === null ? 'Waiting for organizer' : `Time left ${formatDuration(remaining)}`;
    if (remaining === 0) {
      clearInterval(examTimer);
      renderParticipant();
    }
  };
  update();
  if (competition?.endsAt) examTimer = setInterval(update, 1000);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function renderStopped() {
  clearInterval(examTimer);
  base(`<section class="hero"><div class="eyebrow">Test closed</div><h1>The test has ended.</h1><p class="subhead">The organizer stopped the test or the server timer reached zero. Your saved answers remain recorded on the server.</p></section>`);
}

function renderFullscreenGate() {
  base(`<section class="hero"><div class="eyebrow">Fullscreen mode enabled</div><h1>Enter fullscreen to start.</h1><p class="subhead">Fullscreen is an additional deterrent, not a security mechanism. Your quiz session remains server-controlled.</p><button class="btn" id="fullscreen-start">ENTER FULLSCREEN</button></section>`);
  document.querySelector('#fullscreen-start').onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch {}
    renderParticipant();
  };
}

function renderWaiting() {
  base(`<section class="hero"><div class="eyebrow">Waiting room / ${escapeHtml(session.participantName)}</div><h1>Stay ready.</h1><p class="subhead">The organizer has not started this test yet. Keep this tab open; your server session is reserved.</p></section><section class="panel lime"><div class="eyebrow">Session registered</div><div class="rule"><span>Session</span><strong>${session.sessionId.slice(0,8).toUpperCase()}</strong></div><div class="rule"><span>Tab status</span><strong>ACTIVE QUIZ TAB</strong></div></section>`);
}

function renderQuestion() {
  const list = session.questions || [];
  const currentIndex = Math.min(Math.max(Number(session.currentQuestion) || 0, 0), list.length - 1);
  const question = list[currentIndex] || list.find(item => !session.answers[item.id]);
  if (!question) return renderComplete();
  const answered = session.answers[question.id];
  const map = list.map((item, index) => `<button class="question-map-item ${index === currentIndex ? 'current' : ''} ${session.answers[item.id] !== undefined ? 'answered' : ''}" data-question-index="${index}" title="Question ${index + 1}">${index + 1}</button>`).join('');
  base(`<div class="exam-layout"><section class="question-stage"><div class="progress"><span>QUESTION ${String(currentIndex + 1).padStart(2,'0')} / ${list.length}</span><span id="exam-clock">Time left --:--</span></div><div class="progress-line"><i style="width:${((currentIndex + 1) / list.length) * 100}%"></i></div><div class="eyebrow">${escapeHtml(session.participantName)} / active tab verified</div><h2>${escapeHtml(question.prompt)}</h2><div id="options">${question.options.map((option, index) => `<button class="option ${answered === index ? 'selected':''}" data-index="${index}"><span class="option-letter">${String.fromCharCode(65 + index)}</span>${escapeHtml(option)}</button>`).join('')}</div><div id="answer-status" class="notice" hidden></div><div class="question-actions"><button class="btn secondary" id="previous-question" ${currentIndex === 0 ? 'disabled' : ''}>PREVIOUS</button><button class="btn" id="next-question">${currentIndex === list.length - 1 ? 'REVIEW ANSWERS' : 'SAVE & NEXT'}</button></div></section><aside class="question-map panel"><div class="eyebrow">Question paper</div><h3>Question map</h3><p class="muted">Green = answered. Dark = current.</p><div class="map-grid">${map}</div><div class="map-legend"><span><i class="legend-dot answered-dot"></i> Answered</span><span><i class="legend-dot current-dot"></i> Current</span></div><div class="map-summary"><strong>${Object.keys(session.answers).length}</strong> answered of ${list.length}</div></aside></div>`);
  document.querySelectorAll('.option').forEach(button => button.onclick = () => submitAnswer(question, Number(button.dataset.index)));
  document.querySelectorAll('[data-question-index]').forEach(button => button.onclick = () => { session.currentQuestion = Number(button.dataset.questionIndex); renderQuestion(); });
  document.querySelector('#previous-question').onclick = () => { session.currentQuestion = currentIndex - 1; renderQuestion(); };
  document.querySelector('#next-question').onclick = () => { if (currentIndex === list.length - 1 && Object.keys(session.answers).length === list.length) return renderComplete(); session.currentQuestion = Math.min(currentIndex + 1, list.length - 1); renderQuestion(); };
}

async function submitAnswer(question, optionIndex) {
  try {
    session = await post('/api/session/answer', { participantId: session.participantId, sessionId: session.sessionId, tabId, questionId: question.id, optionIndex });
    renderParticipant();
  } catch (error) {
    const status = document.querySelector('#answer-status');
    if (status) {
      status.textContent = error.message;
      status.hidden = false;
    }
  }
}

async function renderComplete() {
  const state = await post('/api/session/state', session);
  competition = state.competition;
  session = state.session;
  const resultsVisible = state.competition.state === 'results' || state.competition.state === 'answers';
  const answersVisible = state.competition.state === 'answers';
  const questionList = session.questions || [];
  const details = answersVisible ? questionList.map(question => `<div class="rule"><span>${question.id}. ${escapeHtml(question.prompt)}</span><strong>${escapeHtml(question.options[question.correct] || '')}</strong></div>`).join('') : '';
  base(`<section class="hero"><div class="eyebrow">Submission received</div><h1>Quiz submitted.</h1><p class="subhead">Your answers are stored on the server. Stay in this tab while the organizer prepares the next reveal.</p></section><section class="panel lime"><div class="eyebrow">${resultsVisible ? 'Results revealed' : 'Waiting for organizer'}</div>${resultsVisible ? `<div class="score">${session.score ?? '—'} / 50</div><p>YOUR SCORE</p>` : '<h2>Keep your place.</h2><p>Your score and the answer key are hidden until the organizer reveals them.</p>'}</section>${details ? `<section class="panel" style="margin-top:20px"><div class="eyebrow">Answer key and explanations</div>${details}</section>` : ''}`);
}

async function renderOrganizer() {
  const state = await fetch('/api/state').then(response => response.json());
  competition = state.competition;
  localMode = 'organizer';
  const roster = state.roster || [];
  const questions = state.questions || [];
  const selected = new Set(competition.selectedParticipantIds || []);

  base(`<section class="hero"><div class="eyebrow">Organizer console / supervised room</div><h1>Run the room.</h1><p class="subhead">The server stays authoritative. Only selected students can join the test, and the active tab remains single-user.</p><div class="actions"><button class="btn" id="start">${competition.state === 'waiting' ? 'START TEST' : 'TEST ACTIVE'}</button><button class="btn secondary" id="stop">STOP TEST</button><button class="btn secondary" id="results">REVEAL RESULTS</button><button class="btn secondary" id="answers">REVEAL ANSWERS</button></div></section><section class="grid"><div class="panel"><div class="eyebrow">Student roster</div><div class="field"><input id="student-name" placeholder="Add student name"><button class="btn secondary" id="add-student">ADD STUDENT</button></div><div class="field">${roster.length ? roster.map(student => `<label class="rule"><span>${escapeHtml(student.name)}</span><input type="checkbox" data-name="${escapeHtml(student.name)}" ${selected.has(student.name) ? 'checked' : ''}></label>`).join('') : '<p class="muted">No students added yet.</p>'}</div><div class="actions"><button class="btn secondary" id="select-all">SELECT ALL</button></div></div><div class="panel orange"><div class="eyebrow">Question bank</div><div class="field"><input id="question-text" placeholder="Question prompt"><input id="option-a" placeholder="Option A"><input id="option-b" placeholder="Option B"><input id="option-c" placeholder="Option C"><input id="option-d" placeholder="Option D"><input id="correct-index" placeholder="Correct index (0-3)"><input id="explanation" placeholder="Answer explanation"><button class="btn" id="add-question">ADD QUESTION</button></div><div class="field">${questions.length ? questions.map(question => `<div class="rule"><span>${question.id}. ${escapeHtml(question.prompt)}</span></div>`).join('') : '<p class="muted">No questions added yet.</p>'}</div></div></section><section class="panel" style="margin-top:20px"><div class="eyebrow">Participant monitoring</div><table class="table"><thead><tr><th>Participant</th><th>Session</th><th>Tab status</th></tr></thead><tbody id="monitor">${monitorRows(state.sessions)}</tbody></table></section>`);

  document.querySelector('#start').onclick = () => {
    const selectedNames = [...document.querySelectorAll('input[data-name]:checked')].map(el => el.dataset.name);
    post('/api/organizer/start', { selectedParticipantIds: selectedNames }).then(renderOrganizer);
  };
  document.querySelector('#stop').onclick = () => post('/api/organizer/stop', {}).then(renderOrganizer);
  document.querySelector('#results').onclick = () => post('/api/organizer/reveal-results', {}).then(renderOrganizer);
  document.querySelector('#answers').onclick = () => post('/api/organizer/reveal-answers', {}).then(renderOrganizer);

  document.querySelector('#add-student').onclick = () => {
    const name = document.querySelector('#student-name').value.trim();
    if (!name) return;
    const nextRoster = [...roster.map(item => item.name), name];
    post('/api/organizer/roster', { students: nextRoster, selectedParticipantIds: nextRoster }).then(renderOrganizer);
  };

  document.querySelector('#select-all').onclick = () => {
    const names = roster.map(item => item.name);
    post('/api/organizer/roster', { students: names, selectedParticipantIds: names }).then(renderOrganizer);
  };

  document.querySelector('#add-question').onclick = () => {
    const prompt = document.querySelector('#question-text').value.trim();
    const options = [
      document.querySelector('#option-a').value.trim(),
      document.querySelector('#option-b').value.trim(),
      document.querySelector('#option-c').value.trim(),
      document.querySelector('#option-d').value.trim()
    ];
    const correct = Number(document.querySelector('#correct-index').value);
    const explanation = document.querySelector('#explanation').value.trim();
    if (!prompt || options.some(option => !option) || Number.isNaN(correct) || correct < 0 || correct > 3) {
      alert('Please fill in the question prompt, all four options, and a valid correct index between 0 and 3.');
      return;
    }
    post('/api/organizer/questions', {
      question: { prompt, options, correct, explanation }
    }).then(renderOrganizer);
  };
}

function monitorRows(sessions) {
  return sessions.length ? sessions.map(item => {
    const multiple = item.tabStatus === 'MULTIPLE TAB DETECTED';
    const reconnecting = item.tabStatus === 'RECONNECTING';
    return `<tr><td>${escapeHtml(item.participantName)}</td><td>${item.sessionId.slice(0,8).toUpperCase()}</td><td><span class="tag ${multiple || reconnecting ? 'warn' : ''}">${multiple ? 'MULTIPLE TAB DETECTED' : reconnecting ? 'RECONNECTING' : item.state === 'submitted' ? 'SUBMITTED' : 'ACTIVE'}</span></td></tr>`;
  }).join('') : '<tr><td colspan="3" class="muted">No participants yet.</td></tr>';
}

channel?.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVE_TAB' && event.data.participantId === session?.participantId && event.data.tabId !== tabId && localMode === 'participant') {
    post('/api/session/event', { ...session, tabId, type: 'MULTIPLE_TAB', detectedTabId: event.data.tabId }).catch(() => {});
    showBlocker('MULTIPLE QUIZ WINDOWS DETECTED', 'CODE BATTLE 2026 requires the quiz to run in a single browser tab. Please close all other CODE BATTLE tabs/windows.');
  }
});

document.addEventListener('visibilitychange', () => { if (localMode === 'participant' && !document.hidden) broadcast(); });
document.addEventListener('fullscreenchange', () => { if (localMode === 'participant' && competition?.fullscreen && !document.fullscreenElement) renderFullscreenGate(); });
window.addEventListener('beforeunload', () => channel?.postMessage({ type: 'TAB_CLOSING', tabId }));
window.addEventListener('focus', () => { if (localMode === 'participant') broadcast(); });

renderHome();
