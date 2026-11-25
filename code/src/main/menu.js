// Application menu with Chrome-familiar accelerators.
const { Menu } = require('electron');

function buildAppMenu({ browser }) {
  const activeTab = (fn) => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    w.webContents.send('dex:menu', fn);
  };
  const tpl = [
    {
      label: 'File',
      submenu: [
        { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => activeTab('new-tab') },
        { label: 'New window', accelerator: 'CmdOrCtrl+N', click: () => browser.newWindow() },
        { label: 'Bookmark this page', accelerator: 'CmdOrCtrl+D', click: () => activeTab('bookmark') },
        { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => activeTab('close-tab') },
        { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', click: () => activeTab('reopen-tab') },
        { type: 'separator' },
        { label: 'Quit Dexerion', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => activeTab('reload') },
        { label: 'Hard reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => activeTab('hard-reload') },
        { label: 'Screenshot / record…', accelerator: 'CmdOrCtrl+Shift+S', click: () => activeTab('snip') },
        { label: 'Focus address bar', accelerator: 'CmdOrCtrl+L', click: () => activeTab('focus-url') },
    { label: 'Dexerion AI', accelerator: 'CmdOrCtrl+Shift+A', click: () => activeTab('ai-panel') },
        { label: 'New AI chat', accelerator: 'CmdOrCtrl+Shift+O', click: () => activeTab('ai-new-chat') },
        { label: 'Assistant settings', click: () => activeTab('ai-settings') },
        { label: 'Files — reports and chats', click: () => activeTab('files') },
        { type: 'separator' },
        { label: 'Inspector', accelerator: 'F12', click: () => activeTab('inspector') },
        { label: 'Inspect element', accelerator: 'CmdOrCtrl+Shift+C', click: () => activeTab('inspect-element') },
        { type: 'separator' },
        { label: 'Next tab', accelerator: 'CmdOrCtrl+Tab', click: () => activeTab('next-tab') },
        { label: 'Previous tab', accelerator: 'CmdOrCtrl+Shift+Tab', click: () => activeTab('prev-tab') },
        { type: 'separator' },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
          label: `Go to tab ${n}`, accelerator: `CmdOrCtrl+${n}`,
          click: () => activeTab(`tab-${n - 1}`),
        })),
        { label: 'Go to last tab', accelerator: 'CmdOrCtrl+9', click: () => activeTab('tab-last') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

module.exports = { buildAppMenu };
