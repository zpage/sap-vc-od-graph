/**
 * dep-graph-renderer.js — Generate standalone interactive OD-CHAR dependency graph
 * Force-directed layout via D3.js (CDN), colored nodes/edges, drag+zoom.
 */
class DepGraphRenderer {
  render(profile, dependencies, graph, material) {
    const pn = (profile.C_PROFILE || '').trim();
    const dn = (profile.DESIGN || '').trim();
    const deps = dependencies || [];
    const edges = graph.edges || [];
    const nodes = graph.nodes || [];

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // Build node list: de-duplicate
    const nodeSet = {};
    for (const n of nodes) {
      if (!nodeSet[n.id]) {
        const type = n.type === 'proc' || n.type === 'cnet' ? 'od' : n.type;
        nodeSet[n.id] = { id: n.id, type, group: type === 'od' ? 1 : type === 'table' ? 3 : 2 };
      }
    }
    // Also add constraint nodes not in graph nodes
    for (const d of deps) {
      for (const c of (d.constraints || [])) {
        if (!nodeSet[c.name]) nodeSet[c.name] = { id: c.name, type: 'od', group: 1 };
      }
    }
    const nodeList = Object.values(nodeSet);

    // Build links
    const linkList = [];
    for (const e of edges) {
      if (e.type === 'reads' || e.type === 'writes') {
        linkList.push({ source: e.source, target: e.target, type: e.type });
      }
    }

    // Colors
    const groupColors = { 1: '#1a73e8', 2: '#f9a825', 3: '#9c27b0' };
    const edgeColors = { reads: '#4caf50', writes: '#e53935' };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OD Dependency Graph — ${esc(pn)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#111;color:#eee;overflow:hidden}
#header{padding:10px 16px;background:#1a1a2e;border-bottom:1px solid #333;display:flex;justify-content:space-between;align-items:center}
#header h1{font-size:14px;font-weight:600}
#header p{font-size:11px;color:#999}
#legend{display:flex;gap:12px;padding:6px 16px;background:#1a1a2e;border-bottom:1px solid #333;font-size:11px;position:sticky;top:0;z-index:10}
.legend-item{display:flex;align-items:center;gap:4px}
.legend-swatch{width:12px;height:12px;border-radius:50%;border:1px solid #444}
.legend-line{width:20px;height:2px;border-radius:1px}
#canvas{margin:0}
svg{width:100vw;height:calc(100vh - 80px);display:block;background:#111}
.node-label{font-size:9px;pointer-events:none;fill:#ccc;text-shadow:0 0 3px #111,0 0 3px #111}
.tooltip{position:absolute;padding:6px 10px;background:rgba(0,0,0,0.85);color:#fff;border-radius:4px;font-size:11px;pointer-events:none;display:none;z-index:100;border:1px solid #444;max-width:300px;white-space:nowrap}
</style>
</head>
<body>
<div id="header">
  <div><h1>OD Dependency Graph — ${esc(pn)}</h1><p>${esc(dn)} · ${nodeList.length} nodes · ${linkList.length} edges</p></div>
</div>
<div id="legend">
  <div class="legend-item"><div class="legend-swatch" style="background:#1a73e8"></div> OD</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#f9a825"></div> Characteristic</div>
  <div class="legend-item"><div class="legend-swatch" style="background:#9c27b0"></div> Table</div>
  <div class="legend-item" style="margin-left:12px"><div class="legend-line" style="background:#4caf50"></div> reads</div>
  <div class="legend-item"><div class="legend-line" style="background:#e53935"></div> writes</div>
</div>
<div id="tooltip" class="tooltip"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const tooltip = document.getElementById('tooltip');
const w = window.innerWidth, h = window.innerHeight - 80;

const nodes = ${JSON.stringify(nodeList)};
const links = ${JSON.stringify(linkList)};

const color = d => ({1:'#1a73e8',2:'#f9a825',3:'#9c27b0'}[d.group]||'#666');
const edgeColor = d => d.type === 'reads' ? '#4caf50' : '#e53935';

const svg = d3.select('body').append('svg').attr('width',w).attr('height',h);
const g = svg.append('g');

svg.call(d3.zoom().scaleExtent([0.1,8]).on('zoom', ev => g.attr('transform', ev.transform)));

const sim = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(links).id(d => d.id).distance(d => d.type === 'reads' ? 80 : 100))
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(w/2, h/2))
  .force('collision', d3.forceCollide(8));

const link = g.append('g').selectAll('line').data(links).join('line')
  .attr('stroke', d => edgeColor(d))
  .attr('stroke-width', 1.5)
  .attr('stroke-opacity', 0.5);

const node = g.append('g').selectAll('circle').data(nodes).join('circle')
  .attr('r', d => d.group === 2 ? 5 : d.group === 3 ? 6 : 7)
  .attr('fill', d => color(d))
  .attr('stroke', '#333')
  .attr('stroke-width', 1)
  .call(d3.drag()
    .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on('end', (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

const label = g.append('g').selectAll('text').data(nodes).join('text')
  .text(d => d.id.length > 25 ? d.id.slice(0,22)+'…' : d.id)
  .attr('class','node-label')
  .attr('dx', d => d.group === 2 ? 7 : 9)
  .attr('dy', 4);

node.on('mouseover', (ev, d) => {
  tooltip.style.display = 'block';
  tooltip.innerHTML = '<b>' + d.id + '</b> (' + ({1:'OD',2:'Characteristic',3:'Table'}[d.group]||'?') + ')';
  tooltip.style.left = (ev.pageX + 12) + 'px';
  tooltip.style.top = (ev.pageY - 10) + 'px';
}).on('mouseout', () => { tooltip.style.display = 'none'; });

sim.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('cx', d => d.x).attr('cy', d => d.y);
  label.attr('x', d => d.x).attr('y', d => d.y);
});
</script>
</body>
</html>`;
  }
}

module.exports = DepGraphRenderer;
