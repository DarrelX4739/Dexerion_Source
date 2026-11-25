// Deterministic intent routing for report generation.
//
// Nemotron occasionally writes the make_report call only in its reasoning and
// returns an empty turn. This module recognises an unambiguous request for a
// new report so the skill loop can inject the same proposal the model should
// have made. It is deliberately conservative: website requests, follow-up
// edits, and ordinary questions are left to the normal AI path.
'use strict';

const REPORT_NOUN = /\b(report|brief|document|write[\s-]?up|analysis|overview|study)\b/i;
const CREATE_VERB = /\b(write|make|create|build|produce|generate|draft|prepare|compose|put together|give me)\b/i;
const SITE_NOUN = /\b(website|webpage|web app|site|html|landing page|interactive page)\b/i;
const REVISION = /\b(revise|edit|change|update|rewrite|improve|fix|adjust|shorter|longer|remove|add to|make it)\b/i;
const NEW_REQUEST = /\b(again|fresh|another|new report|from scratch)\b/i;

function ownText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m && m.role === 'user' && String(m.text || '').trim()) return String(m.text).trim();
  }
  return '';
}

function detectReportIntent(messages, currentArtifact) {
  const text = ownText(messages);
  if (!text || text.length > 4000) return null;
  if (SITE_NOUN.test(text)) return null;
  if (!CREATE_VERB.test(text) || !REPORT_NOUN.test(text)) return null;
  // A follow-up to an existing artifact is a revision, not a second report.
  if (currentArtifact && REVISION.test(text) && !NEW_REQUEST.test(text)) return null;
  return {
    skill: 'make_report',
    // Unlike an explicit website build, a report still gets its one consent
    // card. This only replaces a missing model proposal, not the person's OK.
    autoApprove: false,
    args: {
      preset: 'standard',
      theme: 'clean',
      shape: text.slice(0, 1600),
    },
    why: 'You asked for a report',
  };
}

module.exports = { detectReportIntent, ownText };
