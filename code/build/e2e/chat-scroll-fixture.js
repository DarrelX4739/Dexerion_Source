'use strict';
const fs = require('node:fs');
const path = require('node:path');

function seedProfile(profile) {
  const account = path.join(profile, 'Accounts', 'default');
  fs.mkdirSync(account, { recursive: true });
  const now = Date.now();
  const chats = [
    { id: 'c-empty', title: 'Short saved conversation', createdAt: now, updatedAt: now, messages: [] },
    { id: 'c-bulk', title: 'Long saved conversation', createdAt: now - 60_000, updatedAt: now - 1000,
      messages: Array.from({ length: 225 }, (_, i) => ({
        id: 'm' + i, role: i % 2 ? 'model' : 'user', ts: now - 50_000 + i,
        text: 'Saved message ' + i + '\n\n**Details** in a second paragraph.',
      })) },
  ];
  fs.writeFileSync(path.join(account, 'bookmarks.json'), JSON.stringify({ roots: { bar: [], other: [] } }));
  fs.writeFileSync(path.join(account, 'chats.json'), JSON.stringify(chats));
}

module.exports = { seedProfile };
