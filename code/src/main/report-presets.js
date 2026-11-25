// Ready-made report kinds, ported from the reference set.
//
// Each preset tells the model what to put where and picks one of the closed
// themes; the renderer still owns every pixel. The first three are the
// primary choices shown in the composer; the rest live under "More".
'use strict';

const REPORT_PRESETS = [
  {
    id: 'standard',
    name: 'Standard report',
    description: 'The default shape — answer first, then sections and evidence',
    icon: 'file-text',
    theme: 'clean',
    primary: true,
    shape: 'Open with a callout giving the answer in two sentences. Then at least two numbered sections with one idea each, evidence as a table, stats or timeline where the material supports it, and a short what-to-do-next section. Never ask the person to pick a kind or style first — this shape is the default, and restyling or revisions happen afterwards in the report view.',
  },
  {
    id: 'brief',
    name: 'Research brief',
    description: 'What it is, what matters, and what to read next',
    icon: 'book-open',
    theme: 'clean',
    primary: true,
    shape: 'Open with a callout giving the answer in two sentences. Add stats for up to four real figures, sections for background, key findings and open questions, a table only if the material compares things, and finish with what to look into next.',
  },
  {
    id: 'executive',
    name: 'Executive summary',
    description: 'One page for someone with five minutes',
    icon: 'briefcase',
    theme: 'brief',
    primary: true,
    shape: 'Keep it under 400 words. Start with a callout holding the bottom line, stats for the headline numbers, then three short sections: situation, what it means, and recommended actions as an ordered list.',
  },
  {
    id: 'comparison',
    name: 'Comparison',
    description: 'Options side by side, with a verdict',
    icon: 'columns-3',
    theme: 'modern',
    primary: true,
    shape: 'Put the options in a table, one column each, with rows for the criteria that matter. Add a cards block with one card per option saying who it suits, and end with a callout naming the best choice and why.',
  },
  {
    id: 'proscons',
    name: 'Pros and cons',
    description: 'The trade-offs, weighed up',
    icon: 'scale',
    theme: 'clean',
    shape: 'Start with one paragraph framing the decision, then a proscons block, then a short section on what would change the answer, and a callout with a balanced conclusion.',
  },
  {
    id: 'decision',
    name: 'Decision memo',
    description: 'Options, risks and a recommendation',
    icon: 'signpost',
    theme: 'brief',
    shape: 'Sections: the decision to make, options as cards, risks as a table with likelihood and impact columns, and the recommendation as a callout followed by next steps.',
  },
  {
    id: 'swot',
    name: 'SWOT analysis',
    description: 'Strengths, weaknesses, opportunities and threats',
    icon: 'layout-grid',
    theme: 'modern',
    shape: 'Open with a short paragraph of context. Then a cards block with exactly four cards titled Strengths, Weaknesses, Opportunities and Threats, each holding two or three short points in one sentence each. End with a section on what to do about it.',
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'How it unfolded, in order',
    icon: 'history',
    theme: 'editorial',
    shape: 'A short introduction, then a timeline block with the events in order, then sections on turning points and what came after. Only use dates that the material or well-known history supports.',
  },
  {
    id: 'howto',
    name: 'How-to guide',
    description: 'Clear steps from start to finish',
    icon: 'list-checks',
    theme: 'modern',
    shape: 'Begin with a callout listing what you need first. Then a steps block with each step as a short title and a sentence or two. Finish with a section of common problems and fixes.',
  },
  {
    id: 'study',
    name: 'Study notes',
    description: 'Key ideas, terms and questions to test yourself',
    icon: 'graduation-cap',
    theme: 'notebook',
    shape: 'Sections: the big idea in a callout, key concepts as cards, a table of terms and definitions, and a final ordered list of practice questions.',
  },
  {
    id: 'literature',
    name: 'Literature review',
    description: 'What the sources say, and where they disagree',
    icon: 'library',
    theme: 'academic',
    shape: 'An introduction stating the question, one section per source or camp with its claim and evidence, a table comparing positions, a section on where they disagree, and a references list drawn only from sources actually provided or read.',
  },
];

// Preset lookup that never fails the request: an unknown or missing id
// resolves to the standard preset, so a model that names a preset loosely
// ("standard", "summary", …) still produces a report instead of an error.
function findPreset(id) {
  const wanted = String(id || '').trim().toLowerCase();
  const list = REPORT_PRESETS;
  if (wanted) {
    const exact = list.find((p) => p.id === wanted);
    if (exact) return exact;
    const byName = list.find((p) => String(p.name || '').toLowerCase() === wanted);
    if (byName) return byName;
  }
  return list.find((p) => p.id === 'standard') || null;
}

module.exports = { REPORT_PRESETS, findPreset };
