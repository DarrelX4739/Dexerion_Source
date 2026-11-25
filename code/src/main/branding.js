// Dexerion branding module — single place to reskin later.
const path = require('path');

const BRAND = {
  name: 'Dexerion',
  tagline: 'A real browser, from scratch.',
  // Supplied logo (do not replace with Chrome branding).
  logoPng: path.join(__dirname, '../../assets/logo.png'),
  searchPlaceholder: 'Search Dexerion or type a URL',
  newTabTitle: 'New Tab — Dexerion',
  aboutText: 'Dexerion V1 — standalone Chromium-based desktop browser.',
};

module.exports = { BRAND };
