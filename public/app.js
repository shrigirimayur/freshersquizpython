const app = document.querySelector('#app');
const tabId = crypto.randomUUID();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('code-battle-quiz') : null;
let session = JSON.parse(localStorage.getItem('codeBattleSession') || 'null');
let localMode = null;
let heartbeatTimer;
let examTimer;
let competition = null;
let waitingRefreshTimer;
let violationCount = 0;
let warningVisible = false;
const MAX_VIOLATIONS = 5;
let currentSelectionIndex = null;
let currentQuestionId = null;

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
  base(`<section class="hero"><div class="eyebrow">Python technical challenge / 2026</div><h1>One tab.<br>One shot.</h1><p class="subhead">Twenty questions. Fifty points. Your attempt is saved as you progress.</p><div class="entry-meta"><span><strong>20</strong> questions</span><span><strong>50</strong> points</span><span><strong>1</strong> active tab</span></div></section><section class="panel lime"><div class="eyebrow">Student waiting room</div><h2>Enter your name to begin</h2><p>Your name identifies your attempt. Use the same name if you reconnect.</p><div class="field"><label for="participant-name">Participant name</label><input id="participant-name" placeholder="e.g. Mayur Shrigiri" maxlength="60"></div><button class="btn" id="join">JOIN QUIZ</button><div id="join-error" class="notice" hidden></div></section>`);
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
    requestQuizFullscreen();
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
    } catch (err) {
      setConnection(false);
      if (err.message && (err.message.includes('403') || err.message.includes('404') || err.message.includes('Unauthorized') || err.message.includes('not found'))) {
        clearInterval(heartbeatTimer);
        alert("The server has restarted or your session has expired. You need to rejoin.");
        localStorage.removeItem('codeBattleSession');
        window.location.reload();
      }
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
  clearInterval(waitingRefreshTimer);
  const state = await post('/api/session/state', session);
  competition = state.competition;
  session = state.session;
  if (!session) return renderHome();
  startExamClock();
  if (session.state === 'ended' || competition?.state === 'stopped') return renderStopped();
  if (session.state === 'submitted' || competition?.state === 'results' || competition?.state === 'answers') return renderComplete();
  if (session.state === 'waiting') return renderWaiting();
  if (competition.fullscreen && !document.fullscreenElement) return renderFullscreenGate();
  requestQuizFullscreen();
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

function requestQuizFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {});
}

async function submitCurrentAttempt() {
  try {
    session = await post('/api/session/submit', { participantId:session.participantId, sessionId:session.sessionId, tabId });
    warningVisible = false;
    renderComplete();
  } catch (error) {
    showViolationWarning(error.message);
  }
}

function showViolationWarning(message) {
  if (warningVisible) return;
  warningVisible = true;
  base(`<section class="blocker"><div class="blocker-card"><div class="eyebrow">Strict quiz warning ${violationCount}/${MAX_VIOLATIONS}</div><h1>Return to the quiz.</h1><p class="subhead" style="color:#d7e0d8">${escapeHtml(message)} This warning has been recorded. After ${MAX_VIOLATIONS} warnings, your attempt is submitted automatically.</p><div class="actions"><button class="btn" id="return-to-quiz">RETURN TO QUIZ</button></div></div></section>`);
  document.querySelector('#return-to-quiz').onclick = () => {
    requestQuizFullscreen();
    warningVisible = false;
    renderParticipant();
  };
}

function recordViolation(type, message) {
  if (localMode !== 'participant' || !session || session.state !== 'quiz' || warningVisible) return;
  violationCount += 1;
  post('/api/session/event', { ...session, tabId, type, count:violationCount }).catch(() => {});
  if (violationCount >= MAX_VIOLATIONS) return submitCurrentAttempt();
  showViolationWarning(message);
}

function renderFullscreenGate() {
  base(`<section class="hero"><div class="eyebrow">Fullscreen mode enabled</div><h1>Enter fullscreen to start.</h1><p class="subhead">Fullscreen is an additional deterrent, not a security mechanism. Your quiz session remains server-controlled.</p><button class="btn" id="fullscreen-start">ENTER FULLSCREEN</button></section>`);
  document.querySelector('#fullscreen-start').onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch {}
    renderParticipant();
  };
}

function renderWaiting() {
  base(`<section class="hero"><div class="eyebrow">Waiting room / ${escapeHtml(session.participantName)}</div><h1>Stay ready.</h1><p class="subhead">The organizer has not started this test yet. This page will update automatically when your attempt is selected.</p></section><section class="panel lime"><div class="eyebrow">Session registered</div><div class="rule"><span>Session</span><strong>${session.sessionId.slice(0,8).toUpperCase()}</strong></div><div class="rule"><span>Tab status</span><strong>ACTIVE QUIZ TAB</strong></div><div class="rule"><span>Test status</span><strong>WAITING FOR ORGANIZER</strong></div><p class="muted">Keep this one tab open. Do not refresh or open another quiz tab.</p></section>`);
  waitingRefreshTimer = setInterval(() => renderParticipant(), 3000);
}

function renderQuestion() {
  const list = session.questions || [];
  const currentIndex = Math.min(Math.max(Number(session.currentQuestion) || 0, 0), list.length - 1);
  const question = list[currentIndex] || list.find(item => !session.answers[item.id]);
  if (!question) return renderComplete();
  
  if (currentQuestionId !== question.id) {
    currentQuestionId = question.id;
    currentSelectionIndex = session.answers[question.id] !== undefined ? session.answers[question.id] : null;
  }
  
  if (!session.visited) session.visited = [];
  if (!session.visited.includes(question.id)) session.visited.push(question.id);

  const map = list.map((item, index) => {
    const isCurrent = index === currentIndex;
    const isAnswered = session.answers[item.id] !== undefined;
    const isReview = session.reviewStatus?.includes(item.id);
    let stateClass = '';
    if (isReview && isAnswered) stateClass = 'review-answered';
    else if (isReview) stateClass = 'review';
    else if (isAnswered) stateClass = 'answered';
    else if (session.visited.includes(item.id)) stateClass = 'not-answered';
    return `<button class="question-map-item ${isCurrent ? 'current' : ''} ${stateClass}" data-question-index="${index}" title="Question ${index + 1}">${index + 1}</button>`;
  }).join('');
  
  base(`<div class="exam-layout"><section class="question-stage"><div class="progress"><span>QUESTION ${String(currentIndex + 1).padStart(2,'0')} / ${list.length}</span><span id="exam-clock">Time left --:--</span></div><div class="progress-line"><i style="width:${((currentIndex + 1) / list.length) * 100}%"></i></div><div class="eyebrow">${escapeHtml(session.participantName)} / active tab verified</div><h2>${escapeHtml(question.prompt)}</h2><div id="options">${question.options.map((option, index) => `<button class="option ${currentSelectionIndex === index ? 'selected':''}" data-index="${index}"><span class="option-letter">${String.fromCharCode(65 + index)}</span>${escapeHtml(option)}</button>`).join('')}</div><div id="answer-status" class="notice" hidden></div>
  
  <div class="nta-action-row" style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--line);">
    <button class="btn btn-nta-green" id="save-next">SAVE & NEXT</button>
    <button class="btn btn-nta-orange" id="save-review">SAVE & REVIEW</button>
    <button class="btn btn-nta-purple" id="mark-review">REVIEW & NEXT</button>
    <button class="btn secondary" id="clear-response">CLEAR</button>
  </div>
  
  <div class="nta-nav-row" style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 20px; border-top: 1px dashed var(--line);">
    <div style="display: flex; gap: 12px;">
      <button class="btn secondary" id="previous-question" ${currentIndex === 0 ? 'disabled' : ''}>&lt;&lt; BACK</button>
      <button class="btn secondary" id="next-question" ${currentIndex === list.length - 1 ? 'disabled' : ''}>NEXT &gt;&gt;</button>
    </div>
    <button class="btn btn-nta-submit" id="submit-test">SUBMIT TEST</button>
  </div>
  </section><aside class="question-map panel"><div class="eyebrow">Question paper</div><h3>Question map</h3><div class="map-grid">${map}</div><div class="map-legend"><span><i class="legend-dot answered-dot"></i> Answered</span><span><i class="legend-dot not-answered-dot"></i> Not Answered</span><span><i class="legend-dot review-dot"></i> Review</span><span><i class="legend-dot review-answered-dot"></i> Ans & Review</span></div><div class="map-summary"><strong>${Object.keys(session.answers).length}</strong> answered of ${list.length}</div></aside></div>`);
  
  document.querySelectorAll('.option').forEach(button => button.onclick = () => {
    currentSelectionIndex = Number(button.dataset.index);
    renderQuestion();
  });
  
  document.querySelectorAll('[data-question-index]').forEach(button => button.onclick = () => { 
    session.currentQuestion = Number(button.dataset.questionIndex); 
    renderQuestion(); 
  });
  
  document.querySelector('#previous-question').onclick = () => { session.currentQuestion = currentIndex - 1; renderQuestion(); };
  document.querySelector('#next-question').onclick = () => { session.currentQuestion = currentIndex + 1; renderQuestion(); };
  
  const nextIndex = Math.min(currentIndex + 1, list.length - 1);
  
  document.querySelector('#clear-response').onclick = () => {
    currentSelectionIndex = null;
    submitAnswer(question, { action: 'clear', nextQuestionIndex: currentIndex });
  };
  
  document.querySelector('#mark-review').onclick = () => submitAnswer(question, { action: 'mark_review', optionIndex: null, nextQuestionIndex: nextIndex });
  
  document.querySelector('#save-review').onclick = () => {
    if (currentSelectionIndex === null) return alert('Please select an option first.');
    submitAnswer(question, { action: 'mark_review', optionIndex: currentSelectionIndex, nextQuestionIndex: nextIndex });
  };
  
  document.querySelector('#save-next').onclick = () => {
    if (currentSelectionIndex === null) return alert('Please select an option first.');
    submitAnswer(question, { action: 'save', optionIndex: currentSelectionIndex, nextQuestionIndex: nextIndex });
  };
  
  document.querySelector('#submit-test').onclick = () => { if (confirm('Submit your test now? You will not be able to change your answers.')) submitCurrentAttempt(); };
}

async function submitAnswer(question, payload) {
  try {
    session = await post('/api/session/answer', { participantId: session.participantId, sessionId: session.sessionId, tabId, questionId: question.id, ...payload });
    currentQuestionId = null;
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
  const revealOpen = (state.competition.state === 'results' || state.competition.state === 'answers') && (!state.competition.revealEndsAt || Date.now() < state.competition.revealEndsAt);
  const resultsVisible = revealOpen;
  const answersVisible = revealOpen && state.competition.state === 'answers';
  const questionList = session.questions || [];
  const details = answersVisible ? questionList.map(question => `<div class="rule"><span>${question.id}. ${escapeHtml(question.prompt)}</span><strong>${escapeHtml(question.options[question.correct] || '')}</strong></div>`).join('') : '';
  const countdown = revealOpen && state.competition.revealEndsAt ? `<p class="muted">This reveal closes in ${formatDuration(state.competition.revealEndsAt - Date.now())}.</p>` : '';
  base(`<section class="hero"><div class="eyebrow">Submission received</div><h1>Quiz submitted.</h1><p class="subhead">Your answers are stored on the server. Stay in this tab while the organizer prepares the next reveal.</p></section><section class="panel lime"><div class="eyebrow">${resultsVisible ? 'Results revealed' : 'Waiting for organizer'}</div>${resultsVisible ? `<div class="score">${session.score ?? '—'} / 50</div><p>YOUR SCORE</p>${countdown}` : `<h2>${state.competition.state === 'results' || state.competition.state === 'answers' ? 'Reveal window closed.' : 'Keep your place.'}</h2><p>${state.competition.state === 'results' || state.competition.state === 'answers' ? 'The organizer can open another controlled reveal window.' : 'Your score and the answer key are hidden until the organizer reveals them.'}</p>`}</section>${details ? `<section class="panel" style="margin-top:20px"><div class="eyebrow">Answer key and explanations</div>${details}</section>` : ''}`);
  if (revealOpen && state.competition.revealEndsAt) setTimeout(renderParticipant, Math.max(1000, state.competition.revealEndsAt - Date.now()));
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

document.addEventListener('visibilitychange', () => { if (localMode === 'participant' && document.hidden) recordViolation('NAVIGATION_VIOLATION', 'You left the quiz tab.'); });
document.addEventListener('fullscreenchange', () => { if (localMode === 'participant' && competition?.state === 'running' && !document.fullscreenElement) recordViolation('FULLSCREEN_VIOLATION', 'Fullscreen mode was exited.'); });
history.replaceState({ quiz:true }, '', location.href);
window.addEventListener('popstate', () => { history.pushState({ quiz:true }, '', location.href); recordViolation('NAVIGATION_VIOLATION', 'You tried to go back from the quiz.'); });
window.addEventListener('beforeunload', () => channel?.postMessage({ type: 'TAB_CLOSING', tabId }));
window.addEventListener('focus', () => { if (localMode === 'participant') broadcast(); });

renderHome();
