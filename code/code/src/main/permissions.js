// Permission architecture for future Dexerion AI systems (Assist, Agent, Vision,
// Research, Memory, Focus). V1 wires nothing to AI — this registry exists so future
// systems request capabilities through controlled APIs instead of touching UI state.
// Default-deny: every capability must be explicitly granted per origin/actor.
const PERMISSIONS = [
  'page.read', 'page.selection', 'page.interact',
  'tabs.open', 'tabs.navigate', 'tabs.close',
  'downloads.start', 'screen.read', 'browser.control',
];

class DexPermissions {
  constructor(profile) {
    this.profile = profile;
    if (!profile.data.grants) profile.data.grants = {};
  }
  check(actor, perm) {
    if (!PERMISSIONS.includes(perm)) return false;
    return Boolean(this.profile.data.grants[actor + ':' + perm]);
  }
  request(actor, perm) {
    // V1: no AI actor exists; record the request as denied-by-default.
    return { actor, permission: perm, granted: this.check(actor, perm) };
  }
  grant(actor, perm) {
    if (!PERMISSIONS.includes(perm)) throw new Error('unknown permission ' + perm);
    this.profile.data.grants[actor + ':' + perm] = Date.now();
    this.profile.saveSoon();
  }
  revoke(actor, perm) {
    delete this.profile.data.grants[actor + ':' + perm];
    this.profile.saveSoon();
  }
}

module.exports = { DexPermissions, PERMISSIONS };
