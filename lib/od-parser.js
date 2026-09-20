/**
 * od-parser.js — Parse SAP VC procedure/constraint source code,
 * extract characteristic references including variant function/table calls.
 */
class OdParser {
  constructor(vfDefs) {
    // vfDefs: { funcName: { inputs: [param,...], outputs: [param,...] } }
    this.vfDefs = vfDefs || {};
  }

  parse(procName, sourceText) {
    const result = {
      name: procName,
      chars: { reads: new Set(), writes: new Set(), defaults: new Set() },
      calls: new Set(),
      tables: {},  // tableName → { reads: Set(cols), writes: Set(cols) }
    };
    if (!sourceText) return result;

    const cleanLines = sourceText.split('\n')
      .filter(l => !l.trimLeft().startsWith('*'))
      .join('\n');

    const aliases = this._extractObjectsAliases(cleanLines);
    const statements = this._splitStatements(cleanLines);

    // First pass: extract TABLE references from raw text
    this._extractTableRefs(cleanLines, result, aliases);

    let currentSection = 'body';
    let seenObjects = false;
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      const result_ = this._processStatement(stmt, result, currentSection, aliases, seenObjects);
      currentSection = result_.section;
      seenObjects = result_.seenObjects || seenObjects;
    }

    return result;
  }

  _extractObjectsAliases(text) {
    const aliases = {};
    const objMatch = text.match(/OBJECTS:([\s\S]*?)(?:CONDITION:|RESTRICTIONS:|INFERENCES:|$)/i);
    if (!objMatch) return aliases;
    const whereRe = /\bWHERE\s+([A-Z][A-Z0-9_]*)\s*=\s*([A-Z][A-Z0-9_]*)\b/gi;
    let m;
    while ((m = whereRe.exec(objMatch[1])) !== null) {
      aliases[m[1]] = m[2];
    }
    return aliases;
  }

  _splitStatements(text) {
    const stmts = []; let cur = ''; let inStr = false; let parenDepth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "'") {
        if (i+1<text.length && text[i+1]==="'") { cur+="''"; i++; continue; }
        inStr=!inStr; cur+=c; continue;
      }
      if (c==='(' && !inStr) { parenDepth++; cur+=c; continue; }
      if (c===')' && !inStr) { parenDepth--; cur+=c; continue; }
      if (c===',' && !inStr && parenDepth===0) { stmts.push(cur); cur=''; continue; }
      cur+=c;
    }
    if (cur.trim()) stmts.push(cur);
    return stmts;
  }

  _extractTableRefs(text, result, aliases) {
    const tableRe = /\bTABLE\s+(\S+)\s*\(([^)]+)\)/gi;
    let m;
    while ((m = tableRe.exec(text)) !== null) {
      const tableName = m[1];
      const params = m[2];
      if (!result.tables[tableName]) result.tables[tableName] = { reads: new Set(), writes: new Set() };
      // Parse COL = value pairs
      const pairs = this._splitTableParamPairs(params);
      for (const [col, val] of pairs) {
        // Column is a table key → READ
        result.tables[tableName].reads.add(col);
        // Value may reference a char
        const trimmedVal = val.trim();
        let charName = null;
        const selfRef = trimmedVal.match(/^\$SELF\.([A-Z][A-Z0-9_]*)/i);
        if (selfRef) charName = selfRef[1];
        else {
          const aliasRef = trimmedVal.match(/^[A-Z][A-Z0-9_]{1,8}\.([A-Z][A-Z0-9_]+)\b/);
          if (aliasRef) charName = aliasRef[1];
          else if (aliases) {
            const bareRef = trimmedVal.match(/^[A-Z][A-Z0-9_]{1,16}\b/);
            if (bareRef && aliases[bareRef[0]]) charName = aliases[bareRef[0]];
          }
        }
        if (charName && !/^\d+$/.test(charName)) result.chars.reads.add(charName);
      }
    }
  }

  _splitTableParamPairs(params) {
    // Split params by comma (top-level only, not inside nested parens/quotes)
    const parts = []; let cur = ''; let depth = 0; let inStr = false;
    for (let i = 0; i < params.length; i++) {
      const c = params[i];
      if (c === "'") { inStr = !inStr; cur+=c; continue; }
      if (c === '(' && !inStr) { depth++; cur+=c; continue; }
      if (c === ')' && !inStr) { depth--; cur+=c; continue; }
      if (c === ',' && depth === 0 && !inStr) { parts.push(cur); cur=''; continue; }
      cur+=c;
    }
    if (cur.trim()) parts.push(cur);
    // Parse each part into [col, value]
    return parts.map(p => {
      const eq = p.indexOf('=');
      if (eq < 0) return [p.trim(), ''];
      return [p.slice(0, eq).trim(), p.slice(eq+1).trim()];
    });
  }

  _processStatement(stmt, result, prevSection, aliases, outerSeenObjects) {
    const flat = stmt.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) return { section: prevSection, seenObjects: outerSeenObjects || false };

    const tokens = []; let i = 0; let funcDepth = 0;
    while (i < flat.length) {
      if (/\s/.test(flat[i])) { i++; continue; }
      if (flat[i] === "'") {
        let j = i + 1;
        if (j < flat.length && flat[j] === "'") { tokens.push({type:'string'}); i+=2; continue; }
        while (j < flat.length && !(flat[j]==="'" && flat[j-1]!=="'")) j++;
        tokens.push({type:'string'}); i = j+1; continue;
      }
      const rd = flat.slice(i).match(/^\$(SELF|ROOT|PARENT)\.([A-Z][A-Z0-9_]*)/i);
      if (rd) { tokens.push({type:'ref',charName:rd[2]}); i+=rd[0].length; continue; }
      const ra = flat.slice(i).match(/^[A-Z][A-Z0-9_]{1,8}\.([A-Z][A-Z0-9_]+)\b/);
      if (ra) { tokens.push({type:'ref',charName:ra[1]}); i+=ra[0].length; continue; }
      const sk = flat.slice(i).match(/^(OBJECTS:|CONDITION:|RESTRICTIONS:|INFERENCES:)/i);
      if (sk) { tokens.push({type:'section', section: sk[0].toLowerCase().replace(':','')}); i+=sk[0].length; continue; }
      // (P)FUNCTION NAME( — match whole call header incl. open paren (source uses PFUNCTION)
      const fnCall = flat.slice(i).match(/^P?FUNCTION\s+([A-Z][A-Z0-9_]*)\s*\(/i);
      if (fnCall) { tokens.push({type:'funcall', func: fnCall[1]}); i+=fnCall[0].length; funcDepth=1; continue; }
      const kw = flat.slice(i).match(/^(IF|AND|OR|SPECIFIED|NOT|PART_OF|IN|IS_A|TABLE)\b/i);
      if (kw) { tokens.push({type:'keyword', wordLower: kw[0].toLowerCase()}); i+=kw[0].length; continue; }
      const op = flat.slice(i).match(/^(>=|<=|<>|\?=|=|>|<|\+|-|\*|\/|\(|\)|,)/);
      if (op) {
        if (op[0] === '(') funcDepth++;
        if (op[0] === ')') { funcDepth = Math.max(0, funcDepth-1); }
        tokens.push({type:'op', op: op[0]}); i+=op[0].length; continue;
      }
      const bw = flat.slice(i).match(/^[A-Z][A-Z0-9_]{1,30}\b/i);
      if (bw) {
        if (funcDepth > 0) { tokens.push({type:'vfparam', param: bw[0]}); }
        else if (aliases && aliases[bw[0]] !== undefined) tokens.push({type:'ref', charName: aliases[bw[0]]});
        i += bw[0].length; continue;
      }
      i++;
    }

    let inCondition = false, walkSection = prevSection;
    let inFunction = false, inFunctionParens = false, inTable = false, parenDepth = 0, seenObjects = outerSeenObjects || false;
    let currentFunc = null;

    let funcParamSide = null;

    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (tok.type === 'section') {
        if (tok.section === 'objects') { walkSection = 'body'; seenObjects = true; }
        else if (tok.section === 'condition') { walkSection='condition'; inCondition=true; }
        else if (tok.section === 'restrictions') { walkSection='restrictions'; inCondition=false; }
        else if (tok.section === 'inferences') { walkSection='restrictions'; inCondition=false; }
        continue;
      }
      if (tok.type === 'keyword') {
        if (tok.wordLower === 'table') { inTable=true; continue; }
        if (tok.wordLower === 'if' || tok.wordLower === 'part_of') inCondition=true;
        continue;
      }
      if (tok.type === 'funcall') {
        currentFunc = tok.func;
        inFunction = true; inFunctionParens = true; funcParamSide = null;
        parenDepth++;  // fnCall regex consumed the '(' — keep parenDepth in sync so inner commas don't reset inCondition
        continue;
      }
      if (tok.type === 'op') {
        if (tok.op === '(') { parenDepth++; if (inFunction) inFunctionParens=true; continue; }
        if (tok.op === ')') { parenDepth--; inFunction=false; inTable=false; inFunctionParens=false; funcParamSide=null; currentFunc=null; continue; }
        if (tok.op === ',' && parenDepth===0) inCondition=false;
        continue;
      }
      if (tok.type === 'vfparam') {
        if (inFunction && inFunctionParens && currentFunc) {
          const fd = this.vfDefs[currentFunc];
          if (fd) {
            if (fd.outputs && fd.outputs.includes(tok.param)) funcParamSide = 'write';
            else if (fd.inputs && fd.inputs.includes(tok.param)) funcParamSide = 'read';
            else funcParamSide = /OUT$/i.test(tok.param) ? 'write' : 'read';
          } else {
            funcParamSide = /OUT$/i.test(tok.param) ? 'write' : 'read';
          }
        }
        continue;
      }
      if (tok.type === 'ref') {
        const sv = ['NULL','THIS_WILL_STOP','THIS_WILL_CONTINUE','FREE','ROOT','PARENT','SELF','TIMES','CLEAR','SET','MOVE'];
        if (sv.includes(tok.charName) || /^\d+$/.test(tok.charName)) continue;
        if (seenObjects && walkSection === 'body' && !inCondition) continue; // Skip OBJECTS body area
        if (inFunction && inFunctionParens && funcParamSide) {
          if (funcParamSide === 'write') result.chars.writes.add(tok.charName);
          else result.chars.reads.add(tok.charName);
          funcParamSide=null; continue;
        }
        if (inTable) { result.chars.reads.add(tok.charName); continue; }
        let hasEq = false, isQE = false;
        for (let n = t+1; n < tokens.length; n++) {
          const nt = tokens[n];
          if (nt.type==='op' && (nt.op==='=' || nt.op==='?=')) { hasEq=true; isQE=nt.op==='?='; break; }
          if (nt.type==='ref' || nt.type==='keyword' || nt.type==='section') break;
        }
        if (hasEq) {
          if (isQE) { result.chars.writes.add(tok.charName); result.chars.defaults.add(tok.charName); }
          else if (walkSection==='condition' || inCondition) result.chars.reads.add(tok.charName);
          else result.chars.writes.add(tok.charName);
        } else {
          if (walkSection !== 'body' || inCondition) result.chars.reads.add(tok.charName);
        }
      }
    }
    return { section: walkSection, seenObjects };
  }

  serialize(parsed) {
    return {
      name: parsed.name,
      chars: {
        reads: [...parsed.chars.reads],
        writes: [...parsed.chars.writes],
        defaults: [...parsed.chars.defaults],
      },
      calls: [...parsed.calls],
      tables: Object.fromEntries(
        Object.entries(parsed.tables).map(([name, t]) => [name, {
          reads: [...t.reads],
          writes: [...t.writes],
        }])
      ),
    };
  }
}
module.exports = OdParser;
