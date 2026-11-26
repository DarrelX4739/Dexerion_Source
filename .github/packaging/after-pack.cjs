'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Run after Electron has been packaged, before AppImage/deb creation. Only the
// Linux launch entry point changes; no application source or ASAR is patched.
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const executableName = context.packager.config.linux.executableName;
  if (executableName !== 'dexerion') {
    throw new Error('Linux launcher requires executableName: dexerion');
  }
  const entry = path.join(context.appOutDir, executableName);
  const binary = path.join(context.appOutDir, 'dexerion-bin');
  try {
    await fs.access(binary);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.rename(entry, binary);
    await fs.copyFile(path.join(__dirname, 'linux-launcher.sh'), entry);
    await fs.chmod(entry, 0o755);
    return;
  }
  throw new Error('Refusing to overwrite an existing dexerion-bin');
};
