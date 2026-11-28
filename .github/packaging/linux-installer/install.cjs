'use strict';

const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const owner = 'Dexerion package installer v1\n';
const marker = '.dexerion-setup';
const desktopName = 'com.dexerion.browser.desktop';
const imageName = 'Dexerion.AppImage';
const iconName = 'Dexerion.png';
const menuOwner = 'X-Dexerion-Setup=1';

function inside(base, candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /[\x00-\x1f\x7f]/.test(candidate)) {
    throw Error('Choose an absolute folder without control characters.');
  }
  const target = path.normalize(candidate);
  const relative = path.relative(base, target);
  if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw Error('Choose a folder inside your home directory.');
  }
  return { target, relative };
}

async function stat(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

// Walk every path component rather than following symlinks belonging to an
// unrelated installation or linking into another user's/system directory.
async function safeDirectory(home, candidate, create = false) {
  const { target, relative } = inside(home, candidate);
  let current = home;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    let info = await stat(current);
    if (!info) {
      if (!create) return null;
      try { await fs.mkdir(current, { mode: 0o755 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      info = await stat(current);
    }
    if (!info?.isDirectory() || info.uid !== process.getuid()) {
      throw Error('Choose a folder that you own and that is not a symbolic link.');
    }
  }
  return target;
}

async function managed(file) {
  const info = await stat(file);
  if (!info) return false;
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) {
    throw Error(`Setup will not replace the existing ${path.basename(file)}.`);
  }
  return true;
}

function desktopValue(value) {
  return value.replaceAll('\\', '\\\\');
}

function desktopCommand(value) {
  // Exec is decoded first as a desktop string and then as a quoted argument.
  return desktopValue('"' + value.replace(/["`$\\]/g, char => '\\' + char).replaceAll('%', '%%') + '"');
}

function desktopEntry(executable, icon) {
  return `[Desktop Entry]
Type=Application
Name=Dexerion
Comment=Dexerion Web Browser
Exec=env APPIMAGE_EXTRACT_AND_RUN=1 ${desktopCommand(executable)} %U
Icon=${desktopValue(icon)}
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
${menuOwner}
`;
}

async function listFolders(home, candidate) {
  let current = inside(home, candidate).target;
  while (!await safeDirectory(home, current)) current = path.dirname(current);
  const directories = (await fs.readdir(current, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !/[\x00-\x1f\x7f]/.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b)).slice(0, 1000);
  return { current, parent: current === home ? null : path.dirname(current),
    folders: directories.map(name => ({ name, path: path.join(current, name) })) };
}

async function publishFile(source, destination, replace) {
  if (replace) await fs.rename(source, destination);
  else await fs.link(source, destination); // Atomic no-clobber publication.
}

async function install({ home, dataHome, destination, payload, logo }) {
  const folder = inside(home, destination).target;
  if (folder === home) throw Error('Choose a dedicated installation folder rather than your home folder.');
  const menuFolder = inside(home, path.join(dataHome, 'applications')).target;
  const toMenu = path.relative(folder, menuFolder);
  const fromMenu = path.relative(menuFolder, folder);
  const fromData = path.relative(dataHome, folder);
  const descends = relative => relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
  if (descends(toMenu) || descends(fromMenu) || descends(fromData)) throw Error('Choose a dedicated Dexerion installation folder outside the application-menu area.');
  const executable = path.join(folder, imageName);
  const icon = path.join(folder, iconName);
  const ownership = path.join(folder, marker);
  const desktop = path.join(menuFolder, desktopName);

  await safeDirectory(home, menuFolder);
  if (await managed(desktop)) {
    const entry = await fs.readFile(desktop, 'utf8');
    if (!entry.split('\n').includes(menuOwner)) throw Error('An unrelated Dexerion application shortcut already exists.');
  }
  const existing = await safeDirectory(home, folder);
  let upgrading = false;
  if (existing) {
    upgrading = await managed(ownership);
    if (upgrading && await fs.readFile(ownership, 'utf8') !== owner) throw Error('Setup cannot identify this Dexerion installation.');
    if (!upgrading && (await fs.readdir(folder)).length) throw Error('Choose an empty folder. Setup will not replace an unrelated installation.');
  }
  const replaceImage = upgrading && await managed(executable);
  const replaceIcon = upgrading && await managed(icon);

  await safeDirectory(home, folder, true);
  const work = await fs.mkdtemp(path.join(folder, '.dexerion-stage-'));
  const created = [];
  try {
    const stagedImage = path.join(work, imageName), stagedIcon = path.join(work, iconName), stagedMarker = path.join(work, marker);
    await fs.copyFile(payload, stagedImage, constants.COPYFILE_EXCL);
    await fs.chmod(stagedImage, 0o755);
    await fs.copyFile(logo, stagedIcon, constants.COPYFILE_EXCL);
    if (!upgrading) await fs.writeFile(stagedMarker, owner, { flag: 'wx' });

    await publishFile(stagedIcon, icon, replaceIcon);
    if (!replaceIcon) created.push(icon);
    if (!upgrading) {
      await publishFile(stagedMarker, ownership, false);
      created.push(ownership);
    }
    await publishFile(stagedImage, executable, replaceImage);
    if (!replaceImage) created.push(executable);
  } catch (error) {
    await Promise.allSettled(created.map(file => fs.unlink(file)));
    throw error;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  let warning = '';
  let menuStage;
  try {
    await safeDirectory(home, menuFolder, true);
    menuStage = await fs.mkdtemp(path.join(menuFolder, '.dexerion-stage-'));
    const staged = path.join(menuStage, desktopName);
    await fs.writeFile(staged, desktopEntry(executable, icon), { flag: 'wx', mode: 0o644 });
    const replace = await managed(desktop);
    if (replace && !(await fs.readFile(desktop, 'utf8')).split('\n').includes(menuOwner)) throw Error('Unrelated shortcut');
    await publishFile(staged, desktop, replace);
  } catch {
    warning = 'Dexerion is installed, but Setup could not add it to the application menu.';
  } finally {
    if (menuStage) await fs.rm(menuStage, { recursive: true, force: true });
  }
  return { executable, warning };
}

module.exports = { desktopEntry, install, inside, listFolders };
