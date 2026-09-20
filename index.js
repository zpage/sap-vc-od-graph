#!/usr/bin/env node
/**
 * sap-vc-od-graph — SAP VC Object Dependency Graph Generator
 *
 * Usage:
 *   node index.js --material <MATNR>          # Query SAP via RFC
 *   node index.js --profile <PROFILE>         # Query by profile name
 *   node index.js --mock                      # Use mock data for testing
 *   node index.js --input <data.json>         # Load pre-fetched data
 *
 * Options:
 *   --system <SID>    SAP system (default: R1E)
 *   --output <file>   HTML output path (default: vc-od-graph.html)
 *   --mock            Use embedded mock data
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OdParser = require('./lib/od-parser');
const GraphBuilder = require('./lib/graph-builder');
const HtmlRenderer = require('./lib/html-renderer');

// Path to the sap-vc-cs CLI (RFC bridge). Set SAPVC_CS_BIN to override.
const SAP_CS_EXE = process.env.SAPVC_CS_BIN || path.resolve(
  process.env.USERPROFILE || '',
  'sap-vc-cs/bin/Release/net8.0/sap-vc-cs.exe'
);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { system: 'R1E', output: 'vc-od-graph.html' };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--material': opts.material = args[++i]; break;
      case '--profile': opts.profileName = args[++i]; break;
      case '--system': opts.system = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--input': opts.input = args[++i]; break;
      case '--mock': opts.mock = true; break;
      case '--force': opts.force = true; break;
      case '--fetch-tables': opts.fetchTables = true; break;
      case '--fetch-bom': opts.fetchBom = true; break;
      case '--heatmap': opts.heatmap = true; break;
      case '--depgraph': opts.depgraph = true; break;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log(`VC OD Graph Generator\n`);

  function loadFromRaw(raw, source) {
    profile = raw.Profile || raw.profile || {};
    dependencies = (raw.Dependencies || raw.dependencies || []).map(d => {
      const norm = { name: d.Name || d.name, type: d.Type || d.type, status: d.Status || d.status,
        description: d.Description || d.description, order: d.Order || d.order };
      norm.source = Array.isArray(d.Source || d.source) ? (d.Source || d.source) : [];
      norm.sourceText = Array.isArray(d.Source || d.source) ? (d.Source || d.source).join('\n') : (d.sourceText || '');
      norm.constraints = (d.Constraints || d.constraints || []).map(c => ({
        name: c.Name || c.name,
        source: Array.isArray(c.Source || c.source) ? (c.Source || c.source) : [],
        sourceText: Array.isArray(c.Source || c.source) ? (c.Source || c.source).join('\n') : (c.sourceText || ''),
      }));
      return norm;
    });
    material = raw.material || '';
    tableStructures = raw.Tables || raw.tables || {};
    // Normalize PascalCase keys
    for (const tn of Object.keys(tableStructures)) {
      const ts = tableStructures[tn];
      if (ts.Inputs && !ts.inputs) ts.inputs = ts.Inputs;
      if (ts.Outputs && !ts.outputs) ts.outputs = ts.Outputs;
    }
    tableContent = raw.tableContent || {};
    classData = raw.classData || [];
    bomData = raw.bomData || { mast: [], bapi: { stko: [], stpo: [], depOrder: [], depSource: {}, depData: {} }, classObjects: {} };
    if (Object.keys(tableContent).length) console.log(`  Table content: ${Object.keys(tableContent).length} tables`);
    if (classData.length) console.log(`  Class data: ${classData.length} classes`);
    console.log(`Loaded from ${source}`);
  }
  async function querySAP() {
    const outPath = path.resolve(opts.output);
    console.log(`Querying SAP ${opts.system}...`);
    material = opts.material || '';
    const cliArgs = ['profile-deps', '--json', '--system', opts.system];
    if (opts.material) { cliArgs.push('--material', opts.material); }
    if (opts.profileName) { cliArgs.push('--profile', opts.profileName); }

    const stdout = execFileSync(SAP_CS_EXE, cliArgs, {
      encoding: 'utf-8', timeout: 300000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE),
    });
    const result = JSON.parse(stdout);
    profile = result.Profile || result.profile || {};
    dependencies = (result.Dependencies || result.dependencies || []).map(d => ({
      name: d.Name || d.name, type: d.Type || d.type, status: d.Status || d.status,
      description: d.Description || d.description, order: d.Order || d.order,
      source: Array.isArray(d.Source || d.source) ? (d.Source || d.source) : [],
      sourceText: Array.isArray(d.Source || d.source) ? (d.Source || d.source).join('\n') : '',
      constraints: Array.isArray(d.Constraints || d.constraints) ? (d.Constraints || d.constraints).map(c => ({
        name: c.Name || c.name, source: Array.isArray(c.Source || c.source) ? (c.Source || c.source) : [],
        sourceText: Array.isArray(c.Source || c.source) ? (c.Source || c.source).join('\n') : '',
      })) : [],
    }));
    tableStructures = result.Tables || result.tables || {};
    // Normalize PascalCase table I/O keys to lowercase (C# → JS)
    for (const tn of Object.keys(tableStructures)) {
      const ts = tableStructures[tn];
      if (ts.Inputs && !ts.inputs) ts.inputs = ts.Inputs;
      if (ts.Outputs && !ts.outputs) ts.outputs = ts.Outputs;
    }
    const rawJsonPath = path.resolve(opts.output).replace(/\.html$/i, '') + '.json';
    let rawSnapshot = {};
    try { rawSnapshot = JSON.parse(fs.readFileSync(rawJsonPath, 'utf-8')); } catch(e) {}
    rawSnapshot.material = opts.material || '';
    rawSnapshot.profile = result.profile || result.Profile || {};
    rawSnapshot.dependencies = result.dependencies || result.Dependencies || [];
    rawSnapshot.tables = result.tables || result.Tables || {};
    fs.writeFileSync(rawJsonPath, JSON.stringify(rawSnapshot, null, 1));
    console.log(`Dependencies: ${dependencies.length}`);

    // Step 1.5: For AVC CNET deps, discover and read their constraints
    const avcNets = dependencies.filter(d => d.type === '16');
    for (const net of avcNets) {
      try {
        const listArgs = ['call', 'CARD_CONSTRAINT_NET_READ', 'CONSTRAINT_NET=' + net.name, '--system', opts.system];
        const listOut = execFileSync(SAP_CS_EXE, listArgs, { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true });
        const consNames = [];
        for (const ln of listOut.split('\n')) {
          const m = ln.match(/^\s*\[\d+\]\s+DEPENDENCY=(\S+)/);
          if (m) consNames.push(m[1]);
        }
        const constraints = [];
        for (const cname of consNames) {
          try {
            const cArgs = ['call', 'CARD_CNET_CONSTRAINT_READ', 'CONSTRAINT=' + cname, 'FL_WITH_SOURCE=X', '--system', opts.system];
            const cOut = execFileSync(SAP_CS_EXE, cArgs, { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true });
            const srcLines = [];
            for (const cl of cOut.split('\n')) {
              const sm = cl.match(/^\s*\[\d+\]\s+\S+,\s*LINE=(.*)/);
              if (sm) srcLines.push(sm[1]);
            }
            constraints.push({ name: cname, type: '11', source: srcLines, sourceText: srcLines.join('\n') });
          } catch(e) { /* skip */ }
        }
        net.constraints = constraints;
        for (const c of constraints) {
          if (!dependencies.find(d => d.name === c.name))
            dependencies.push({ name: c.name, type: '11', status: '1', description: '', order: '', source: c.source, sourceText: c.sourceText, constraints: [] });
        }
        console.log(`  AVC CNET ${net.name}: ${constraints.length} constraints`);
        // Re-save JSON with updated dependencies
        try {
          rawSnapshot.dependencies = dependencies;
          fs.writeFileSync(rawJsonPath, JSON.stringify(rawSnapshot, null, 1));
        } catch(e) {}
      } catch(e) { console.log(`  AVC CNET ${net.name}: skipped (${e.message})`); }
    }
  }

  // Step 1: Get data
  let profile = {};
  let dependencies = [];
  let tableStructures = {};
  let tableContent = {};
  let classData = [];
  let bomData = { mast: [], bapi: { stko: [], stpo: [] } };
  let material = '';

  if (opts.input) {
    const raw = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));
    loadFromRaw(raw, opts.input);
  } else if (opts.material && !opts.force) {
    // Check for cached JSON
    const cachePath = path.resolve(opts.output).replace(/\.html$/i, '') + '.json';
    if (fs.existsSync(cachePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        loadFromRaw(raw, cachePath);
      } catch(e) {
        console.log(`  Cache read failed, querying SAP...`);
        await querySAP();
      }
    } else {
      await querySAP();
    }
  } else if (opts.mock) {
    const mock = require('./lib/mock-data');
    profile = mock.profile;
    dependencies = mock.dependencies;
    console.log(`Using mock data (${dependencies.length} dependencies)`);
  } else {
    await querySAP();
  }
  if (!dependencies.length) { console.error('No data loaded'); process.exit(1); }

  // Step 2: Parse procedure source code
  console.log(`\nParsing ${dependencies.length} dependencies...`);
  // Load variant function definitions (inputs/outputs from CARD_FUNCTION_READ)
  let vfDefs = {};
  // Discover function names actually called in OD sources
  const calledFuncs = new Set();
  for (const d of dependencies) {
    const src = Array.isArray(d.source) ? d.source.join('\n') : (d.sourceText || '');
    let m;
    const re = /P?FUNCTION\s+([A-Z][A-Z0-9_]*)\s*\(/gi;
    while ((m = re.exec(src)) !== null) calledFuncs.add(m[1]);
    for (const c of (d.constraints || [])) {
      const cs = Array.isArray(c.source) ? c.source.join('\n') : (c.sourceText || '');
      const re2 = /P?FUNCTION\s+([A-Z][A-Z0-9_]*)\s*\(/gi;
      while ((m = re2.exec(cs)) !== null) calledFuncs.add(m[1]);
    }
  }
  // Read I/O definitions from BAPI (latest), fall back to cached JSON per function
  let cachedVfDefs = {};
  const vfJsonPath = path.join(__dirname, 'variant_functions_q1e.json');
  if (fs.existsSync(vfJsonPath)) {
    try { cachedVfDefs = JSON.parse(fs.readFileSync(vfJsonPath, 'utf-8')); } catch(e) { console.log(`  VF cache load failed: ${e.message}`); }
  }
  let bapiOk = 0, bapiFail = 0, cachedUsed = 0;
  for (const fname of [...calledFuncs].sort()) {
    try {
      const fOut = execFileSync(SAP_CS_EXE, ['call', 'CARD_FUNCTION_READ', 'FUNCTION_NAME=' + fname, '--system', opts.system],
        { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
      const inputs = [], allParams = [];
      let curTable = '';
      for (const line of fOut.split('\n')) {
        const ls = line.trim();
        if (!ls) continue;
        const tblHdr = ls.match(/^([A-Z_]+) = TABLE/);
        if (tblHdr) { curTable = tblHdr[1]; continue; }
        if (ls.startsWith('===')) continue;  // section separator === NAME (N rows) ===
        if (!ls.startsWith('[')) { curTable = ''; continue; }
        const cm = ls.match(/CHARACT=([^,\s]+)/);
        if (!cm) continue;
        if (curTable === 'VAR_FUNCTION_ALT_INPUT') inputs.push(cm[1]);
        else if (curTable === 'VAR_FUNCTION_PARAMETERS') allParams.push(cm[1]);
      }
      const outputs = allParams.filter(p => !inputs.includes(p));
      vfDefs[fname] = { inputs: [...new Set(inputs)], outputs: [...new Set(outputs)] };
      bapiOk++;
    } catch(e) {
      if (cachedVfDefs[fname]) { vfDefs[fname] = cachedVfDefs[fname]; cachedUsed++; }
      else { vfDefs[fname] = { inputs: [], outputs: [] }; }
      bapiFail++;
    }
  }
  console.log(`  Variant function defs: ${Object.keys(vfDefs).length} (BAPI=${bapiOk}, cached=${cachedUsed}, fail=${bapiFail})`);
  const parser = new OdParser(vfDefs);
  for (const dep of dependencies) {
    if (dep.sourceText) {
      dep.parsed = parser.serialize(parser.parse(dep.name, dep.sourceText));
    }
    // Parse each constraint's source separately
    if (dep.constraints && dep.constraints.length > 0) {
      for (const c of dep.constraints) {
        if (c.sourceText) {
          c.parsed = parser.serialize(parser.parse(c.name, c.sourceText));
        }
      }
    }
  }
  const procCount = dependencies.filter(d => d.type === 'PROC' || d.type === '17').length;
  const cnetCount = dependencies.filter(d => d.type === 'CNET' || d.type === '16').length;
  console.log(`  ${procCount} procedures, ${cnetCount} constraint nets`);

  // Step 3: Build graph
  console.log(`\nBuilding dependency graph...`);

  const builder = new GraphBuilder(dependencies, profile, tableStructures);
  const graph = builder.build();
  const charCount = graph.nodes.filter(n => n.type === 'char').length;
  const procNodes = graph.nodes.filter(n => n.type === 'proc' || n.type === 'cnet').length;
  const tableNodes = graph.nodes.filter(n => n.type === 'table').length;
  console.log(`  ${procNodes} procedure nodes, ${charCount} characteristic nodes, ${tableNodes} table nodes`);
  console.log(`  ${graph.edges.length} relationships`);

  // Step 4: Reconcile table output columns in parsed data
  // When BAPI structure says a table column is output (edge table→char type='writes'),
  // move that char from reads to writes ONLY in ODs that actually CALL the table.
  // (A table's output column is only written by that table's caller, not by every
  //  OD that happens to reference the same char — e.g. a <> comparison or SPECIFIED
  //  check is still a READ even if some unrelated variant table outputs that char.)
  for (const edge of graph.edges) {
    if (edge.type === 'writes') {
      const srcNode = graph.nodes.find(n => n.id === edge.source);
      if (srcNode && srcNode.type === 'table') {
        // Find ODs that use this table
        for (const dep of dependencies) {
          if (dep.parsed && dep.parsed.chars && dep.parsed.tables && dep.parsed.tables[edge.source]) {
            const rd = dep.parsed.chars.reads;
            const wr = dep.parsed.chars.writes;
            const ri = rd.indexOf(edge.target);
            if (ri >= 0 && !wr.includes(edge.target)) {
              rd.splice(ri, 1);
              wr.push(edge.target);
            }
          }
          for (const c of (dep.constraints || [])) {
            if (c.parsed && c.parsed.chars && c.parsed.tables && c.parsed.tables[edge.source]) {
              const rd = c.parsed.chars.reads;
              const wr = c.parsed.chars.writes;
              const ri = rd.indexOf(edge.target);
              if (ri >= 0 && !wr.includes(edge.target)) {
                rd.splice(ri, 1);
                wr.push(edge.target);
              }
            }
          }
        }
      }
    }
  }

  // Step 4.5: Fetch data in parallel (table content, class data, BOM)
  const fetchers = [];

  // Table content fetcher
  const fetchTableContent = async () => {
    if (!opts.fetchTables) return;
    const tables = graph.nodes.filter(n => n.type === 'table').map(n => n.id);
    console.log(`\nFetching content for ${tables.length} tables...`);
    const { execFile } = require('child_process');
    let done = 0, errs = 0, idx = 0;
    const next = () => {
      if (idx >= tables.length) return;
      const tName = tables[idx++];
      execFile(SAP_CS_EXE, ['table-content', '--table', tName, '--system', opts.system], {
        encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE),
      }, (err, stdout) => {
        if (!err && stdout) try { tableContent[tName] = JSON.parse(stdout); done++; } catch(e) { errs++; }
        else errs++;
        if ((done + errs) % 50 === 0 || done + errs === tables.length) console.log(`  ${done + errs}/${tables.length} (${done} ok, ${errs} err)`);
        next();
      });
    };
    for (let i = 0; i < 8; i++) next();
    await new Promise(r => { const iv = setInterval(() => { if (done + errs >= tables.length) { clearInterval(iv); r(); } }, 500); });
    console.log(`  Done. ${Object.keys(tableContent).length} tables fetched.`);
  };

  // Class data fetcher
  const fetchClassData = async () => {
    if (!opts.fetchTables) return;
    try {
      const matObj = /^\d+$/.test(opts.material||'') ? ('00000000' + (opts.material || '').padStart(10, '0')) : (opts.material || '');
      const listOut = execFileSync(SAP_CS_EXE, ['call', 'BAPI_OBJCL_GETCLASSES', 'OBJECTKEY_IMP=' + matObj, 'OBJECTTABLE_IMP=MARA', 'CLASSTYPE_IMP=300', '--text', '--system', opts.system], { encoding: 'utf-8', timeout: 60000, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
      const classNames = [];
      const lines = listOut.split('\n');
      for (const l of lines) {
        const m = l.match(/CLASSNUM=([^,\s]+)/);
        if (m) classNames.push(m[1]);
      }
      console.log(`  Material classes: ${classNames.length}`);
      const graphCharSet = new Set(graph.nodes.filter(n => n.type === 'char').map(c => c.id));
      const classChars = {};
      let detailDone = 0;
      for (const cn of classNames) {
        try {
          const detailOut = execFileSync(SAP_CS_EXE, ['call', 'BAPI_CLASS_GETDETAIL', 'CLASSNUM=' + cn, 'CLASSTYPE=300', '--text', '--system', opts.system], { encoding: 'utf-8', timeout: 15000, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
          const dtLines = detailOut.split('\n');
          const myChars = [];
          for (const l of dtLines) {
            const cm = l.match(/NAME_CHAR=([^,\s]+)/);
            if (cm) myChars.push(cm[1]);
          }
          const relevant = [...new Set(myChars)];
          if (relevant.length > 0) classChars[cn] = { name: cn, chars: relevant };
          detailDone++;
        } catch (e) { /* skip */ }
      }
      classData = Object.values(classChars).sort((a,b) => a.name.localeCompare(b.name));
      console.log(`  Classes with chars: ${classData.length} (${detailDone}/${classNames.length} detail calls)`);
    } catch (e) { console.log(`  Classes: skipped (${e.message})`); }
  };

  // BOM data fetcher
  const fetchBomData = async () => {
    if (!opts.fetchBom) return;
    bomData = { mast: [], bapi: { stko: [], stpo: [] } };
    const matPadded = /^\d+$/.test(opts.material||'') ? (opts.material || '').padStart(18, '0') : (opts.material || '');
    console.log(`  matPadded=${matPadded}`);
    try {
      const mastOut = execFileSync(SAP_CS_EXE, ['read-table', 'MAST', '--fields', 'MATNR,STLNR,STLAN,STLAL,WERKS', '--where', `MATNR LIKE '${matPadded}'`, '--limit', '50', '--json', '--system', opts.system], { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
      const mastJson = JSON.parse(mastOut);
      bomData.mast = Array.isArray(mastJson) ? mastJson : (mastJson.rows || []);
    } catch(e) { /* MAST not available, try bom directly */ }
    if (bomData.mast.length === 0) {
      // Fallback: try CSAP_MAT_BOM_READ directly with material
      try {
        const bomOut = execFileSync(SAP_CS_EXE, ['bom', '--material', matPadded, '--json', '--system', opts.system], { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
        const bomJson = JSON.parse(bomOut);
        const bomTables = bomJson.Tables || bomJson;
        bomData.bapi = {
          stko: (bomTables.T_STKO || []).slice(0, 1),
          stpo: (bomTables.T_STPO || []),
          depOrder: bomTables.T_DEP_ORDER || [],
          depSource: (bomTables.T_DEP_SOURCE || []).reduce(function(o,r){var key=r.DEP_INTERN||'';if(key){if(!o[key])o[key]=[];o[key].push(r.LINE||'');}return o},{}),
          depData: (bomTables.T_DEP_DATA || []).reduce(function(o,r){var key=r.DEP_INTERN||'';if(key)o[key]=r.DEP_TYPE||'';return o},{}),
          matnr: opts.material || '',
        };
        console.log(`  BOM: direct (${bomData.bapi.stpo.length} items)`);
        if (bomData.bapi.depOrder.length > 0) console.log(`  BOM item→OD links: ${bomData.bapi.depOrder.length}`);
        if (Object.keys(bomData.bapi.depSource).length > 0) console.log(`  BOM OD sources: ${Object.keys(bomData.bapi.depSource).length}`);
      } catch(e) { console.log(`  BOM: skipped (${e.message})`); }
    } else {
      console.log(`  MAST: ${bomData.mast.length} BOM assignments`);
      const stlnrMap = {};
      for (const r of bomData.mast) if (!stlnrMap[r.STLNR]) stlnrMap[r.STLNR] = r;
      const uniq = Object.values(stlnrMap);
      console.log(`  Unique BOMs: ${uniq.length}`);
      const r0 = uniq[0];
        const bomOut = execFileSync(SAP_CS_EXE, ['bom', '--material', r0.MATNR, '--plant', r0.WERKS, '--usage', r0.STLAN, '--json', '--system', opts.system], { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
        const bomJson = JSON.parse(bomOut);
        const bomTables = bomJson.Tables || bomJson;  // new=RfcResult.Tables, old=flat
        bomData.bapi = {
          stko: (bomTables.T_STKO || []).slice(0, 1),  // header
          stpo: (bomTables.T_STPO || []),               // items
          depOrder: bomTables.T_DEP_ORDER || [],         // item→dependency mapping
          depSource: (bomTables.T_DEP_SOURCE || []).reduce(function(o,r){var key=r.DEP_INTERN||'';if(key){if(!o[key])o[key]=[];o[key].push(r.LINE||'');}return o},{}),
          depData: (bomTables.T_DEP_DATA || []).reduce(function(o,r){var key=r.DEP_INTERN||'';if(key)o[key]=r.DEP_TYPE||'';return o},{}),
          matnr: r0.MATNR,
          plant: r0.WERKS,
          stlan: r0.STLAN,
          stlnr: r0.STLNR,
        };
        if (bomData.bapi.depOrder.length > 0) console.log(`  BOM item→OD links: ${bomData.bapi.depOrder.length}`);
        if (Object.keys(bomData.bapi.depSource).length > 0) console.log(`  BOM OD sources: ${Object.keys(bomData.bapi.depSource).length}`);
      }
      // Step 4.75c: Get classified objects for all classes in BOM
      const classNames = [...new Set(bomData.bapi.stpo.filter(it=>it.CLASS).map(it=>it.CLASS))];
      if (classNames.length > 0) {
        bomData.classObjects = {};
        try {
          for (const cn of classNames) {
            const objOut = execFileSync(SAP_CS_EXE, ['class-objects', '--class', cn, '--json', '--system', opts.system], { encoding: 'utf-8', timeout: 30000, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) });
            const objJson = JSON.parse(objOut);
            const objects = (Array.isArray(objJson) ? objJson : (objJson.objects || [])).map(o => o.OBJECT);
            if (objects.length > 0) bomData.classObjects[cn] = objects;
          }
          console.log(`  Class objects: ${Object.keys(bomData.classObjects).length} classes with objects`);
        } catch(e) { console.log(`  Class objects: skipped (${e.message})`); }
      }
      // Step 4.75d: Fetch object details — skipped
    // Update raw JSON
    try {
      const rawJsonPath = path.resolve(opts.output).replace(/\.html$/i, '') + '.json';
      const raw = JSON.parse(fs.readFileSync(rawJsonPath, 'utf-8'));
      raw.bomData = bomData;
      fs.writeFileSync(rawJsonPath, JSON.stringify(raw, null, 1));
    } catch (e) { /* skip if raw JSON wasn't saved */ }
  };

  // Launch enabled fetchers in parallel
  if (opts.fetchTables || opts.fetchBom) {
    if (opts.fetchTables) { fetchers.push(fetchTableContent()); fetchers.push(fetchClassData()); }
    if (opts.fetchBom) fetchers.push(fetchBomData());
    await Promise.all(fetchers);
    // Update raw JSON with all fetched data
    try {
      const rawJsonPath = path.resolve(opts.output).replace(/\.html$/i, '') + '.json';
      const raw = JSON.parse(fs.readFileSync(rawJsonPath, 'utf-8'));
      if (Object.keys(tableContent).length) raw.tableContent = tableContent;
      if (classData.length) raw.classData = classData;
      raw.bomData = bomData;
      fs.writeFileSync(rawJsonPath, JSON.stringify(raw, null, 1));
    } catch(e) { /* skip JSON update */ }
  }

  // Step 5: Generate HTML
  // Truncate table content for HTML (limit to 50 rows, full data in JSON)
  const htmlTableContent = {};
  for (const [tn, tc] of Object.entries(tableContent)) {
    if (tc.rows && tc.rows.length > 50) {
      htmlTableContent[tn] = { ...tc, rows: tc.rows.slice(0, 50), _truncated: true, _totalRows: tc.rows.length };
    } else {
      htmlTableContent[tn] = tc;
    }
  }

  const renderer = new HtmlRenderer();
  const html = renderer.render(profile, dependencies, graph, htmlTableContent, classData, bomData, material);

  const outPath = path.resolve(opts.output);
  fs.writeFileSync(outPath, html);
  console.log(`Output: ${outPath}`);

  // Step 6: Generate heatmap (optional, requires --heatmap)
  if (opts.heatmap) {
    const HeatmapRenderer = require('./lib/heatmap-renderer');
    const hr = new HeatmapRenderer();
    const hmHtml = hr.render(profile, dependencies, graph);
    const hmPath = outPath.replace(/\.html$/i, '') + '-heatmap.html';
    fs.writeFileSync(hmPath, hmHtml);
    console.log(`Heatmap: ${hmPath}`);
  }

  // Step 7: Generate dependency graph (optional, requires --depgraph)
  if (opts.depgraph) {
    const DepGraphRenderer = require('./lib/dep-graph-renderer');
    const dgr = new DepGraphRenderer();
    const dgHtml = dgr.render(profile, dependencies, graph, material);
    const dgPath = outPath.replace(/\.html$/i, '') + '-depgraph.html';
    fs.writeFileSync(dgPath, dgHtml);
    console.log(`DepGraph: ${dgPath}`);
  }

  // Summary
  const allChars = new Set();
  dependencies.forEach(d => {
    if (d.parsed) {
      d.parsed.chars.reads.forEach(c => allChars.add(c));
      d.parsed.chars.writes.forEach(c => allChars.add(c));
    }
  });
  console.log(`\nSummary:`);
  console.log(`  Profile: ${profile.DESIGN || profile.C_PROFILE || '?'}`);
  console.log(`  Total dependencies: ${dependencies.length}`);
  console.log(`  Procedures: ${procCount}`);
  console.log(`  Distinct characteristics referenced: ${[...allChars].length}`);
}

main().catch(err => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
