// Deterministic intent routing for website generation.
//
// The model is asked to propose the `make_site` skill before it writes a site.
// Nemotron sometimes ignores that protocol and answers with a report that
// merely *describes* the site ("Shall I go ahead?"), so nothing is built. This
// module reads the person's own words and, on an unambiguous website request,
// produces the skill proposal that the skill loop should run regardless. It is
// pure (no Electron, no network) so it can be unit-tested directly.
'use strict';

// A site noun must be present for a creation request - "make it blue" must
// never rebuild a site from scratch.
const SITE_NOUN = /\b(web\s?sites?|websites?|web\s?pages?|webpages?|landing\s?pages?|one[-\s]?pagers?|homepages?|html\s?(?:page|site|file)|portfolio|storefront|blog|web\s?app|web\s?application)\b/i;
// Weaker "site/page" on its own: counts for creation only, so a phrase like
// "change the site colour" is still treated as a modification below.
const WEAK_SITE_NOUN = /\b(sites?|pages?)\b/i;
const CREATE_VERB = /\b(build|create|make|generate|design|develop|code|produce|craft|put\s+together|set\s+up|write)\b/i;
// Modification signals for follow-up edits to an existing site artifact.
const MODIFY_SIGNAL = /\b(change|edit|modify|update|tweak|adjust|fix|restyle|redesign|revise|make\s+it|darker|lighter|colour|color|font|remove|add|replace|swap|rename|move|resize|show|hide|different|instead|this|that|it\b|please\b)/i;
const NEW_REQUEST = /\b(new|another|from\s+scratch|fresh|rebuild|start\s+over)\b/i;

// Explicit "use online material" signals only. A plain "build me a site" must
// never open the network: the person has to ask for research, a source, an
// image/photo/design reference or inspiration, or paste an http(s) URL.
const RESEARCH_WORDS = /\b(research(?:ed|ing)?|look\s?up|online|internet|web|source[ds]?|sourced|reference[s]?|inspiration|inspire[ds]?|mood\s?board|image[s]?|photo(?:graph)?s?|picture[s]?|screenshot[s]?|asset[s]?|example[s]?|design\s+reference)\b/i;
const USER_URL = /https?:\/\/[^\s<>"'`]+/i;

// Pure helper: does THIS text explicitly ask for online source material?
// Injected context blocks are stripped so page context cannot force a fetch.
function wantsSiteResearch(text) {
  const own = String(text || '')
    .replace(/<page_context[\s\S]*?<\/page_context>/gi, ' ')
    .replace(/<context[\s\S]*?<\/context>/gi, ' ')
    .replace(/<memory[\s\S]*?<\/memory>/gi, ' ')
    .replace(/<site-research-assets[\s\S]*?<\/site-research-assets>/gi, ' ')
    .replace(/<skill-[^>]*>[\s\S]*?<\/skill-[^>]*>/gi, ' ');
  if (RESEARCH_WORDS.test(own)) return true;
  const m = USER_URL.exec(own);
  if (!m) return false;
  try {
    const u = new URL(m[0].replace(/[.,;:!?)\]}'"]+$/, ''));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// Strip context the app injected so only the person's own words are matched.
function ownText(messages) {
  for (let i = (Array.isArray(messages) ? messages.length : 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      return String(m.text || '')
        .replace(/<page_context[\s\S]*?<\/page_context>/gi, ' ')
        .replace(/<context[\s\S]*?<\/context>/gi, ' ')
        .replace(/<memory[\s\S]*?<\/memory>/gi, ' ')
        .replace(/<skill-[^>]*>[\s\S]*?<\/skill-[^>]*>/gi, ' ')
        .replace(/<skill-note>[\s\S]*?<\/skill-note>/gi, ' ')
        .trim();
    }
  }
  return '';
}

// `currentArtifact` is the newest stored artifact, or null. Returns a forced
// proposal `{ skill, args, why }` or null when the message is not a clear site
// creation / site modification request.
function detectSiteIntent(messages, currentArtifact) {
  const text = ownText(messages);
  if (!text) return null;
  const isSiteArtifact = Boolean(currentArtifact && String(currentArtifact.kind || '') === 'site');

  // A modification of an existing site -> route to the revision skill with the
  // person's own words as the instructions. A fresh request ("build a new
  // site") wins over the modification branch. The site noun must NOT exclude
  // this branch: "Fix the quality issues the website checker found" is both a
  // modification and an explicit "website" mention — excluding it sent every
  // Fix-with-AI repair down the generic skill loop, where it failed or produced
  // prose instead of a repaired site.
  if (isSiteArtifact && MODIFY_SIGNAL.test(text) && !NEW_REQUEST.test(text)) {
    return {
      skill: 'revise_artifact',
      args: { instructions: text.slice(0, 3000) },
      why: 'AI site modification requested',
      forced: true,
    };
  }

  // Explicit creation: an action verb plus a site noun.
  if (CREATE_VERB.test(text) && (SITE_NOUN.test(text) || WEAK_SITE_NOUN.test(text))) {
    return {
      skill: 'make_site',
      args: {},
      why: 'Website generation requested',
      forced: true,
    };
  }
  return null;
}

module.exports = {
  detectSiteIntent, ownText, wantsSiteResearch,
  SITE_NOUN, WEAK_SITE_NOUN, CREATE_VERB, MODIFY_SIGNAL, RESEARCH_WORDS, USER_URL,
};
