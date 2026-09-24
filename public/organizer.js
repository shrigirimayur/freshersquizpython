const app = document.querySelector('#app');
let organizerKey = sessionStorage.getItem('organizerKey') || '';
let roomRefreshTimer;

const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[character]));
const post = async (url, payload = {}) => {
  const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Organizer-Key':organizerKey }, body:JSON.stringify({ ...payload, organizerKey }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Organizer request failed.');
  return data;
};
const getState = () => fetch('/api/state', { headers:{ 'X-Organizer-Key':organizerKey } }).then(response => { if (!response.ok) throw new Error('Organizer authorization failed.'); return response.json(); });

function shell(content) {
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand">CODE <span>BATTLE</span> / 2026</div><a class="btn secondary" href="/">PARTICIPANT PAGE</a></header>${content}</div>`;
}

function login() {
  shell(`<section class="hero"><div class="eyebrow">Restricted organizer access</div><h1>Control the room.</h1><p class="subhead">Students use a separate participant page. This page manages the roster, question bank, test state, and result reveals.</p></section><section class="panel lime" style="max-width:600px"><div class="field"><label for="organizer-key">Organizer key</label><input id="organizer-key" type="password" placeholder="Enter organizer key"></div><button class="btn" id="authorize">OPEN CONTROL ROOM</button><div id="login-error" class="notice danger" hidden></div></section>`);
  document.querySelector('#authorize').onclick = async () => {
    organizerKey = document.querySelector('#organizer-key').value;
    try { await post('/api/organizer/verify'); sessionStorage.setItem('organizerKey', organizerKey); renderRoom(); } catch (error) { const box = document.querySelector('#login-error'); box.textContent = error.message; box.hidden = false; };
  };
}

function monitorRows(sessions) {
  return sessions.length ? sessions.map(item => `<tr><td>${escapeHtml(item.participantName)}</td><td><span class="tag ${item.connected ? '' : 'warn'}">${item.connected ? 'ONLINE' : 'OFFLINE'}</span></td><td>${item.sessionId.slice(0,8).toUpperCase()}</td><td><span class="tag ${item.tabStatus !== 'ACTIVE' ? 'warn' : ''}">${escapeHtml(item.tabStatus || item.state)}</span></td><td><button class="btn secondary remove-participant" data-session-id="${item.sessionId}">REMOVE</button></td></tr>`).join('') : '<tr><td colspan="5" class="muted">No students logged in yet.</td></tr>';
}

function leaderboardRows(sessions) {
  const completed = sessions.filter(item => item.score !== null && item.score !== undefined).sort((left, right) => right.score - left.score);
  return completed.length ? completed.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.participantName)}</td><td><strong>${item.score} / 50</strong></td><td>${item.state === 'submitted' ? 'SUBMITTED' : escapeHtml(item.state)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">Scores appear here after participants submit.</td></tr>';
}

function questionRows(questions) {
  return questions.length ? `<div class="question-admin-list">${questions.map(question => `<div class="rule"><span><strong>Q${question.id}</strong> ${escapeHtml(question.prompt)}</span><span class="actions"><button class="btn secondary edit-question" data-question-id="${question.id}">EDIT</button><button class="btn alert delete-question" data-question-id="${question.id}">DELETE</button></span></div>`).join('')}</div>` : '<p class="muted">No questions configured.</p>';
}

async function renderRoom() {
  try {
    clearInterval(roomRefreshTimer);
    const state = await getState();
    const selected = new Set(state.competition.selectedParticipantIds || []);
    const roster = state.roster || [];
    const candidates = [...new Set([...roster.map(student => student.name), ...state.sessions.map(item => item.participantName)])];
    const questions = state.questions || [];
    shell(`<section class="hero"><div class="eyebrow">Restricted organizer console</div><h1>Run the room.</h1><p class="subhead">Students can log in before the test. Select the online students, choose the duration, then start the test.</p><div class="actions"><button class="btn" id="start">START TEST</button><button class="btn alert" id="stop">STOP TEST</button><button class="btn secondary" id="results">REVEAL RESULTS</button><button class="btn secondary" id="answers">REVEAL ANSWERS</button></div><div class="notice">Current state: <strong id="current-state">${escapeHtml(state.competition.state)}</strong> <span id="test-clock">${state.competition.endsAt ? `ends ${new Date(state.competition.endsAt).toLocaleTimeString()}` : ''}</span></div></section><section class="grid"><div class="panel"><div class="eyebrow">Select students</div><p class="muted">Students who have opened the participant page appear below as online.</p><div class="field"><input id="student-name" placeholder="Student name"><button class="btn secondary" id="add-student">ADD STUDENT</button></div><div>${candidates.length ? candidates.map(name => `<label class="rule"><span>${escapeHtml(name)}</span><input type="checkbox" data-name="${escapeHtml(name)}" ${selected.has(name) ? 'checked' : ''}></label>`).join('') : '<p class="muted">No students logged in yet.</p>'}</div><button class="btn secondary" id="select-all">SELECT ALL</button><label class="field"><span>Test duration in minutes</span><input id="duration-minutes" type="number" min="1" max="180" value="${state.competition.durationMinutes || 30}"></label></div><div class="panel orange"><div class="eyebrow">Question bank</div><div class="field"><input id="question-text" placeholder="Question prompt"><input id="option-a" placeholder="Option A"><input id="option-b" placeholder="Option B"><input id="option-c" placeholder="Option C"><input id="option-d" placeholder="Option D"><input id="correct-index" placeholder="Correct index: 0-3"><input id="explanation" placeholder="Explanation"><button class="btn" id="add-question">ADD QUESTION</button></div>${questionRows(questions)}</div></section><section class="panel" style="margin-top:20px"><div class="eyebrow">Live monitoring</div><table class="table"><thead><tr><th>Participant</th><th>Connection</th><th>Session</th><th>Tab status</th><th>Actions</th></tr></thead><tbody id="monitor-body">${monitorRows(state.sessions)}</tbody></table></section><section class="panel" style="margin-top:20px"><div class="eyebrow">Leaderboard</div><table class="table"><thead><tr><th>Rank</th><th>Participant</th><th>Score</th><th>Status</th></tr></thead><tbody id="leaderboard-body">${leaderboardRows(state.sessions)}</tbody></table></section>`);
    const revealInput = document.createElement('input');
    revealInput.id = 'reveal-duration';
    revealInput.type = 'number';
    revealInput.min = '1';
    revealInput.max = '180';
    revealInput.value = state.competition.revealDurationMinutes || 10;
    revealInput.setAttribute('aria-label', 'Reveal duration in minutes');
    const revealLabel = document.createElement('label');
    revealLabel.className = 'field';
    revealLabel.textContent = 'Reveal duration in minutes';
    revealLabel.appendChild(revealInput);
    document.querySelector('.hero').appendChild(revealLabel);
    bindControls(roster);
    document.querySelectorAll('.edit-question').forEach(button => button.onclick = () => editQuestion(Number(button.dataset.questionId), questions));
    document.querySelectorAll('.delete-question').forEach(button => button.onclick = () => deleteQuestion(Number(button.dataset.questionId)));
    roomRefreshTimer = setInterval(refreshRoom, 3000);
  } catch (error) { showRoomError(error.message); }
}

function showRoomError(message) {
  const existing = document.querySelector('#room-error');
  if (existing) { existing.textContent = message; existing.hidden = false; return; }
  app.insertAdjacentHTML('afterbegin', `<div class="shell"><div id="room-error" class="notice danger">${escapeHtml(message)}</div></div>`);
}

function selectedNames() { return [...document.querySelectorAll('input[data-name]:checked')].map(input => input.dataset.name); }
function questionForm(question) {
  document.querySelector('#question-text').value = question?.prompt || '';
  ['a', 'b', 'c', 'd'].forEach((letter, index) => { document.querySelector(`#option-${letter}`).value = question?.options?.[index] || ''; });
  document.querySelector('#correct-index').value = question?.correct ?? '';
  document.querySelector('#explanation').value = question?.explanation || '';
}
function editQuestion(questionId, questions) {
  const question = questions.find(item => item.id === questionId);
  if (!question) return;
  questionForm(question);
  const button = document.querySelector('#add-question');
  button.textContent = 'SAVE QUESTION';
  button.dataset.editingId = String(questionId);
}
async function deleteQuestion(questionId) {
  if (!confirm('Delete this question from the question bank?')) return;
  try { await post('/api/organizer/questions/delete', { questionId }); await renderRoom(); } catch (error) { showRoomError(error.message); }
}
async function refreshRoom() {
  try {
    const state = await getState();
    const monitor = document.querySelector('#monitor-body');
    if (monitor) monitor.innerHTML = monitorRows(state.sessions);
    document.querySelectorAll('.remove-participant').forEach(button => button.onclick = () => removeParticipant(button.dataset.sessionId));
    const leaderboard = document.querySelector('#leaderboard-body');
    if (leaderboard) leaderboard.innerHTML = leaderboardRows(state.sessions);
    const stateLabel = document.querySelector('#current-state');
    if (stateLabel) stateLabel.textContent = state.competition.state;
    const clock = document.querySelector('#test-clock');
    if (clock) clock.textContent = state.competition.endsAt ? `ends ${new Date(state.competition.endsAt).toLocaleTimeString()}` : '';
  } catch {}
}
function bindControls(roster) {
  document.querySelectorAll('.remove-participant').forEach(button => button.onclick = () => removeParticipant(button.dataset.sessionId));
  document.querySelector('#start').onclick = async () => { try { const names = selectedNames(); if (!names.length) throw new Error('Select at least one participant before starting.'); await post('/api/organizer/start', { selectedParticipantIds:names, durationMinutes:Number(document.querySelector('#duration-minutes').value) }); await renderRoom(); } catch (error) { showRoomError(error.message); } };
  document.querySelector('#stop').onclick = async () => { try { await post('/api/organizer/stop'); await renderRoom(); } catch (error) { showRoomError(error.message); } };
  document.querySelector('#results').onclick = async () => { try { await post('/api/organizer/reveal-results', { revealDurationMinutes:Number(document.querySelector('#reveal-duration').value) }); await renderRoom(); } catch (error) { showRoomError(error.message); } };
  document.querySelector('#answers').onclick = async () => { try { await post('/api/organizer/reveal-answers', { revealDurationMinutes:Number(document.querySelector('#reveal-duration').value) }); await renderRoom(); } catch (error) { showRoomError(error.message); } };
  document.querySelector('#select-all').onclick = () => post('/api/organizer/roster', { students:roster.map(item => item.name), selectedParticipantIds:roster.map(item => item.name) }).then(renderRoom);
  document.querySelector('#add-student').onclick = () => { const name = document.querySelector('#student-name').value.trim(); if (name) post('/api/organizer/roster', { students:[...roster.map(item => item.name), name], selectedParticipantIds:[...roster.map(item => item.name), name] }).then(renderRoom); };
  document.querySelector('#add-question').onclick = async () => { const options = ['a','b','c','d'].map(letter => document.querySelector(`#option-${letter}`).value.trim()); const question = { prompt:document.querySelector('#question-text').value.trim(), options, correct:Number(document.querySelector('#correct-index').value), explanation:document.querySelector('#explanation').value.trim() }; if (!question.prompt || !options.every(Boolean) || question.correct < 0 || question.correct > 3) return showRoomError('Fill the prompt, all four options, and a correct index from 0 to 3.'); try { const editingId = document.querySelector('#add-question').dataset.editingId; await post(editingId ? '/api/organizer/questions/update' : '/api/organizer/questions', editingId ? { questionId:Number(editingId), question } : { question }); await renderRoom(); } catch (error) { showRoomError(error.message); } };
}

async function removeParticipant(sessionId) {
  try { await post('/api/organizer/session/delete', { sessionId }); await renderRoom(); } catch (error) { showRoomError(error.message); }
}

if (organizerKey) renderRoom(); else login();
