// Dexerion AI markdown — one shared filter for every surface that shows
// model replies (sidebar, new tab). Model text only ever enters the DOM via
// textContent; the only elements created are our own. No innerHTML anywhere,
// so a reply can never inject markup, scripts, or javascript: links.
//
// Pure core (inlineTokens/blocks) has no DOM access and is unit-tested in
// scripts/test-ai.js. render() needs only el.ownerDocument.
const DexMarkdown = (() => {
  // Split a run of text into inline tokens. Bold is tried before italic so
  // **x** never degrades into *x*, and code spans win over everything.
  // Links allow http(s)/mailto only — anything else stays plain text.
  // Single-char emphasis needs non-word boundaries so 2*3*4 and snake_case
  // stay literal; **bold** may sit mid-word. Math ($..$/$$..$$) is matched
  // before emphasis so $\sin(x)$ never degrades into italics.
  const INLINE = /(`[^`\n]+`)|(\$\$.+?\$\$)|(\\\([^()\n]+\\\))|(\\\[.+?\\\])|(\$(?=\S)(?:[^$\n]*?\S)?\$(?!\w))|(\*\*.+?\*\*)|((?<!\w)__.+?__(?!\w))|((?<!\w)\*(?=\S)(?:[^*\n]*?\S)?\*(?!\w))|((?<!\w)_(?=\S)(?:[^_\n]*?\S)?_(?!\w))|(\[([^\]\n]+)\]\(([^)\s]+)\))|(<sup>([\s\S]*?)<\/sup>)|(<sub>([\s\S]*?)<\/sub>)/g;

  // Raw HTML in model output: <sup>/<sub> become real elements; every other
  // tag is dropped (its text kept) so nothing like <span class="x"> or a stray
  // <br> ever shows as code. Comparisons like "2 < 3" never match (a tag needs
  // a name and a closing ">").
  function stripForeignTags(value) {
    return String(value ?? '').replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?>/g,
      (all, _close, name) => (/^(sup|sub)$/i.test(name) ? all : ''));
  }

  // Small TeX → Unicode pass so $…$ math reads as math instead of source
  // code. Conservative: known commands map, \text{…}/\mathrm{…} unwrap,
  // \frac{A}{B} becomes A⁄B, single-char ^/_ map to super/subscripts.
  // Anything unrecognized stays literal (backslash included).
  const TEX = {
    theta: 'θ', Theta: 'Θ', alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ',
    Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', mu: 'μ', nu: 'ν',
    xi: 'ξ', Xi: 'Ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
    phi: 'φ', varphi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω',
    infty: '∞', inf: '∞', times: '×', cdot: '·', pm: '±', mp: '∓', le: '≤', ge: '≥',
    leq: '≤', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼',
    rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔', to: '→',
    circ: '°', deg: '°', perp: '⊥', partial: '∂', ell: 'ℓ', forall: '∀', exists: '∃',
    in: '∈', notin: '∉', subset: '⊂', cap: '∩', cup: '∪', wedge: '∧', vee: '∨',
    neg: '¬', lnot: '¬', prime: '′', cdots: '⋯', ldots: '…', dots: '…',
    sin: 'sin', cos: 'cos', tan: 'tan', csc: 'csc', sec: 'sec', cot: 'cot',
    log: 'log', ln: 'ln', exp: 'exp', min: 'min', max: 'max', det: 'det',
  };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', o: 'ᵒ' };
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ' };
  function texToText(input) {
    let s = String(input ?? '');
    // Degree shorthand first: 30^\circ / 30^{\circ} → 30°.
    s = s.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°');
    // \text{…}, \mathrm{…}, \textbf{…} → inner (recursively transformed)
    for (let i = 0; i < 4; i++) {
      const next = s.replace(/\\(?:text|mathrm|mathbf|mathit|boldsymbol)\{([^{}]*)\}/g, (_, inner) => texToText(inner));
      if (next === s) break;
      s = next;
    }
    // \frac{A}{B} → A⁄B
    for (let i = 0; i < 4; i++) {
      const next = s.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => texToText(a) + '⁄' + texToText(b));
      if (next === s) break;
      s = next;
    }
    s = s.replace(/\\([A-Za-z]+)/g, (m, name) => (name in TEX ? TEX[name] : m));
    s = s.replace(/\^\{([^{}]+)\}/g, (_, inner) => {
      if ([...inner].every((ch) => ch in SUP)) return [...inner].map((ch) => SUP[ch]).join('');
      return '^(' + inner + ')';
    });
    s = s.replace(/\^(\S)/g, (_, ch) => (ch in SUP ? SUP[ch] : '^' + ch));
    s = s.replace(/_\{([^{}]+)\}/g, (_, inner) => {
      if ([...inner].every((ch) => ch in SUB)) return [...inner].map((ch) => SUB[ch]).join('');
      return '_(' + inner + ')';
    });
    s = s.replace(/_([0-9a-z+\-=()])/g, (_, ch) => (ch in SUB ? SUB[ch] : '_' + ch));
    return s;
  }

  function inlineTokens(input) {
    const s = stripForeignTags(input);
    const out = [];
    let last = 0, m;
    INLINE.lastIndex = 0;
    while ((m = INLINE.exec(s))) {
      if (m.index > last) out.push({ k: 't', s: s.slice(last, m.index) });
      last = m.index + m[0].length;
      if (m[1] !== undefined) out.push({ k: 'code', s: m[1].slice(1, -1) });
      else if (m[2] !== undefined) out.push({ k: 'math', block: true, s: texToText(m[2].slice(2, -2)) });
      else if (m[3] !== undefined) out.push({ k: 'math', block: false, s: texToText(m[3].slice(2, -2)) });
      else if (m[4] !== undefined) out.push({ k: 'math', block: true, s: texToText(m[4].slice(2, -2)) });
      else if (m[5] !== undefined) out.push({ k: 'math', block: false, s: texToText(m[5].slice(1, -1)) });
      else if (m[6] !== undefined) out.push({ k: 'b', s: m[6].slice(2, -2) });
      else if (m[7] !== undefined) out.push({ k: 'b', s: m[7].slice(2, -2) });
      else if (m[8] !== undefined) out.push({ k: 'i', s: m[8].slice(1, -1) });
      else if (m[9] !== undefined) out.push({ k: 'i', s: m[9].slice(1, -1) });
      else if (m[14] !== undefined) out.push({ k: 'sup', s: m[14] });
      else if (m[16] !== undefined) out.push({ k: 'sub', s: m[16] });
      else {
        const href = m[12] || '';
        if (/^(https?:|mailto:)/i.test(href)) out.push({ k: 'a', text: m[11], href });
        else out.push({ k: 't', s: m[0] });
      }
    }
    if (last < s.length) out.push({ k: 't', s: s.slice(last) });
    return out;
  }

  // Split a reply into blocks. Code fences first (tabs/spaces inside code are
  // never list items), then headings, rules, lists, paragraphs.
  function blocks(input) {
    const out = [];
    const parts = String(input ?? '').split('```');
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const nl = part.indexOf('\n');
        let lang = '', code = part;
        if (nl >= 0) {
          const maybe = part.slice(0, nl).trim();
          if (/^[A-Za-z0-9+#-]+$/.test(maybe)) { lang = maybe; code = part.slice(nl + 1); }
        }
        out.push({ k: 'code', lang, text: code.replace(/\n$/, '') });
        return;
      }
      let list = null;
      const lines = part.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li].replace(/\s+$/, '');
        let m;
        if ((m = /^(#{1,4})\s+(.*?)\s*$/.exec(line))) {
          list = null;
          out.push({ k: 'h', level: m[1].length, text: m[2] });
          continue;
        }
        if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) { list = null; out.push({ k: 'hr' }); continue; }
        // Display math standing alone on its line renders centered.
        if ((m = /^\$\$(.+)\$\$$/.exec(line) || /^\\\[(.+)\\\]$/.exec(line))) {
          list = null;
          out.push({ k: 'math', block: true, s: texToText(m[1]) });
          continue;
        }
        // Table: header row + :--- separator row + body rows.
        if ((m = /^\|(.+)\|$/.exec(line)) && li + 1 < lines.length
            && /^\|[\s:|.-]+\|$/.test(lines[li + 1].trim()) && /-/.test(lines[li + 1])) {
          list = null;
          const head = splitRow(m[1]);
          const aligns = splitRow(lines[li + 1].trim().slice(1, -1)).map(cellAlign);
          const rows = [];
          li += 2;
          while (li < lines.length && /^\|.*\|$/.test(lines[li].trim())) {
            rows.push(splitRow(lines[li].trim().replace(/^\||\|$/g, '')));
            li++;
          }
          li--;
          out.push({ k: 'table', head, aligns, rows });
          continue;
        }
        if ((m = /^\s*[-*+]\s+(.*\S)\s*$/.exec(line))) {
          if (!list || list.k !== 'ul') { list = { k: 'ul', items: [] }; out.push(list); }
          list.items.push(m[1]);
          continue;
        }
        if ((m = /^\s*\d{1,3}[.)]\s+(.*\S)\s*$/.exec(line))) {
          if (!list || list.k !== 'ol') { list = { k: 'ol', items: [] }; out.push(list); }
          list.items.push(m[1]);
          continue;
        }
        list = null;
        if (!line.trim()) continue;
        out.push({ k: 'p', text: line.trim() });
      }
    });
    return out;
  }

  function splitRow(inner) {
    return inner.split('|').map((c) => c.trim());
  }
  function cellAlign(cell) {
    const c = cell.trim();
    if (/^:.+:$/.test(c)) return 'center';
    if (/:$/.test(c)) return 'right';
    return 'left';
  }

  function inlineInto(doc, parent, text, opts) {
    for (const t of inlineTokens(text)) {
      if (t.k === 't') parent.appendChild(doc.createTextNode(t.s));
      else if (t.k === 'code') {
        const c = doc.createElement('code');
        c.textContent = t.s;
        parent.appendChild(c);
      } else if (t.k === 'b' || t.k === 'i') {
        const e = doc.createElement(t.k === 'b' ? 'strong' : 'em');
        inlineInto(doc, e, t.s, opts); // nested emphasis terminates: markers shrink
        parent.appendChild(e);
      } else if (t.k === 'math') {
        const s = doc.createElement(t.block ? 'div' : 'span');
        s.className = t.block ? 'md-math-block' : 'md-math';
        s.textContent = t.s;
        parent.appendChild(s);
      } else if (t.k === 'sup' || t.k === 'sub') {
        const e = doc.createElement(t.k);
        e.textContent = t.s;
        parent.appendChild(e);
      } else if (t.k === 'a') {
        const a = doc.createElement('a');
        a.className = 'md-a';
        a.textContent = t.text;
        a.setAttribute('href', t.href);
        if (opts && opts.onLink) {
          const href = t.href;
          a.addEventListener('click', (ev) => { ev.preventDefault(); opts.onLink(href); });
        }
        parent.appendChild(a);
      }
    }
  }

  function render(el, text, opts) {
    const doc = el.ownerDocument;
    el.replaceChildren();
    for (const b of blocks(text)) {
      if (b.k === 'code') {
        const pre = doc.createElement('pre');
        const code = doc.createElement('code');
        if (b.lang) code.setAttribute('data-lang', b.lang);
        code.textContent = b.text;
        pre.appendChild(code);
        el.appendChild(pre);
      } else if (b.k === 'h') {
        const h = doc.createElement('h' + Math.min(4, b.level));
        h.className = 'md-h';
        inlineInto(doc, h, b.text, opts);
        el.appendChild(h);
      } else if (b.k === 'ul' || b.k === 'ol') {
        const list = doc.createElement(b.k);
        list.className = b.k === 'ul' ? 'md-ul' : 'md-ol';
        for (const item of b.items) {
          const li = doc.createElement('li');
          inlineInto(doc, li, item, opts);
          list.appendChild(li);
        }
        el.appendChild(list);
      } else if (b.k === 'hr') {
        const hr = doc.createElement('hr');
        hr.className = 'md-hr';
        el.appendChild(hr);
      } else if (b.k === 'table') {
        // The wrapper mirrors the structured .dxa-table-wrap so a wide table
        // scrolls instead of clipping. ai-artifacts.css (loaded by every
        // surface, unlike shell.css) styles the grid and header.
        const tableWrap = doc.createElement('div');
        tableWrap.className = 'md-table-wrap';
        const table = doc.createElement('table');
        table.className = 'md-table';
        const thead = doc.createElement('thead');
        const hrw = doc.createElement('tr');
        b.head.forEach((cell, i) => {
          const th = doc.createElement('th');
          th.style.textAlign = b.aligns[i] || 'left';
          inlineInto(doc, th, cell, opts);
          hrw.appendChild(th);
        });
        thead.appendChild(hrw);
        table.appendChild(thead);
        const tbody = doc.createElement('tbody');
        for (const row of b.rows) {
          const tr = doc.createElement('tr');
          row.forEach((cell, i) => {
            const td = doc.createElement('td');
            td.style.textAlign = b.aligns[i] || 'left';
            inlineInto(doc, td, cell, opts);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        el.appendChild(tableWrap);
      } else if (b.k === 'math') {
        const div = doc.createElement('div');
        div.className = 'md-math-block';
        div.textContent = b.s;
        el.appendChild(div);
      } else {
        const p = doc.createElement('div');
        p.className = 'md-p';
        inlineInto(doc, p, b.text, opts);
        el.appendChild(p);
      }
    }
  }

  return { inlineTokens, blocks, render, texToText };
})();

if (typeof window !== 'undefined') window.DexMarkdown = DexMarkdown;
if (typeof module !== 'undefined' && module.exports) module.exports = DexMarkdown;
