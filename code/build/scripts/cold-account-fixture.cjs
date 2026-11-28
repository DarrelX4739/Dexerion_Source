'use strict';
const fs = require('node:fs');
const path = require('node:path');

function seedInactiveAccounts(profile, { count = 12, historyRows = 3000, chats = 50 } = {}) {
  const now = Date.now();
  const accounts = [{ id: 'default', name: 'Personal', email: '', color: '#35c4ff', createdAt: now }];
  let payloadBytes = 0;
  function put(dir, file, value) {
    const text = JSON.stringify(value);
    fs.writeFileSync(path.join(dir, file), text);
    payloadBytes += Buffer.byteLength(text);
  }
  for (let i = 0; i < count; i++) {
    const id = 'bench-cold-' + i;
    accounts.push({ id, name: 'Fixture ' + i, email: '', color: '#35c4ff', createdAt: now });
    const dir = path.join(profile, 'Accounts', id);
    fs.mkdirSync(dir, { recursive: true });
    put(dir, 'bookmarks.json', { roots: { bar: [], other: [] } });
    put(dir, 'history.json', Array.from({ length: historyRows }, (_, j) => ({
      url: 'https://example.test/archive/' + i + '/' + j,
      title: 'Synthetic archived entry ' + i + ' item ' + j, at: now - j,
    })));
    put(dir, 'chats.json', Array.from({ length: chats }, (_, j) => ({
      id: 'chat-' + i + '-' + j, title: 'Synthetic archived chat ' + j,
      updatedAt: now - j, messages: Array.from({ length: 6 }, (_, k) => ({
        role: k % 2 ? 'assistant' : 'user', content: ('Fixture text ' + i + ':' + j + ':' + k + '. ').repeat(100),
      })),
    })));
    put(dir, 'tasks.json', [{
      id: 'task-' + i, title: 'Fixture task ' + i, notes: '', dueMs: now + 86400000 * 10,
      priority: 'medium', createdAt: now, hasTime: false, done: false,
      doneAt: 0, remindedPre: false, remindedDue: false,
    }]);
    for (const file of ['topsites.json', 'closed-tabs.json', 'logins.json', 'memory.json', 'missions.json', 'projects.json']) {
      put(dir, file, file === 'topsites.json' ? {} : []);
    }
  }
  put(profile, 'accounts.json', { accounts, defaultAccountId: 'default' });
  put(profile, 'settings.json', { welcomeDaily: false, restoreSession: false });
  return { payloadBytes, dormantAccounts: count, historyRowsPerAccount: historyRows, chatsPerAccount: chats };
}

module.exports = { seedInactiveAccounts };
