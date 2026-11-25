// Dexerion AI skill loop — proposal -> consent -> execution -> result, driven
// against a chat turn function.
//
// Pure orchestration: no Electron, no network, no filesystem. Dependencies are
// injected: `turn` streams one model reply, `ask` resolves consent for tier >= 1
// skills (the approvals queue lives in the caller), `dispatch` runs the
// executor, `emit` paints events into the conversation and `record` writes the
// audit row. Everything a skill needs beyond this module is the caller's job.
'use strict';

const skills = require('./ai-skills');

const DEFAULT_MAX_SKILLS = 3;   // executed skills per message
const MAX_ERRORS = 1;           // one "that request was invalid" retry
const MAX_WRITE_RETRIES = 1;    // one nudge if an armed artifact never lands
// Only these skills create a new deliverable. export_report also uses the
// "report" executor tag, but it must never be treated as a new report build.
const CREATION_SKILLS = new Set(['make_report', 'make_site']);

function preview(value) {
  try { return JSON.stringify(value || {}).slice(0, 200); } catch { return ''; }
}

// How a skill outcome re-enters the transcript. Native tool calls keep the
// wire shape (assistant turn + tool turn); fence proposals get a marked user
// note so the model hears the result without a fabricated assistant voice.
function appendOutcome(chat, reply, proposal, via, callId, content) {
  if (via === 'tool' && callId) {
    chat.push({
      role: 'assistant',
      text: skills.visibleText(String(reply && reply.text || '')),
      toolCalls: [{ id: callId, name: proposal.skill, input: proposal.args }],
    });
    chat.push({ role: 'tool', results: [{ id: callId, name: proposal.skill, content }] });
    return;
  }
  chat.push({ role: 'user', text: content });
}

function createSkillLoop(deps) {
  const config = deps || {};
  const turn = config.turn;
  const ask = typeof config.ask === 'function' ? config.ask : async () => ({ allow: true, scope: 'auto' });
  const dispatch = config.dispatch;
  const emit = typeof config.emit === 'function' ? config.emit : () => {};
  const record = typeof config.record === 'function' ? config.record : () => {};
  // Deterministic intent routing: an optional callback that can force one
  // skill proposal (e.g. make_site for an unambiguous website request) even
  // when the model failed to propose it. Runs at most once per message.
  const forceSkill = typeof config.forceSkill === 'function' ? config.forceSkill : null;
  const maxSkills = Number.isFinite(config.maxSkills) && config.maxSkills > 0
    ? Math.floor(config.maxSkills) : DEFAULT_MAX_SKILLS;
  const now = typeof config.now === 'function' ? config.now : Date.now;

  if (typeof turn !== 'function' || typeof dispatch !== 'function') {
    throw new Error('The skill loop needs turn and dispatch functions.');
  }

  // One model reply can carry more than one proposal (a fence followed by a
  // raw tool call), so each one gets its own consent step before the next
  // model turn.
  async function run(messages, opts) {
    const options = opts || {};
    const onDelta = typeof options.onDelta === 'function' ? options.onDelta : null;
    const paint = onDelta ? (delta, full) => onDelta(delta, skills.visibleText(full)) : undefined;
    const normalizeArtifact = typeof config.normalizeArtifact === 'function'
      ? config.normalizeArtifact : (artifact) => artifact;
    const chat = Array.isArray(messages) ? messages.slice() : [];
    const used = [];
    let errors = 0;
    let visible = '';
    let last = null;
    // Once a report skill runs, the turns that follow are writing the
    // deliverable: they carry the artifact treatment (and the main process
    // turns a fence-less markdown reply into the report card).
    let artifactTurn = false;
    // The newest artifact seen across the loop's turns: an artifact produced
    // on a turn that also proposed a skill must not be lost when the loop
    // continues to the next turn.
    let bestArtifact = null;
    let forcedDone = false;
    // Three research skills is the budget, but the final make_report/make_site
    // proposal is the deliverable the person asked for. It still gets one run,
    // then one tool-free turn to write the artifact.
    let finalTurn = false;
    let budgetNoteAdded = false;
    let creationsUsed = 0;
    // Retries are allowed after a failed build, but a successful report/site
    // must never be built twice in the same message. This also stops a model
    // that repeats the same raw tool call from adding extra step rows.
    const successfulCreations = new Set();
    // A creation skill arms a deliverable write turn. If the model answers
    // that turn with prose instead of the artifact, nudge it once in the same
    // run rather than leaving the person with a report that never arrived.
    let pendingCreation = null;
    let writeRetries = 0;
    const retryPendingCreation = (raw) => {
      if (!pendingCreation || bestArtifact || writeRetries >= MAX_WRITE_RETRIES) return false;
      writeRetries += 1;
      const args = pendingCreation.args || {};
      const theme = String(args.theme || '').trim();
      const shape = String(args.shape || '').trim();
      const bits = [
        '<skill-note>The report request was approved, but no dex-artifact block was written. Write it now — this is still the same report run.',
        'Output one ```dex-artifact fence containing valid JSON with kind "report", a title and a blocks array. Do not call make_report again, do not ask a question, and do not describe the report in prose.',
      ];
      if (theme) bits.push('Theme: ' + theme + '.');
      if (shape) bits.push('Document shape: ' + shape.slice(0, 600) + '.');
      bits.push('</skill-note>');
      chat.push({ role: 'user', text: bits.join(' ') });
      visible = skills.visibleText(raw);
      return true;
    };
    let queued = [];
    const withBest = (reply) => (reply && !reply.artifact && bestArtifact)
      ? { ...reply, artifact: bestArtifact }
      : reply;
    const finish = (reply, text) => ({
      ok: true,
      cancelled: false,
      text: typeof text === 'string' ? text : visible,
      skills: used,
      last: withBest(reply),
    });

    for (;;) {
      let reply = null;
      let raw = '';
      let proposal = null;
      let via = '';
      let callId = '';
      let directArtifact = null;
      let autoApprove = false;

      if (queued.length) {
        const entry = queued.shift();
        reply = entry.reply;
        raw = entry.raw;
        proposal = entry.proposal;
        // Queued text/tool calls travel as an ordinary note: the model has
        // already had one assistant turn for this reply, and a second one with
        // the same raw text confuses native tool-call providers.
        via = entry.via === 'tool' ? 'fence' : entry.via;
        directArtifact = entry.directArtifact || null;
        visible = skills.visibleText(raw);
      } else {
        reply = await turn(chat, paint, { final: finalTurn, artifact: artifactTurn });
        last = reply || null;
        if (reply && reply.artifact && typeof reply.artifact === 'object') {
          bestArtifact = reply.artifact;
          pendingCreation = null;
        }
        if (reply && reply.cancelled) return { ok: true, cancelled: true, text: '', skills: used, last: reply };
        raw = String(reply && reply.text || '');
        visible = skills.visibleText(raw);

        // Native tool calls keep priority. Text proposals from the same reply
        // are queued so none of them is silently dropped.
        const calls = Array.isArray(reply && reply.toolCalls) ? reply.toolCalls : [];
        for (const call of calls) {
          const parsedCall = skills.proposalFromToolCall(call);
          if (parsedCall) { proposal = parsedCall; via = 'tool'; callId = String(call && call.id || ''); break; }
        }
        const entries = typeof skills.parseProposals === 'function'
          ? skills.parseProposals(raw)
          : [];
        const valid = entries.filter((entry) => entry.proposal);
        queued = valid.map((entry) => ({ ...entry, reply, raw }));
        if (!proposal && valid.length) {
          const first = queued.shift();
          proposal = first.proposal;
          via = first.via === 'tool' ? 'fence' : first.via;
          directArtifact = first.directArtifact || null;
        } else if (!proposal) {
          const bad = entries.find((entry) => entry.error || entry.pending);
          if (bad) {
            // Malformed or unknown request: the model hears the reason once.
            if (errors >= MAX_ERRORS) return finish(reply, visible);
            errors += 1;
            record({ skill: '', decision: 'invalid', ok: false, ms: 0, args: '' });
            emit({ type: 'skill-error', error: bad.error || 'The skill request was not closed.' });
            chat.push({ role: 'user', text: '<skill-note>Your skill request was not used: ' + (bad.error || 'it was not closed') + ' Continue without it, or fix it and try once more.</skill-note>' });
            continue;
          }
          if (calls.length) {
            // Tool calls came through but none mapped to a ready skill.
            if (errors >= MAX_ERRORS) return finish(reply, visible);
            errors += 1;
            record({ skill: '', decision: 'invalid', ok: false, ms: 0, args: '' });
            const why = calls[0] && calls[0].parseError ? calls[0].parseError : 'the arguments did not match the skill';
            emit({ type: 'skill-error', error: why });
            chat.push({ role: 'user', text: '<skill-note>The skill call was not used (' + why + '). Continue without it, or fix it and try once more.</skill-note>' });
            continue;
          }
        }

        // Deterministic intent routing: when the person explicitly asked for a
        // website (or an AI edit of one), that skill is pre-authorised. If the
        // model proposed it, keep its rich args and skip the redundant consent
        // card; if the model failed to propose it, inject the skill ourselves.
        // Any artifact from a non-compliant turn is a proposal-shaped report,
        // not the deliverable, so discard it in that case.
        if (forceSkill && !forcedDone && !bestArtifact) {
          let intent = null;
          try { intent = forceSkill(chat) || null; } catch {}
          if (intent && skills.skillOf(intent.skill)) {
            if (proposal && proposal.skill === intent.skill) {
              // The model complied: pre-authorise this exact call and keep its
              // title/description/pages instead of replacing them with blanks.
              autoApprove = intent.autoApprove !== false;
              forcedDone = true;
              if (!proposal.args || !Object.keys(proposal.args).length) proposal.args = intent.args || {};
            } else if (!proposal) {
              proposal = { skill: intent.skill, args: intent.args || {}, why: intent.why || '' };
              via = 'forced';
              callId = '';
              autoApprove = intent.autoApprove !== false;
              forcedDone = true;
              queued = [];
              bestArtifact = null;
              visible = 'Building it now…';
            }
          }
        }
      }

      if (!proposal) {
        if (retryPendingCreation(raw)) continue;
        return finish(reply, visible);
      }

      const skill = skills.skillOf(proposal.skill);
      const creation = skill && CREATION_SKILLS.has(skill.id);
      // A repeated proposal after a completed build is ignored. It may be a
      // raw-call duplicate or the model trying to "make" the report again
      // after it was already written; either way the artifact is already here.
      if (creation && successfulCreations.has(skill.id)) {
        visible = skills.visibleText(raw);
        if (queued.length) continue;
        if (retryPendingCreation(raw)) continue;
        return finish(reply, visible);
      }
      // After the budget note the answer must land. A final deliverable is the
      // one exception: the user asked for it, and skipping it is what produced
      // the raw <tool_call> leak. Anything else is answered without a new run.
      if (finalTurn && (!creation || creationsUsed >= 1)) return finish(reply, visible);
      const started = now();
      let allow = true;
      let scope = 'auto';
      if (autoApprove) {
        // The person explicitly asked for this website action, so the
        // deterministic route is pre-authorised - no extra consent card.
        allow = true;
        scope = 'auto';
      } else if (skill.tier > 0) {
        const decision = await ask({ skill: skill.id, args: proposal.args, why: proposal.why, tier: skill.tier });
        allow = Boolean(decision && decision.allow);
        scope = (decision && decision.scope) || (allow ? 'once' : 'deny');
      }

      if (!allow) {
        const decisionName = scope === 'timeout' ? 'timeout' : 'deny';
        used.push({ skill: skill.id, ok: false, decision: decisionName, via });
        record({ skill: skill.id, decision: decisionName, ok: false, ms: now() - started, args: preview(proposal.args) });
        emit({ type: 'skill-denied', skill: skill.id, label: skill.name, decision: decisionName });
        appendOutcome(chat, reply, proposal, via, callId,
          '<skill-denied skill="' + skill.id + '">The person declined this skill. Continue without it and say what was not done.</skill-denied>');
        continue;
      }

      emit({ type: 'skill-run', skill: skill.id, label: skill.name, args: proposal.args, why: proposal.why });

      // Nemotron sometimes sends the finished artifact as the tool payload.
      // Normalize it directly instead of arming a second write turn.
      let directOk = false;
      if (directArtifact) {
        try {
          const normalized = normalizeArtifact(directArtifact);
          if (normalized && normalized.ok && normalized.artifact) {
            bestArtifact = normalized.artifact;
            directOk = true;
          }
        } catch { directOk = false; }
      }

      let outcome = null;
      if (!directOk) {
        try {
          outcome = await dispatch({ skill: skill.id, args: proposal.args });
        } catch (err) {
          outcome = { ok: false, error: String(err && err.message ? err.message : err) };
        }
        outcome = (outcome && typeof outcome === 'object') ? outcome : { ok: true };
      } else {
        outcome = { ok: true, result: 'The report was supplied with the request.', summary: 'Report built' };
      }
      const ok = outcome.ok !== false;
      if (ok && creation) {
        artifactTurn = true;
        creationsUsed += 1;
        successfulCreations.add(skill.id);
        pendingCreation = directOk ? null : { skill: skill.id, args: proposal.args || {} };
      }
      const ms = now() - started;
      used.push({ skill: skill.id, ok, decision: skill.tier === 0 ? 'auto' : (scope === 'always' ? 'always' : 'once'), via, ms });
      record({
        skill: skill.id,
        decision: skill.tier === 0 ? 'auto' : (scope === 'always' ? 'always' : 'once'),
        ok,
        ms,
        args: preview(proposal.args),
      });
      emit({
        type: 'skill-result',
        skill: skill.id,
        label: skill.name,
        ok,
        ms,
        summary: String(outcome.summary || '').slice(0, 300),
        error: ok ? '' : String(outcome.error || 'The skill failed.').slice(0, 500),
      });

      if (directOk && ok) {
        if (!queued.length) return finish(reply, visible);
        continue;
      }

      const content = ok
        ? '<skill-result skill="' + skill.id + '">\n' + String(outcome.result || '').slice(0, 30000) + '\n</skill-result>'
        : '<skill-error skill="' + skill.id + '">The skill failed: ' + String(outcome.error || 'unknown error').slice(0, 500) + '</skill-error>';
      // Deliverable arming instructions must come back as an ordinary user
      // message. Nemotron answers reliably to that shape; a trailing
      // `role: tool` message makes this model return an empty write turn.
      const plainOutcome = creation || skill.id === 'revise_artifact' || skill.id === 'edit_document';
      appendOutcome(chat, reply, proposal, plainOutcome ? 'fence' : via, callId, content);
      // Vision is the one skill whose evidence is an image. Feed it back in the
      // same shape agent screenshot results use, so a vision-capable Nemotron
      // can actually see the capture instead of a data-URL string.
      if (ok && Array.isArray(outcome.images) && outcome.images.length) {
        chat.push({
          role: 'user',
          text: '(screenshot for ' + skill.id + ')',
          images: outcome.images.map(img => ({ name: String(img.name || 'screenshot'), url: String(img.url || '') })),
        });
      }

      if (used.length >= maxSkills && !budgetNoteAdded && !artifactTurn && !queued.length) {
        // Research budget reached. Stop offering tools, but let the next turn
        // propose the final report/site deliverable instead of leaking a raw
        // tool call or answering with findings the person asked to package.
        budgetNoteAdded = true;
        finalTurn = true;
        chat.push({ role: 'user', text: '<skill-note>No more research skills can run for this message. If the person asked for a report, propose make_report now; otherwise answer with the results you have.</skill-note>' });
      }
    }
  }

  return { run, maxSkills };
}

module.exports = { createSkillLoop, DEFAULT_MAX_SKILLS, MAX_ERRORS };
