// Typed parser/serializer for the Lingo literals used in the game's config:
//   [#name: "Duck", #speed: 2, #terrain: [#normal, #water], #recipe: [#yellow: 5]]
// Nodes: {t:'num', v, raw} {t:'sym', v} {t:'str', v} {t:'list', items}
//        {t:'props', entries: [{key, value}]}
// Works in the browser (window.Lingo) and in Node (require).
(function (exports) {
  'use strict';

  // Parse one literal; with allowTrailing, returns {value, rest} instead of
  // failing on text after it.
  function parse(src, { allowTrailing = false } = {}) {
    let i = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const fail = (msg) => { throw new Error(`${msg} at "${src.slice(i, i + 20)}"`); };

    function value() {
      ws();
      const c = src[i];
      if (c === '[') {
        i++;
        ws();
        if (src[i] === ':') { // empty property list [:]
          i++; ws();
          if (src[i] !== ']') fail('expected ]');
          i++;
          return { t: 'props', entries: [] };
        }
        const items = [];
        const entries = [];
        while (true) {
          ws();
          if (src[i] === ']') { i++; break; }
          if (i >= src.length) fail('unterminated list');
          const v = value();
          ws();
          if (src[i] === ':') {
            i++;
            entries.push({ key: v, value: value() });
          } else {
            items.push(v);
          }
          ws();
          if (src[i] === ',') i++;
        }
        if (entries.length && items.length) fail('mixed list');
        return entries.length ? { t: 'props', entries } : { t: 'list', items };
      }
      if (c === '"') {
        const end = src.indexOf('"', i + 1);
        if (end < 0) fail('unterminated string');
        const v = src.slice(i + 1, end);
        i = end + 1;
        return { t: 'str', v };
      }
      if (c === '#') {
        const m = /^#[A-Za-z_]\w*/.exec(src.slice(i));
        if (!m) fail('bad symbol');
        i += m[0].length;
        return { t: 'sym', v: m[0].slice(1) };
      }
      const m = /^-?(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) fail('unexpected value');
      i += m[0].length;
      return { t: 'num', v: Number(m[0]), raw: m[0] };
    }

    const v = value();
    ws();
    if (allowTrailing) return { value: v, rest: src.slice(i) };
    if (i < src.length) fail('trailing text');
    return v;
  }

  function formatNumber(v) {
    if (Number.isInteger(v)) return String(v);
    let s = String(v);
    if (/e/i.test(s)) s = v.toFixed(12).replace(/0+$/, '');
    return s;
  }

  function serialize(node) {
    switch (node.t) {
      case 'num': return node.raw != null && Number(node.raw) === node.v ? node.raw : formatNumber(node.v);
      case 'sym': return '#' + node.v;
      case 'str': return `"${node.v.replace(/"/g, "'")}"`;
      case 'list': return '[' + node.items.map(serialize).join(', ') + ']';
      case 'props': return node.entries.length
        ? '[' + node.entries.map((e) => `${serialize(e.key)}: ${serialize(e.value)}`).join(', ') + ']'
        : '[:]';
      default: throw new Error('unknown node ' + node.t);
    }
  }

  // Property list helpers (keys are symbols).
  function get(props, key) {
    const e = props.entries.find((x) => x.key.t === 'sym' && x.key.v === key);
    return e ? e.value : undefined;
  }
  function set(props, key, value) {
    const e = props.entries.find((x) => x.key.t === 'sym' && x.key.v === key);
    if (value === undefined) {
      if (e) props.entries.splice(props.entries.indexOf(e), 1);
    } else if (e) e.value = value;
    else props.entries.push({ key: { t: 'sym', v: key }, value });
  }

  const num = (v) => ({ t: 'num', v });
  const sym = (v) => ({ t: 'sym', v });
  const str = (v) => ({ t: 'str', v });

  // Config file: "[section]" headers, "#key= [literal]" definitions, and
  // "key=value" settings; everything else (comments) is kept verbatim.
  function parseConfig(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let section = null;
    const defs = [];
    lines.forEach((line, index) => {
      const sec = /^\s*\[(\w+)\]\s*$/.exec(line);
      if (sec) { section = sec[1]; return; }
      const def = /^(\s*#(\w+)\s*=\s*)(\[.*\])\s*$/.exec(line);
      if (def) {
        try {
          // Tolerate stray closing brackets (the guard tower line has one).
          const { value, rest } = parse(def[3], { allowTrailing: true });
          if (/^[\]\s]*$/.test(rest)) {
            defs.push({ kind: 'def', section, key: def[2], prefix: def[1], value, original: serialize(value), index });
          }
        } catch (e) { /* leave unparseable lines alone */ }
        return;
      }
      const setting = /^(\s*([a-z_]+)\s*=\s*)(.*?)\s*$/.exec(line);
      if (setting && !line.trim().startsWith('--')) {
        defs.push({ kind: 'setting', section, key: setting[2], prefix: setting[1], value: setting[3], original: setting[3], index });
      }
    });
    return { lines, defs };
  }

  // Rebuild the config text; only definitions that changed are rewritten.
  function writeConfig(cfg) {
    const lines = cfg.lines.slice();
    for (const d of cfg.defs) {
      const now = d.kind === 'def' ? serialize(d.value) : d.value;
      if (now !== d.original) lines[d.index] = d.prefix + now;
    }
    return lines.join('\n');
  }

  exports.Lingo = { parse, serialize, get, set, num, sym, str, parseConfig, writeConfig };
})(typeof module !== 'undefined' ? module.exports : window);
