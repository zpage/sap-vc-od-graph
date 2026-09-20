/**
 * graph-builder.js — Build dependency graph from parsed OD data.
 *
 * Node types:
 *   'proc'    — a procedure (dependency)
 *   'cnet'    — a constraint net
 *   'char'    — a characteristic
 *
 * Edge types:
 *   'reads'   — proc → char (procedure reads a characteristic)
 *   'writes'  — proc → char (procedure writes a characteristic)
 *   'calls'   — proc → proc (procedure calls another procedure)
 *   'contains' — profile → proc (profile contains this dependency)
 *   'ordered'  — proc → proc (execution order within profile)
 */

class GraphBuilder {
  constructor(dependencies, profile, tableStructures) {
    this.deps = dependencies || [];
    this.profile = profile || {};
    this.tableStructures = tableStructures || {};
  }

  /**
   * Build the graph from parsed dependency data
   * @returns {Object} { nodes, edges }
   */
  build() {
    const nodeMap = new Map();
    const edgeSet = new Set();
    const edges = [];

    // Helper to get or create a node
    const node = (id, type, label, extra = {}) => {
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, type, label, ...extra });
      }
      return nodeMap.get(id);
    };

    // Helper to add an edge (dedup by key)
    const addEdge = (source, target, type, label = '') => {
      const key = `${source}|${target}|${type}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ source, target, type, label });
      }
    };

    // Profile node
    const profileName = this.profile.C_PROFILE || this.profile.name || 'PROFILE';
    node('profile', 'profile', profileName, { design: this.profile.DESIGN || '' });

    // Process each dependency
    for (const dep of this.deps) {
      const depType = (dep.type === 'CNET' || dep.type === '16') ? 'cnet' : (dep.type === '11' ? 'constraint' : 'proc');
      node(dep.name, depType, dep.name, { 
        description: dep.description,
        status: dep.status,
        order: dep.order,
      });

      // Profile → dependency
      addEdge('profile', dep.name, 'contains', dep.order);

      // Process constraints of CNETs
      if (dep.constraints && dep.constraints.length > 0) {
        for (const c of dep.constraints) {
          // Constraint node
          node(c.name, 'constraint', c.name);
          // CNET → constraint
          addEdge(dep.name, c.name, 'contains', '');

          // Parse constraint chars
          if (c.parsed) {
            for (const charName of c.parsed.chars.reads) {
              node(charName, 'char', charName);
              addEdge(c.name, charName, 'reads');
            }
            for (const charName of c.parsed.chars.writes) {
              node(charName, 'char', charName);
              addEdge(c.name, charName, 'writes');
            }
          } else if (c.sourceText) {
            // Fallback: parse on the fly
            const rawParser = new (require('./od-parser'))();
            const parsed = rawParser.parse(c.name, c.sourceText);
            for (const charName of parsed.chars.reads) {
              node(charName, 'char', charName);
              addEdge(c.name, charName, 'reads');
            }
            for (const charName of parsed.chars.writes) {
              node(charName, 'char', charName);
              addEdge(c.name, charName, 'writes');
            }
          }

          // Constraint table references
          const cParsed = c.parsed || (c.sourceText ? new (require('./od-parser'))().parse(c.name, c.sourceText) : null);
          if (cParsed && cParsed.tables) {
            for (const [tableName, tinfo] of Object.entries(cParsed.tables)) {
              node(tableName, 'table', tableName);
              addEdge(c.name, tableName, 'uses', '');
              const struct = this.tableStructures[tableName];
              if (struct && struct.inputs && struct.inputs.length > 0) {
                for (const _col of (struct.inputs || [])) { const col=_col.replace(/[\s?]+$/,''); node(col, 'char', col); addEdge(tableName, col, 'reads'); }
                for (const _col of (struct.outputs || [])) { const col=_col.replace(/[\s?]+$/,''); node(col, 'char', col); addEdge(tableName, col, 'writes'); }
              } else {
                for (const _col of (tinfo.reads || [])) { const col=_col.replace(/[\s?]+$/,''); node(col, 'char', col); addEdge(tableName, col, 'reads'); }
                for (const _col of (tinfo.writes || [])) { const col=_col.replace(/[\s?]+$/,''); node(col, 'char', col); addEdge(tableName, col, 'writes'); }
              }
            }
          }
        }
      }

      // Parsed characteristics
      if (dep.parsed) {
        for (const charName of dep.parsed.chars.reads) {
          if (this._isSystemVar(charName)) continue;
          node(charName, 'char', charName);
          addEdge(dep.name, charName, 'reads');
        }

        for (const charName of dep.parsed.chars.writes) {
          if (this._isSystemVar(charName)) continue;
          node(charName, 'char', charName);
          addEdge(dep.name, charName, 'writes');
        }

        for (const callee of dep.parsed.calls) {
          node(callee, 'proc', callee);
          addEdge(dep.name, callee, 'calls');
        }

        // Table references
        if (dep.parsed.tables) {
          for (const [tableName, tinfo] of Object.entries(dep.parsed.tables)) {
            node(tableName, 'table', tableName);
            addEdge(dep.name, tableName, 'uses', '');
            // Use BAPI structure to determine input/output where available
            const struct = this.tableStructures[tableName];
            const usedCols = new Set([...(tinfo.reads || []), ...(tinfo.writes || [])]);
            if (struct && struct.inputs && struct.inputs.length > 0) {
              // BAPI data available: inputs=READ, outputs=WRITE
              for (const _col of (struct.inputs || [])) { const col=_col.replace(/[\s?]+$/,'');
                node(col, 'char', col);
                addEdge(tableName, col, 'reads');
              }
              for (const _col of (struct.outputs || [])) { const col=_col.replace(/[\s?]+$/,'');
                node(col, 'char', col);
                addEdge(tableName, col, 'writes');
              }
            } else {
              // Fall back to parser inference: all referenced cols are READ
              for (const _col of (tinfo.reads || [])) { const col=_col.replace(/[\s?]+$/,'');
                node(col, 'char', col);
                addEdge(tableName, col, 'reads');
              }
              for (const _col of (tinfo.writes || [])) { const col=_col.replace(/[\s?]+$/,'');
                node(col, 'char', col);
                addEdge(tableName, col, 'writes');
              }
            }
          }
        }
      } else {
        // Even without parsed data, extract chars from raw source
        if (dep.sourceText) {
          const rawParser = new (require('./od-parser'))();
          const parsed = rawParser.parse(dep.name, dep.sourceText);
          
          for (const charName of parsed.chars.reads) {
            if (this._isSystemVar(charName)) continue;
            node(charName, 'char', charName);
            addEdge(dep.name, charName, 'reads');
          }
          for (const charName of parsed.chars.writes) {
            if (this._isSystemVar(charName)) continue;
            node(charName, 'char', charName);
            addEdge(dep.name, charName, 'writes');
          }
          for (const callee of parsed.calls) {
            node(callee, 'proc', callee);
            addEdge(dep.name, callee, 'calls');
          }
        }
      }

      // Order-based edges: if dependencies have execution order, 
      // link consecutive ones
      if (dep.order) {
        // Will be handled in a separate pass if needed
      }
    }

    return {
      nodes: [...nodeMap.values()].map(n => ({
        id: n.id,
        type: n.type,
        label: n.label,
        description: n.description || '',
        status: n.status || '',
        order: n.order || '',
        design: n.design || '',
      })),
      edges: edges.map(e => ({
        source: e.source,
        target: e.target,
        type: e.type,
        label: e.label,
      })),
    };
  }

  _isSystemVar(name) {
    const systemVars = [
      'NULL', 'THIS_WILL_STOP', 'THIS_WILL_CONTINUE',
      'ROOT', 'PARENT', 'SELF', 'FREE',
      'TIMES', 'CLEAR', 'SET', 'MOVE',
    ];
    return systemVars.includes(name);
  }
}

module.exports = GraphBuilder;
