// session.js — manages per-user conversation history in memory

const sessions = new Map();
const MAX_HISTORY = 20; // keep last 20 messages (10 turns)

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { history: [] });
  }
  return sessions.get(userId);
}

function addMessage(userId, role, content) {
  const session = getSession(userId);
  session.history.push({ role, content });
  // trim oldest messages if over limit
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

function getHistory(userId) {
  return getSession(userId).history;
}

function clearSession(userId) {
  sessions.delete(userId);
}

module.exports = { getHistory, addMessage, clearSession };