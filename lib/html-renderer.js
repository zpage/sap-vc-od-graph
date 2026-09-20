/**
 * html-renderer.js — Generate HTML page with:
 *   - PMEVC-style left tree
 *   - Middle: source code panel
 *   - Right: used-by / references panel
 */

class HtmlRenderer {
  constructor() { this._initKeywords(); }

  _initKeywords() {
    this.kwMap = {};
    const add = (clazz, words) => words.forEach(w => { this.kwMap[w.toLowerCase()] = clazz; });
    add('kw1', ['$self','$parent','$root','$set_pricing_factor','$set_default','$del_default','$count_parts','$sum_parts']);
    add('kw2', ['sin','cos','tan','exp','ln','abs','sqrt','log10','arcsin','arccos','arctan','sign','frac','ceil','trunc','floor','uc','lc']);
    add('kw3', ['table','function','pfunction']);
    add('kw4', ['mdata']);
    add('kw5', ['specified','in','type_of','part_of','subpart_of']);
    add('kw6', ['if','then','else']);
    add('kw7', ['objects','condition','restrictions','inferences']);
    add('op', ['(',')',',','.','/','+','<','=','>','||','*',':','?','and','or','not','gt','ge','lt','le','eq','ne']);
  }

  _highlightLine(line) {
    if (!line) return '';
    if (line.trimLeft().startsWith('*')) return `<span class="cm">${this._esc(line)}</span>`;
    let r='',i=0;
    while(i<line.length){const w=line.slice(i).match(/^\$?\w+(\.\w+)*/);if(w){const wd=w[0],b=wd.split('.')[0].toLowerCase(),c=this.kwMap[b]||'';r+=c?`<span class="${c}">${this._esc(wd)}</span>`:this._esc(wd);i+=wd.length;continue}let f=0;for(const[o,c]of Object.entries(this.kwMap)){if(c!=='op')continue;if(line.slice(i).toLowerCase().startsWith(o)){r+=`<span class="op">${this._esc(o)}</span>`;i+=o.length;f=1;break}}if(f)continue;r+=this._esc(line[i]);i++}
    return r;
  }

  render(profile, dependencies, graph, tableContent, classData, bomData, material) {
    const pn=(profile.C_PROFILE||'').trim(),dn=(profile.DESIGN||'').trim();
    const deps=dependencies||[],pd=deps.filter(d=>d.type==='PROC'||d.type==='17'),cd=deps.filter(d=>d.type==='CNET'||d.type==='16');
    const chars=graph.nodes.filter(n=>n.type==='char').sort((a,b)=>a.id.localeCompare(b.id));

    const cp={};for(const e of graph.edges){if(e.type==='reads'||e.type==='writes'){if(!cp[e.target])cp[e.target]=[];const d=deps.find(x=>x.name===e.source);cp[e.target].push({proc:e.source,action:e.type,order:d?d.order:''})}}
    for(const c in cp)cp[c].sort((a,b)=>(parseInt(a.order)||9999)-(parseInt(b.order)||9999));

    const to={},tc={};for(const e of graph.edges){if(e.type==='uses'){if(!to[e.target])to[e.target]=[];const d=deps.find(x=>x.name===e.source);to[e.target].push({proc:e.source,order:d?d.order:''})}if(e.type==='reads'||e.type==='writes'){const n=graph.nodes.find(x=>x.id===e.source);if(n&&n.type==='table'){if(!tc[e.source])tc[e.source]={reads:[],writes:[]};if(e.type==='reads')tc[e.source].reads.push(e.target);else tc[e.source].writes.push(e.target)}}}

    const tad={};for(const d of deps){if(d.parsed&&d.parsed.tables)for(const[tn,ti]of Object.entries(d.parsed.tables)){if(!tad[d.name])tad[d.name]=[];tad[d.name].push({table:tn,reads:ti.reads||[],writes:ti.writes||[]})}for(const c of(d.constraints||[]))if(c.parsed&&c.parsed.tables)for(const[tn,ti]of Object.entries(c.parsed.tables)){if(!tad[c.name])tad[c.name]=[];tad[c.name].push({table:tn,reads:ti.reads||[],writes:ti.writes||[]})}}

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VC OD — ${this._esc(pn)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#333;font-size:12px}
#main{display:flex;height:calc(100vh - 36px)}
#searchbar{height:36px;background:#1a1a2e;display:flex;align-items:center;padding:0 10px;position:relative;z-index:50}
#searchbar input{flex:1;max-width:600px;padding:4px 10px;border:none;border-radius:4px;font-size:12px;font-family:Consolas,monospace;outline:none}
#search-results{position:absolute;top:36px;left:10px;max-width:600px;min-width:400px;max-height:400px;overflow-y:auto;background:#fff;border:1px solid #ccc;border-radius:0 0 4px 4px;box-shadow:0 4px 12px rgba(0,0,0,.2);display:none;z-index:60}
#search-results.show{display:block}
.sr-item{padding:4px 10px;cursor:pointer;font-size:12px;font-family:Consolas,monospace;display:flex;align-items:center;gap:6px;border-bottom:1px solid #f0f0f0}
.sr-item:hover{background:#e8f0fe}
.sr-item .badge{flex-shrink:0}
#tree-panel{width:360px;min-width:300px;background:#fff;border-right:1px solid #ddd;overflow-y:auto;overflow-x:hidden;flex-shrink:0}
.tab-bar{display:flex;border-bottom:1px solid #1a1a2e;position:sticky;top:0;background:#fff;z-index:1}
.tab{flex:1;padding:5px 0;text-align:center;cursor:pointer;font-size:11px;font-weight:600;color:#999;background:#f5f5f5;border:none;border-bottom:2px solid transparent}
.tab.active{color:#1a1a2e;background:#fff;border-bottom:2px solid #1a1a2e}
.tab:hover{color:#333}
#tree-od,#tree-env{display:none}
#tree-od.show,#tree-env.show{display:block}
#source-panel{flex:1;overflow-y:auto;padding:12px;border-right:1px solid #eee}
#detail{width:340px;min-width:280px;overflow-y:auto;padding:12px;background:#fff}
.tree-item{padding:3px 6px 3px 0;cursor:pointer;display:flex;align-items:center;gap:3px;overflow:hidden;font-family:monospace;font-size:11px}
.tree-item:hover{background:#e8f0fe}.tree-item.selected{background:#1a73e8;color:#fff}.tree-item.selected .count{color:#e3f2fd}.tree-item.selected .expand-btn{color:#fff}.tree-item.selected .badge{opacity:.95}
.expand-btn{display:inline-block;width:14px;text-align:center;cursor:pointer;user-select:none;color:#999;font-size:10px;flex-shrink:0}
.children{display:none}.children.open{display:block}
.count{color:#999;font-size:10px;margin-left:2px}
.src-line{font-family:Consolas,'SF Mono','Fira Code',monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-all}
.src-line .cm{color:#808080}.src-line .kw1{color:#00f}.src-line .kw2{color:#808080;font-weight:700}.src-line .kw3{color:#00008b;font-weight:700}.src-line .kw4{color:#483d8b;text-decoration:underline}.src-line .kw5{color:#00008b;font-weight:700}.src-line .kw6{color:red;font-weight:700;font-style:italic}.src-line .kw7{color:#d2691e;background:#ff0;text-decoration:underline}.src-line .op{color:#ff8c00;font-weight:700}
.badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:10px;line-height:1.4;flex-shrink:0}
.badge.PROC{background:#e8f4fd;color:#1a73e8}.badge.CNET{background:#fde8e4;color:#d93025}.badge.CONSTRAINT{background:#fff3e0;color:#e65100}.badge.tbl{background:#f3e5f5;color:#9c27b0}.badge.char{background:#fff8e1;color:#f9a825}.badge.func{background:#e0f2f1;color:#00796b}
.badge.input{background:#fff3cd;color:#856404}.badge.output{background:#f8d7da;color:#721c24}.badge.default{background:#d4edda;color:#155724}
.sec{margin-bottom:14px}.sec h3{font-size:11px;color:#666;text-transform:uppercase;margin-bottom:4px;border-bottom:1px solid #eee;padding-bottom:2px}
.proc-row{font-size:12px;padding:2px 0;display:flex;align-items:center;gap:4px}
#source-panel h2{font-size:14px;margin-bottom:8px}.empty{color:#999;font-size:13px;text-align:center;margin-top:40px}
</style>
</head>
<body>
<div id="searchbar"><input id="search-input" type="text" placeholder="Search OD / char / table / class..." autocomplete="off"><div id="search-results"></div></div>
<div id="main">
  <div id="tree-panel"></div>
  <div id="source-panel"><div class="empty">Select an OD to view source</div></div>
  <div id="detail"><div class="empty">Select an item to view details</div></div>
</div>
<script id="d" type="application/json">${JSON.stringify({
  PROFILE:profile,CHARS:chars,CHARC_PROCS:cp,TABLES:graph.nodes.filter(n=>n.type==='table').map(n=>n.id),TABLE_ODS:to,TABLE_CHARS:tc,TAB_ODS:tad,
  DEPS:deps.map(d=>({name:d.name,type:d.type,status:d.status,description:d.description,order:d.order,parsed:d.parsed||null,constraints:(d.constraints||[]).map(c=>({name:c.name,parsed:c.parsed||null}))})),
  CLASSES:(classData||[]).map(c=>({name:c.name,chars:c.chars})),
  BOM:bomData||{mast:[],stpo:[]},
  MATNR:material||''
})}</script>
<script id="te" type="application/json">${JSON.stringify(tableContent||{})}</script>
<script id="s" type="application/json">${JSON.stringify(Object.fromEntries([...deps.map(d=>[d.name,Array.isArray(d.source)?d.source.filter(l=>l.trim()):(d.sourceLines||[])]),...deps.flatMap(d=>(d.constraints||[]).map(c=>[c.name,Array.isArray(c.source)?c.source.filter(l=>l.trim()):[]]))]))}</script>
<script>
const _d=JSON.parse(document.getElementById('d').textContent),_s=JSON.parse(document.getElementById('s').textContent);
for(const d of _d.DEPS){d.source=_s[d.name]||[];for(const c of(d.constraints||[]))c.source=_s[c.name]||[]}
var PROFILE=_d.PROFILE,DEPS=_d.DEPS,CHARS=_d.CHARS,CHARC_PROCS=_d.CHARC_PROCS,TABLES=_d.TABLES,TABLE_ODS=_d.TABLE_ODS,TABLE_CHARS=_d.TABLE_CHARS,TAB_ODS=_d.TAB_ODS,CLASSES=_d.CLASSES||[],BOM=_d.BOM||{mast:[],stpo:[]},MATNR=_d.MATNR||'';
var TE=(function(){try{return JSON.parse(document.getElementById('te').textContent)}catch(e){return {}}}());
var tp=document.getElementById('tree-panel'),sp=document.getElementById('source-panel'),dp=document.getElementById('detail');
const PL=DEPS.filter(d=>d.type==='PROC'||d.type==='CNET'||d.type==='16'||d.type==='17').sort((a,b)=>{const ta=isCNET(a.type)?0:1,tb=isCNET(b.type)?0:1;return ta!==tb?ta-tb:(parseInt(a.order)||9999)-(parseInt(b.order)||9999)});
function isCNET(t){return t==='CNET'||t==='16'}
function isPROC(t){return t==='PROC'||t==='17'}
const cd={};for(const d of DEPS){if(d.parsed)for(const c of(d.parsed.chars.defaults||[])){if(!cd[c])cd[c]=new Set();cd[c].add(d.name)}for(const c of(d.constraints||[]))if(c.parsed)for(const ch of(c.parsed.chars.defaults||[])){if(!cd[ch])cd[ch]=new Set();cd[ch].add(c.name)}}
const KW={"$self":"kw1","$parent":"kw1","$root":"kw1","$set_pricing_factor":"kw1","$set_default":"kw1","$del_default":"kw1","$count_parts":"kw1","$sum_parts":"kw1","sin":"kw2","cos":"kw2","tan":"kw2","exp":"kw2","ln":"kw2","abs":"kw2","sqrt":"kw2","log10":"kw2","arcsin":"kw2","arccos":"kw2","arctan":"kw2","sign":"kw2","frac":"kw2","ceil":"kw2","trunc":"kw2","floor":"kw2","uc":"kw2","lc":"kw2","table":"kw3","function":"kw3","pfunction":"kw3","mdata":"kw4","specified":"kw5","in":"kw5","type_of":"kw5","part_of":"kw5","subpart_of":"kw5","if":"kw6","then":"kw6","else":"kw6","objects":"kw7","condition":"kw7","restrictions":"kw7","inferences":"kw7","(":"op",")":"op",",":"op",".":"op","/":"op","+":"op","<":"op","=":"op",">":"op","||":"op","*":"op",":":"op","'":"op","?":"op","and":"op","or":"op","not":"op","gt":"op","ge":"op","lt":"op","le":"op","eq":"op","ne":"op"};
function hl(line){if(!line)return '';if(line.trimLeft().startsWith('*'))return '<span class="cm">'+esc(line)+'</span>';let r='',i=0;while(i<line.length){const w=line.slice(i).match(new RegExp('^\\\\$?\\\\w+(\\\\.\\\\w+)*'));if(w){const wd=w[0],b=wd.split('.')[0].toLowerCase(),c=KW[b]||'';r+=c?'<span class="'+c+'">'+esc(wd)+'</span>':esc(wd);i+=wd.length;continue}let f=0;for(const[op,c]of Object.entries(KW)){if(c!=='op')continue;if(line.slice(i).toLowerCase().startsWith(op)){r+='<span class="op">'+esc(op)+'</span>';i+=op.length;f=1;break}}if(f)continue;r+=esc(line[i]);i++}return r}
function renderSource(src){if(!src||src.length===0)return '<div class="empty">No source code</div>';const al=src.filter(l=>l.trim()&&!l.trimLeft().startsWith('*')).length;let h='<div class="sec"><h3>Source ('+src.length+' lines, '+al+' active)</h3>';h+=src.map((l,idx)=>'<div class="src-line"><span style="color:#ccc;user-select:none">'+String(idx+1).padStart(4,'0')+'</span> '+hl(l)+'</div>').join('');return h+'</div>'}
function togS(id){const d=document.getElementById(id);const b=document.getElementById(id+'_b');if(!d||!b)return;const h=d.style.display==='none';d.style.display=h?'':'none';b.innerHTML=h?'&#9660;':'&#9654;';}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function h2(s){return '<h2>'+esc(s)+'</h2>'}

// Tree building — click handlers use data-dn attribute
function switchTab(t){
  document.getElementById('tree-od').className=t==='od'?'show':'';
  document.getElementById('tree-env').className=t==='env'?'show':'';
  document.querySelectorAll('.tab').forEach((el,i)=>{el.className='tab'+(i===(t==='od'?0:1)?' active':'')});
  if(t==='env')showEnvironment();
  else showProfile();
}
function buildTree(){
  let h='<div class="tab-bar"><div class="tab active" data-tab="od">Profile</div><div class="tab" data-tab="env">Environment</div></div>';
  h+='<div id="tree-od" class="show">';
  h+='<div class="tree-item" data-dn="__profile__" data-tab="env"><span style="font-weight:600">'+esc(PROFILE.C_PROFILE||'PROFILE')+'</span> <span class="badge" style="background:#1a1a2e;color:#fff">PROFILE</span></div>';
  for(const d of PL){const ic=isCNET(d.type),cl=ic?'CNET':'PROC',os=d.order?d.order.padStart(4,'0')+' ':'';
    var uniqReads=(d.parsed?[...new Set([...(d.parsed.chars.reads||[]),...(d.parsed.chars.writes||[])])]:[]).length;const rw=uniqReads,tc=TAB_ODS[d.name]?TAB_ODS[d.name].length:0,fc=d.parsed?(d.parsed.calls||[]).length:0,cc=rw+tc+fc+(d.constraints||[]).length;
    h+='<div><div class="tree-item" style="padding-left:16px" data-dn="'+esc(d.name)+'">';
    h+=cc>0?'<span class="expand-btn" data-expand="1">&#9654;</span>':'<span class="expand-btn" style="visibility:hidden">&#9654;</span>';
    h+='<span class="badge '+cl+'">'+cl+'</span><span class="count">'+os+esc(d.name)+' ('+rw+'c'+(tc?','+tc+'t':'')+(fc?','+fc+'f':'')+')</span></div>';
    if(cc>0){h+='<div class="children" style="padding-left:16px">';
      for(const c of(d.constraints||[])){var uniqCR=[...new Set([...(c.parsed?c.parsed.chars.reads||[]:[]),...(c.parsed?c.parsed.chars.writes||[]:[])])].length;const cr=uniqCR,ct=TAB_ODS[c.name]?TAB_ODS[c.name].length:0,cc2=cr+ct+(c.parsed?(c.parsed.calls||[]).length:0);
        h+='<div><div class="tree-item" style="padding-left:16px" data-dn="'+esc(c.name)+'">';
        h+=cc2>0?'<span class="expand-btn" data-expand="1">&#9654;</span>':'<span class="expand-btn" style="visibility:hidden">&#9654;</span>';
        h+='<span class="badge CONSTRAINT">CONSTRAINT</span><span class="count">'+esc(c.name)+' ('+cr+'c'+(ct?','+ct+'t':'')+')</span></div>';
        if(cc2>0){h+='<div class="children" style="padding-left:16px">';
          if(c.parsed)for(const ch of[...new Set([...(c.parsed.chars.reads||[]),...(c.parsed.chars.writes||[])])].sort()){let b=[];(c.parsed.chars.reads||[]).includes(ch)&&b.push('input');(c.parsed.chars.writes||[]).includes(ch)&&b.push('output');(c.parsed.chars.defaults||[]).includes(ch)&&b.push('default');h+='<div class="tree-item" style="padding-left:16px" data-dn="C:'+esc(ch)+'"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge char">CHAR</span><span class="count">'+esc(ch)+'</span>'+b.map(x=>'<span class="badge '+x+'">'+x[0].toUpperCase()+'</span>').join('')+'</div>'}
          for(const t of(TAB_ODS[c.name]||[]))h+='<div class="tree-item" style="padding-left:16px" data-dn="T:'+esc(t.table)+'"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge tbl">TABLE</span><span class="count">'+esc(t.table)+'</span></div>'
          h+='</div>'}
        h+='</div>'}
      if(d.parsed&&!ic)for(const ch of[...new Set([...(d.parsed.chars.reads||[]),...(d.parsed.chars.writes||[])])].sort()){let b=[];(d.parsed.chars.reads||[]).includes(ch)&&b.push('input');(d.parsed.chars.writes||[]).includes(ch)&&b.push('output');(d.parsed.chars.defaults||[]).includes(ch)&&b.push('default');h+='<div class="tree-item" style="padding-left:16px" data-dn="C:'+esc(ch)+'"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge char">CHAR</span><span class="count">'+esc(ch)+'</span>'+b.map(x=>'<span class="badge '+x+'">'+x[0].toUpperCase()+'</span>').join('')+'</div>'}
      for(const t of(TAB_ODS[d.name]||[]))h+='<div class="tree-item" style="padding-left:16px" data-dn="T:'+esc(t.table)+'"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge tbl">TABLE</span><span class="count">'+esc(t.table)+'</span></div>'
      if(d.parsed)for(const fn of(d.parsed.calls||[]))h+='<div class="tree-item" style="padding-left:16px"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge func">FUNC</span><span class="count">'+esc(fn)+'</span></div>'
      h+='</div>'}
    h+='</div>'}
  h+='</div>'
  let eh='<div id="tree-env">';
  let hc='<div class="sec"><h3>Classes ('+CLASSES.length+')</h3>';
  for(const cl of CLASSES){
    hc+='<div><div class="tree-item" style="padding-left:4px" data-toggle="class" data-class="'+esc(cl.name)+'"><span class="expand-btn" style="cursor:pointer;user-select:none;color:#999;font-size:10px">&#9654;</span><span class="badge" style="background:#1a1a2e;color:#fff">CLASS</span><span class="count">'+esc(cl.name)+' ('+new Set(cl.chars).size+'c)</span></div><div class="children" style="padding-left:16px">';
    for(const ch of [...new Set(cl.chars)].sort()){
      const cp2=CHARC_PROCS[ch]||[];
      hc+='<div class="tree-item" data-dn="C:'+esc(ch)+'" style="cursor:pointer"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge char">CHAR</span><span class="count">'+esc(ch)+'</span><span style="color:#999;font-size:10px"> ('+cp2.length+' ODs)</span></div>';}
    hc+='</div></div>';}
  hc+='</div>';
  let ht='<div class="sec"><h3>Tables ('+TABLES.length+')</h3>';
  for(const t of TABLES.slice().sort()){const tc=TABLE_CHARS[t]||{reads:[],writes:[]};ht+='<div class="tree-item" data-dn="T:'+esc(t)+'" style="cursor:pointer"><span class="badge tbl">TABLE</span><span class="count">'+esc(t)+'</span><span style="color:#999;font-size:10px"> ('+(tc.reads||[]).length+'i, '+(tc.writes||[]).length+'o)</span></div>'}
  ht+='</div>';
  // BOM section
  var bapiItems=BOM.bapi&&BOM.bapi.stpo||[];
  if(bapiItems.length>0){
    eh+='<div class="sec"><h3 style="cursor:pointer" data-bomh="1">BOM ('+esc(BOM.bapi.stlnr||'')+')</h3>';
    eh+='<div style="padding:2px 6px;font-size:10px;color:#999">'+esc(BOM.bapi.plant||'')+' · '+esc(BOM.bapi.stlan||'')+' · '+bapiItems.length+' items</div>';
    for(var bi=0;bi<bapiItems.length;bi++){
      var it=bapiItems[bi];
      var objs=(BOM.classObjects||{})[it.CLASS]||[];
      var hasObjs=it.ITEM_CATEG==='K'&&objs.length>0;
      eh+='<div>';
      eh+='<div class="tree-item" style="cursor:pointer;font-size:10px" data-bomi="'+esc(it.ITEM_NO||'')+'" data-icat="'+(it.ITEM_CATEG||'')+'" data-cls="'+(it.CLASS||'')+'">';
      if(hasObjs){eh+='<span class="expand-btn" onclick="tog(this,event)" style="cursor:pointer;user-select:none;color:#999;font-size:10px">&#9654;</span>';}
      else{eh+='<span class="expand-btn" style="visibility:hidden">&#9654;</span>';}
      eh+='<span class="badge" style="background:#455a64;color:#fff">'+esc(it.ITEM_NO||'')+'</span><span class="count">'+esc(it.CLASS||it.COMPONENT||'')+'</span><span style="color:#999;font-size:9px"> '+esc(it.COMP_QTY||'')+' '+esc(it.COMP_UNIT||'')+'</span>';
      eh+='</div>';
      if(hasObjs){
        eh+='<div class="children" style="padding-left:16px">';
        for(var oi=0;oi<Math.min(objs.length,30);oi++){
          eh+='<div class="tree-item" style="font-size:9px;cursor:pointer" data-bomi="'+esc(it.ITEM_NO||'')+'" data-icat="'+(it.ITEM_CATEG||'')+'" data-cls="'+(it.CLASS||'')+'"><span class="expand-btn" style="visibility:hidden">&#9654;</span><span class="badge" style="background:#9c27b0;color:#fff;font-size:8px">MAT</span><span class="count">'+esc(objs[oi])+'</span></div>';
        }
        if(objs.length>30)eh+='<div style="color:#999;font-size:8px;padding:2px 6px">… '+(objs.length-30)+' more</div>';
        eh+='</div>';
      }
      eh+='</div>';
    }
    eh+='</div>';
  }
  eh+=hc+ht+'</div>';
  tp.innerHTML=h+eh;
}
function tog(b,ev){if(ev)ev.stopPropagation();const c=b.parentElement.nextElementSibling;if(c&&c.classList.contains('children')){c.classList.toggle('open');b.innerHTML=c.classList.contains('open')?'&#9660;':'&#9654;'}}
function clickTree(el){const dn=el.dataset.dn;if(!dn)return;if(dn==='__profile__'){switchTab('env');return}if(dn.startsWith('C:')){showChar(dn.slice(2));return}if(dn.startsWith('T:')){showTable(dn.slice(2));return}showOD(dn)}
function showEnvironment(){
  sp.innerHTML='<div class="empty">Click an item in the left panel</div>';
  var envHeader=document.getElementById('env-header');
  if(!envHeader){
    envHeader=document.createElement('div');
    envHeader.id='env-header';
    envHeader.style.cssText='padding:6px 8px;border-bottom:1px solid #ddd;font-size:11px;color:#666;background:#f8f9fa';
    var tee=document.getElementById('tree-env');
    if(tee)tee.parentNode.insertBefore(envHeader, tee);
  }
  envHeader.innerHTML=esc(PROFILE.C_PROFILE||'PROFILE')+' · '+esc(PROFILE.DESIGN||'')+' · '+CLASSES.length+' classes · '+CHARS.length+' chars · '+TABLES.length+' tables';
  dp.innerHTML='<div class="empty">Select an item to view details</div>';}
function showClass(cls){
  var cl=CLASSES.find(function(c){return c.name===cls});
  if(!cl){sp.innerHTML='<div class="empty">Class not found: '+esc(cls)+'</div>';return}
  var matNum=esc(PROFILE.C_PROFILE||'');
  var uniq=[...new Set(cl.chars)].sort();
  var h='<h2>'+esc(cls)+' <span class="badge" style="background:#1a1a2e;color:#fff">CLASS</span></h2>';
  h+='<p style="color:#666;margin:6px 0">'+uniq.length+' characteristics</p>';
  h+='<div class="sec"><h3>Characteristics ('+uniq.length+')</h3>';
  for(var i=0;i<uniq.length;i++){
    var ch=uniq[i];
    var cp2=CHARC_PROCS[ch]||[];
    var odSet=new Set();for(var pi=0;pi<cp2.length;pi++){if(TABLES.indexOf(cp2[pi].proc)<0)odSet.add(cp2[pi].proc);}
    var uniqODs=odSet.size;
    var tblCnt=0;for(var ti=0;ti<TABLES.length;ti++){var tc=TABLE_CHARS[TABLES[ti]];if(tc&&((tc.reads||[]).indexOf(ch)>=0||(tc.writes||[]).indexOf(ch)>=0))tblCnt++}
    h+='<div class="proc-row"><a href="#" data-n="'+esc(ch)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(ch)+'</a> <span style="color:#999;font-size:10px">('+uniqODs+' ODs'+(tblCnt?', '+tblCnt+' tables':'')+')</span></div>';}
  h+='</div>';
  sp.innerHTML=h;
  dp.innerHTML=h2(cls)+'<span class="badge" style="background:#1a1a2e;color:#fff">CLASS</span><p style="color:#999;margin:4px 0">'+uniq.length+' chars</p>';}
function showBOMItem(ino,icat,cls){
  if(!icat)icat='';
  var items=BOM.bapi&&BOM.bapi.stpo||[];
  var item=null;for(var i=0;i<items.length;i++){if(items[i].ITEM_NO===ino){item=items[i];break}}
  if(!item){sp.innerHTML='<div class="empty">Item '+esc(ino)+' not found</div>';return}
  var h='<h2>'+esc(ino)+' <span class="badge" style="background:#455a64;color:#fff">'+esc(icat)+'</span></h2>';
  if(item.COMPONENT)h+='<p style="color:#666;margin:4px 0">Material: '+esc(item.COMPONENT)+'</p>';
  if(item.CLASS)h+='<p style="color:#666;margin:4px 0">Class: '+esc(item.CLASS)+'</p>';
  h+='<p style="color:#999;font-size:10px;margin:4px 0">Qty: '+esc(item.COMP_QTY||'')+' '+esc(item.COMP_UNIT||'')+'</p>';
  // Show linked ODs from T_DEP_ORDER
  var deps=(BOM.bapi&&BOM.bapi.depOrder)||[];
  var itemDeps=deps.filter(function(d){return d.ITEM_NODE===item.ITEM_NODE});
  if(itemDeps.length>0){
    h+='<div class="sec"><h3>Linked ODs ('+itemDeps.length+')</h3>';
    for(var di=0;di<itemDeps.length;di++){
      var dn=itemDeps[di].DEP_INTERN||'';
      h+='<div class="proc-row"><span style="color:#1a73e8;cursor:pointer" data-dep="'+esc(dn)+'">'+esc(dn)+'</span></div>';
    }
    h+='</div>';
  }
  // For K items: show class chars in middle panel + classified objects in right panel
  if(icat==='K'&&item.CLASS){
    showClass(item.CLASS);
    var objs=(BOM.classObjects||{})[item.CLASS]||[];
    var dh='<h3>Classified Objects ('+objs.length+')</h3>';
    for(var oi=0;oi<Math.min(objs.length,50);oi++){
      dh+='<div class="proc-row" style="font-size:10px">'+esc(objs[oi])+'</div>';
    }
    if(objs.length>50)dh+='<div style="color:#999;font-size:9px;margin-top:4px">\\u2026 '+objs.length+' total</div>';
    dp.innerHTML=dh;
    return;
  }
  sp.innerHTML=h;
  dp.innerHTML='<div class="empty">Select a char to view details</div>';}
function showDepSource(nm){
  var lines=(BOM.bapi&&BOM.bapi.depSource||{})[nm]||[];
  if(lines.length>0){
    sp.innerHTML='<h2 style="margin-bottom:4px">'+esc(nm)+' <span class="badge" style="background:#455a64;color:#fff">EXT PROC</span></h2>'+renderSource(lines);
    // Simple I/O analysis from source lines
    var reads=[],writes=[];
    try {
    for(var si=0;si<Math.min(lines.length,200);si++){
      var line=lines[si].trim();
      if(!line||line.startsWith('*')||/^(IF|if|ELSE|else|ENDIF|endif|THEN|then|AND|and|OR|or|NOT|not)\b/.test(line))continue;
      var reAll=/(?:[$]self|[$]parent|[$]SELF|[$]PARENT)\\.(\\w+)/g;
      var reAlias=new RegExp('([A-Z][a-zA-Z0-9_]*)\\\\.(\\\\w+)','g');
      if(line.includes('=')){
        // Check if it's an assignment (self.XXX = ...) vs comparison (>=, <=, ==, <>)
        var eqTypes=[{s:'>=',g:2},{s:'<=',g:2},{s:'==',g:2},{s:'<>',g:2},{s:'=',g:1}];
        var eqPos=-1,eqLen=0;
        for(var eti=0;eti<eqTypes.length;eti++){var p=line.indexOf(eqTypes[eti].s);if(p>=0&&(eqPos<0||p<eqPos)){eqPos=p;eqLen=eqTypes[eti].g;}}
        if(eqPos>=0&&eqLen===1){
          // Assignment: LHS→writes, RHS→reads
          var lhs=line.substring(0,eqPos);var rhs=line.substring(eqPos+eqLen);
          reAll.lastIndex=0;var lm;while((lm=reAll.exec(lhs))!==null){if(writes.indexOf(lm[1])<0)writes.push(lm[1]);}
          reAlias.lastIndex=0;var la;while((la=reAlias.exec(lhs))!==null){if(writes.indexOf(la[2])<0)writes.push(la[2]);}
          reAll.lastIndex=0;var rm;while((rm=reAll.exec(rhs))!==null){if(reads.indexOf(rm[1])<0)reads.push(rm[1]);}
          reAlias.lastIndex=0;var ra;while((ra=reAlias.exec(rhs))!==null){if(reads.indexOf(ra[2])<0)reads.push(ra[2]);}
        } else {
          // Comparison or no clear assignment: all vars are reads
          reAll.lastIndex=0;var am;while((am=reAll.exec(line))!==null){if(reads.indexOf(am[1])<0)reads.push(am[1]);}
          reAlias.lastIndex=0;var aa;while((aa=reAlias.exec(line))!==null){if(reads.indexOf(aa[2])<0)reads.push(aa[2]);}
        }
      } else {
        // No = sign: all vars on this line are reads
        reAll.lastIndex=0;var am;while((am=reAll.exec(line))!==null){if(reads.indexOf(am[1])<0)reads.push(am[1]);}
        reAlias.lastIndex=0;var aa;while((aa=reAlias.exec(line))!==null){if(reads.indexOf(aa[2])<0)reads.push(aa[2]);}
      }
    }
    } catch(e){}
    // Check if this is a selection condition (type 5 or 15) - all chars are inputs
    var selCond=BOM.bapi&&BOM.bapi.depData&&(BOM.bapi.depData[nm]==='5'||BOM.bapi.depData[nm]==='15');
    if(selCond){reads=[...new Set([...reads,...writes])];writes=[];}
    var all=[...new Set([...reads,...writes])].sort();
    var h=h2(nm)+'<span class="badge" style="background:#455a64;color:#fff">EXT PROC</span>';
    if(all.length>0){h+='<div class="sec"><h3>Chars ('+all.length+')</h3>';
      for(var ci=0;ci<all.length;ci++){var c=all[ci];var b=[];reads.includes(c)&&b.push('<span class="badge input">input</span>');writes.includes(c)&&b.push('<span class="badge output">output</span>');h+='<div class="proc-row"><span style="color:#1a73e8">'+esc(c)+'</span> '+b.join(' ')+'</div>';}
      h+='</div>';}
    dp.innerHTML=h;
  } else {
    sp.innerHTML='<div class="empty">Source not available for '+esc(nm)+'</div>';
  }}
function showBOMDetail(){
  var items=BOM.bapi&&BOM.bapi.stpo||[];
  if(!items.length){sp.innerHTML='<div class="empty">No BOM items</div>';return}
  var h='<h2>BOM '+esc(BOM.bapi.stlnr||'')+'</h2>';
  h+='<p style="color:#666;margin:4px 0">'+esc(BOM.bapi.plant||'')+' · '+esc(BOM.bapi.stlan||'')+'</p>';
  h+='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#1a1a2e;color:#fff;position:sticky;top:0">';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Pos.</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Component</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Item ID</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Item Category</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Class Type</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">Class Name</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:right">Qty</th>';
  h+='<th style="padding:3px 6px;border:1px solid #333;text-align:left">UoM</th></tr></thead><tbody>';
  for(var bi=0;bi<items.length;bi++){
    var it=items[bi];
    h+='<tr style="border-bottom:1px solid #ddd">';
    h+='<td style="padding:3px 6px">'+esc(it.ITEM_NO||'')+'</td>';
    h+='<td style="padding:3px 6px">'+esc(it.COMPONENT||'')+'</td>';
    h+='<td style="padding:3px 6px">'+esc(it.ITM_IDENT||'')+'</td>';
    h+='<td style="padding:3px 6px"><span class="badge" style="background:#455a64;color:#fff;font-size:9px">'+esc(it.ITEM_CATEG||'')+'</span></td>';
    h+='<td style="padding:3px 6px"><span class="badge" style="background:#1a1a2e;color:#fff;font-size:9px">'+esc(it.CLASS_TYPE||'')+'</span></td>';
    h+='<td style="padding:3px 6px">'+esc(it.CLASS||'')+'</td>';
    h+='<td style="padding:3px 6px;text-align:right">'+esc(it.COMP_QTY||'')+'</td>';
    h+='<td style="padding:3px 6px">'+esc(it.COMP_UNIT||'')+'</td></tr>';
  }
  h+='</tbody></table>';
  sp.innerHTML=h;
  dp.innerHTML='<div class="empty">Select an item to view details</div>';}
// Detail panel
// Detail panel
function showProfile(){const np=DEPS.filter(d=>isPROC(d.type)).length,nc=DEPS.filter(d=>isCNET(d.type)).length;sp.innerHTML='<h2>'+esc(PROFILE.C_PROFILE||'PROFILE')+' <span class="badge" style="background:#1a1a2e;color:#fff">PROFILE</span></h2><p style="color:#666;margin:6px 0">'+esc(PROFILE.DESIGN||'')+' · '+DEPS.length+' deps ('+np+' PROC, '+nc+' CNET) · '+CHARS.length+' chars · '+TABLES.length+' tables</p>';let h=h2(PROFILE.C_PROFILE||'PROFILE')+'<span class="badge" style="background:#1a1a2e;color:#fff">PROFILE</span><div class="sec"><h3>Dependencies ('+DEPS.length+')</h3>';for(const d of DEPS)h+='<div class="proc-row"><span class="badge '+d.type+'">'+d.type+'</span> '+esc(d.name)+'</div>';dp.innerHTML=h+'</div>'}
function showOD(nm){
  if(TABLES.includes(nm)){showTable(nm);return}
  let d=DEPS.find(x=>x.name===nm);if(!d){for(const x of DEPS){const c=(x.constraints||[]).find(y=>y.name===nm);if(c){d={name:c.name,type:'CONSTRAINT',source:c.source||[],parsed:c.parsed||null,description:'',order:''};break}}}
  if(!d)return;const src=d.source||[],pr=d.parsed;
  if(isCNET(d.type)){sp.innerHTML='<div class="empty"></div>'}else{sp.innerHTML='<h2 style="margin-bottom:4px">'+esc(nm)+' <span class="badge '+(isCNET(d.type)?'CNET':isPROC(d.type)?'PROC':d.type)+'">'+(isCNET(d.type)?'CNET':isPROC(d.type)?'PROC':d.type)+'</span></h2>'+renderSource(src)}
  let h=h2(nm)+'<span class="badge '+d.type+'">'+d.type+'</span>';
  if(d.description)h+='<p style="margin:6px 0;color:#666">'+esc(d.description)+'</p>';if(d.order)h+='<p style="color:#999">Order: '+d.order+'</p>';
  if(pr&&!isCNET(d.type)){const rd=pr.chars.reads||[],wr=pr.chars.writes||[],df=pr.chars.defaults||[],cl=pr.calls||[],all=[...new Set([...rd,...wr])].sort()
    if(all.length>0){h+='<div class="sec"><h3>Chars ('+all.length+')</h3>';for(const c of all){let b=[];rd.includes(c)&&b.push('<span class="badge input">input</span>');wr.includes(c)&&b.push('<span class="badge output">output</span>');df.includes(c)&&b.push('<span class="badge default">default</span>');var cx=0,cl2=_s[nm]||[],crx=new RegExp('(^|[^A-Z0-9_])('+c+')(?![A-Z0-9_])','g');for(var cxi=0;cxi<cl2.length;cxi++){var cxm=cl2[cxi].match(crx);if(cxm)cx+=cxm.length;}h+='<div class="proc-row"><a href="#" data-n="'+esc(c)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(c)+'</a> '+b.join(' ')+'<span class="count" style="color:#999" title="'+cx+' references in source">x'+cx+'</span></div>'}h+='</div>'}
    if(cl.length>0)h+='<div class="sec"><h3>Calls</h3>'+cl.map(f=>'<div class="proc-row"><span class="badge func">FUNC</span> '+esc(f)+'</div>').join('')+'</div>'}
  // Fallback I/O for deps without parsed data (AVC constraints etc.)
  if(src.length>0&&!pr&&!isCNET(d.type)){
    var reads=[],writes=[];
    for(var si=0;si<Math.min(src.length,200);si++){
      var line=src[si].trim();
      if(!line||line.startsWith('*')||/^(IF|if|ELSE|else|ENDIF|endif|THEN|then|AND|and|OR|or|NOT|not)\b/.test(line))continue;
      var reAll=/(?:[$]self|[$]parent|[$]SELF|[$]PARENT)\\.(\\w+)/g;
      var reAlias=new RegExp('([A-Z][a-zA-Z0-9_]*)\\\\.(\\\\w+)','g');
      if(line.includes('=')){
        var eqTypes=[{s:'>=',g:2},{s:'<=',g:2},{s:'==',g:2},{s:'<>',g:2},{s:'=',g:1}];
        var eqPos=-1,eqLen=0;
        for(var eti=0;eti<eqTypes.length;eti++){var p=line.indexOf(eqTypes[eti].s);if(p>=0&&(eqPos<0||p<eqPos)){eqPos=p;eqLen=eqTypes[eti].g;}}
        if(eqPos>=0&&eqLen===1){
          var lhs=line.substring(0,eqPos);var rhs=line.substring(eqPos+eqLen);
          reAll.lastIndex=0;var lm;while((lm=reAll.exec(lhs))!==null){if(writes.indexOf(lm[1])<0)writes.push(lm[1]);}
          reAlias.lastIndex=0;var la;while((la=reAlias.exec(lhs))!==null){if(writes.indexOf(la[2])<0)writes.push(la[2]);}
          reAll.lastIndex=0;var rm;while((rm=reAll.exec(rhs))!==null){if(reads.indexOf(rm[1])<0)reads.push(rm[1]);}
          reAlias.lastIndex=0;var ra;while((ra=reAlias.exec(rhs))!==null){if(reads.indexOf(ra[2])<0)reads.push(ra[2]);}
        } else {
          reAll.lastIndex=0;var am;while((am=reAll.exec(line))!==null){if(reads.indexOf(am[1])<0)reads.push(am[1]);}
          reAlias.lastIndex=0;var aa;while((aa=reAlias.exec(line))!==null){if(reads.indexOf(aa[2])<0)reads.push(aa[2]);}
        }
      } else {
        reAll.lastIndex=0;var am;while((am=reAll.exec(line))!==null){if(reads.indexOf(am[1])<0)reads.push(am[1]);}
        reAlias.lastIndex=0;var aa;while((aa=reAlias.exec(line))!==null){if(reads.indexOf(aa[2])<0)reads.push(aa[2]);}
      }
    }
    var all2=[...new Set([...reads,...writes])].sort();
    if(all2.length>0){h+='<div class="sec"><h3>Chars ('+all2.length+')</h3>';for(var ci=0;ci<all2.length;ci++){var ch=all2[ci];var b=[];reads.includes(ch)&&b.push('<span class="badge input">input</span>');writes.includes(ch)&&b.push('<span class="badge output">output</span>');var cx=0,cl2=_s[nm]||[],crx=new RegExp('(^|[^A-Z0-9_])('+ch+')(?![A-Z0-9_])','g');for(var cxi=0;cxi<cl2.length;cxi++){var cxm=cl2[cxi].match(crx);if(cxm)cx+=cxm.length;}h+='<div class="proc-row"><span style="color:#1a73e8">'+esc(ch)+'</span> '+b.join(' ')+'<span class="count" style="color:#999" title="'+cx+' references in source">x'+cx+'</span></div>';}h+='</div>';}
  }
  if(isCNET(d.type)&&d.constraints.length>0)h+='<div class="sec"><h3>Constraints</h3>'+d.constraints.map(c=>'<div class="proc-row"><a href="#" data-n="'+esc(c.name)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(c.name)+'</a></div>').join('')+'</div>';
  const tbs=TAB_ODS[nm]||[];if(tbs.length>0){h+='<div class="sec"><h3>Tables</h3>';for(const t of tbs)h+='<div class="proc-row"><a href="#" data-n="'+esc(t.table)+'" data-clk="1" style="color:#9c27b0;text-decoration:none">'+esc(t.table)+'</a></div>';h+='</div>'}
  dp.innerHTML=h;}
function showChar(nm){
  const pr=CHARC_PROCS[nm]||[];
  const om={};for(const d of DEPS){om[d.name]=d.order||'';for(const c of(d.constraints||[]))om[c.name]='0000'}
  let h=h2(nm)+'<span class="badge char">CHAR</span>';
  var clsList=[];for(var ci=0;ci<CLASSES.length;ci++){if(CLASSES[ci].chars.indexOf(nm)>=0)clsList.push(CLASSES[ci].name)}
  if(clsList.length>0){
    h+='<div class="sec"><h3>Classes ('+clsList.length+')</h3>';
    for(var ci=0;ci<clsList.length;ci++)h+='<div class="proc-row"><a href="#" data-class="'+esc(clsList[ci])+'" style="color:#1a73e8;text-decoration:none">'+esc(clsList[ci])+'</a></div>';
    h+='</div>'}
  if(pr.length>0){
    const mg={};for(const p of pr){if(!mg[p.proc])mg[p.proc]=new Set();mg[p.proc].add(p.action)}
    const ods=Object.entries(mg).filter(function(e){return!TABLES.includes(e[0])});
    if(ods.length>0){
      h+='<div class="sec"><h3>ODs ('+ods.length+')</h3>';
    for(const[pn,ac]of ods.sort((a,b)=>(parseInt(om[a[0]])||9999)-(parseInt(om[b[0]])||9999))){let b=[];ac.has('reads')&&b.push('<span class="badge input">input</span>');ac.has('writes')&&b.push('<span class="badge output">output</span>');
      let cnt=0;const sl=_s[pn]||[];const rex=new RegExp('(^|[^A-Z0-9_])('+nm+')(?![A-Z0-9_])','g');for(var si=0;si<sl.length;si++){const m=sl[si].match(rex);if(m)cnt+=m.length;}
      h+='<div class="proc-row"><span class="order-num">'+(om[pn]||'')+'</span><a href="#" data-n="'+esc(pn)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(pn)+'</a> '+b.join(' ')+'<span class="count" style="color:#999" title="'+cnt+' references in source">x'+cnt+'</span></div>'}
    h+='</div>'}}
  const tr=[];for(const t of TABLES){const tc=TABLE_CHARS[t];if(!tc)continue;if((tc.reads||[]).includes(nm)||(tc.writes||[]).includes(nm))tr.push({name:t,reads:(tc.reads||[]).includes(nm),writes:(tc.writes||[]).includes(nm)})}
  if(tr.length>0){
    h+='<div class="sec"><h3>Tables ('+tr.length+')</h3>';
    for(const t of tr){let b=[];t.reads&&b.push('<span class="badge input">input</span>');t.writes&&b.push('<span class="badge output">output</span>');h+='<div class="proc-row"><a href="#" data-n="'+esc(t.name)+'" data-clk="1" style="color:#9c27b0;text-decoration:none">'+esc(t.name)+'</a> '+b.join(' ')+'</div>'}
    h+='</div>'}
  dp.innerHTML=h;}
function showTable(nm){
  const tc=TABLE_CHARS[nm]||{reads:[],writes:[]},ods=TABLE_ODS[nm]||[];
  let h='<h2>'+esc(nm)+' <span class="badge tbl">TABLE</span></h2><p style="color:#999;margin:4px 0">'+ods.length+' OD(s)</p>';
  if(TE[nm]&&TE[nm]._truncated)h+='<div style="background:#fff3cd;color:#856404;padding:6px;margin:6px 0;font-size:10px;border:1px solid #ffc107;border-radius:3px">\u26a0 Only 50 of '+TE[nm]._totalRows+' entries shown. Full data in JSON cache.</div>';
  if(tc.reads.length>0)h+='<div class="sec"><h3>Input</h3>'+tc.reads.map(c=>'<div class="proc-row"><a href="#" data-n="'+esc(c)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(c)+'</a> <span class="badge input">input</span></div>').join('')+'</div>';
  if(tc.writes.length>0)h+='<div class="sec"><h3>Output</h3>'+tc.writes.map(c=>'<div class="proc-row"><a href="#" data-n="'+esc(c)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(c)+'</a> <span class="badge output">output</span></div>').join('')+'</div>';
  if(ods.length>0)h+='<div class="sec"><h3>Used by</h3>'+ods.map(o=>'<div class="proc-row"><span class="order-num">'+(o.order||'')+'</span><a href="#" data-n="'+esc(o.proc)+'" data-clk="1" style="color:#1a73e8;text-decoration:none">'+esc(o.proc)+'</a></div>').join('')+'</div>';
    // Table entries - pivot by VTLINENO, color-code columns
  const te=TE[nm];
  if(te&&te.rows&&te.rows.length>0){
    const grp={},al=new Set(),cd={};
    for(const r of te.rows){const ln=r.VTLINENO||'';if(!grp[ln])grp[ln]={};grp[ln][r.VTCHARACT]={v:r.VTVALUE||'',d:r.VTVALDESCR||''};al.add(r.VTCHARACT);if(r.VTCHARDSCR)cd[r.VTCHARACT]=r.VTCHARDSCR}
    const sc=[...al].sort();
    h+='<div class="sec"><h3>Entries ('+Object.keys(grp).length+' lines)</h3><div style="overflow-x:auto;font-family:Consolas,\\'SF Mono\\',monospace;font-size:10px"><table style="border-collapse:collapse"><thead><tr><th style="border:1px solid #ddd;padding:2px 6px;background:#1a1a2e;color:#fff;white-space:nowrap">Line</th>';
    for(const ch of sc){const i=tc.reads.includes(ch),o=tc.writes.includes(ch);const bg=o?'#f8d7da':i?'#fff3cd':'#f5f5f5';const cl=o?'#721c24':i?'#856404':'#333';h+='<th style="border:1px solid #ddd;padding:2px 6px;background:'+bg+';color:'+cl+';white-space:nowrap;font-weight:600" title="'+esc(cd[ch]||ch)+'">'+esc(ch)+'</th>'}
    h+='</tr></thead><tbody>';
    for(const ln of Object.keys(grp).sort()){h+='<tr><td style="border:1px solid #ddd;padding:2px 6px;font-weight:600;color:#666;white-space:nowrap">'+esc(ln)+'</td>';for(const ch of sc){const v=grp[ln][ch];h+='<td style="border:1px solid #ddd;padding:2px 6px;white-space:nowrap">'+esc(v?v.v:'')+'</td>'}h+='</tr>'}
    h+='</tbody></table></div></div>';
  }else if(te){
    h+='<div class="sec"><h3>Entries</h3><p style="color:#999">No rows</p></div>';
  }
  sp.innerHTML=h;
  dp.innerHTML=h2(nm)+'<span class="badge tbl">TABLE</span>';}
function clkd(el){var nm=el.dataset.n;if(!nm)return false;if(TABLES.includes(nm)){showTable(nm)}else{var d=DEPS.find(function(x){return x.name===nm});if(!d){for(var x of DEPS){var c=(x.constraints||[]).find(function(y){return y.name===nm});if(c){d=c;break}}}if(!d)showChar(nm);else showOD(nm)}return false}

// Event delegation — replaces all inline onclick
function initEvents(){
  document.querySelectorAll('[data-tab]').forEach(function(el){
    el.addEventListener('click',function(){switchTab(el.getAttribute('data-tab'))});
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-dn]');
    if(!el)return;
    var dn=el.getAttribute('data-dn');
    var prev=tp.querySelector('.tree-item.selected');
    if(prev&&prev!==el)prev.classList.remove('selected');
    el.classList.add('selected');
    if(dn==='__profile__'){switchTab('env');return}
    if(dn.startsWith('C:')){showChar(dn.slice(2));return}
    if(dn.startsWith('T:')){showTable(dn.slice(2));return}
    showOD(dn);
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-expand]');
    if(!el)return;
    e.stopPropagation();
    var c=el.parentElement.nextElementSibling;
    if(c&&c.classList.contains('children')){
      c.classList.toggle('open');
      el.innerHTML=c.classList.contains('open')?'&#9660;':'&#9654;';
    }
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-toggle]');
    if(!el)return;
    var btn=e.target.closest('.expand-btn');
    if(!btn)return;
    e.stopPropagation();
    var c=el.nextElementSibling;
    if(c&&c.classList.contains('children'))c.classList.toggle('open');
    var arrow=el.querySelector('.expand-btn');
    if(arrow)c&&c.classList.contains('open')?arrow.innerHTML='&#9660;':arrow.innerHTML='&#9654;';
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-class]');
    if(!el)return;
    var prev=tp.querySelector('.tree-item.selected');
    if(prev&&prev!==el)prev.classList.remove('selected');
    el.classList.add('selected');
    showClass(el.getAttribute('data-class'));
  });
  dp.addEventListener('click',function(e){
    var el=e.target.closest('[data-clk]');
    if(el){e.preventDefault();clkd(el);}
  });
  dp.addEventListener('click',function(e){
    var el=e.target.closest('[data-class]');
    if(!el)return;
    showClass(el.getAttribute('data-class'));
  });
  sp.addEventListener('click',function(e){
    var el=e.target.closest('[data-clk]');
    if(el){e.preventDefault();clkd(el);}
  });
  sp.addEventListener('click',function(e){
    var el=e.target.closest('[data-dep]');
    if(!el)return;
    showDepSource(el.getAttribute('data-dep'));
  });
  sp.addEventListener('click',function(e){
    var el=e.target.closest('[data-dn]');
    if(!el)return;
    var dn=el.getAttribute('data-dn');
    if(dn.startsWith('C:')){showChar(dn.slice(2));return}
    if(dn.startsWith('T:')){showTable(dn.slice(2));return}
    showOD(dn);
  });
  sp.addEventListener('click',function(e){
    var el=e.target.closest('[data-toggle]');
    if(!el)return;
    var btn=e.target.closest('.expand-btn');
    if(!btn)return;
    e.stopPropagation();
    var c=el.nextElementSibling;
    if(c&&c.classList.contains('children'))c.classList.toggle('open');
    var arrow=el.querySelector('.expand-btn');
    if(arrow)c&&c.classList.contains('open')?arrow.innerHTML='&#9660;':arrow.innerHTML='&#9654;';
  });
  sp.addEventListener('click',function(e){
    var el=e.target.closest('[data-class]');
    if(!el)return;
    showClass(el.getAttribute('data-class'));
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-bomi]');
    if(!el)return;
    showBOMItem(el.getAttribute('data-bomi'),el.getAttribute('data-icat'),el.getAttribute('data-cls'));
  });
  tp.addEventListener('click',function(e){
    var el=e.target.closest('[data-bomh]');
    if(!el)return;
    showBOMDetail();
  });
  // Global search — index ODs / chars / tables / classes
  var SEARCH_IDX=[];
  function buildSearchIndex(){
    SEARCH_IDX=[];
    for(var i=0;i<PL.length;i++){var d=PL[i];SEARCH_IDX.push({t:isCNET(d.type)?'CNET':'PROC',n:d.name});for(var j=0;j<(d.constraints||[]).length;j++)SEARCH_IDX.push({t:'CONSTRAINT',n:d.constraints[j].name});}
    for(var k=0;k<CHARS.length;k++)SEARCH_IDX.push({t:'CHAR',n:(CHARS[k].label||CHARS[k].id||CHARS[k])});
    for(var m=0;m<TABLES.length;m++)SEARCH_IDX.push({t:'TABLE',n:TABLES[m]});
    for(var c2=0;c2<CLASSES.length;c2++)SEARCH_IDX.push({t:'CLASS',n:CLASSES[c2].name});
  }
  function doSearch(q){
    var box=document.getElementById('search-results');
    if(!q){box.className='';box.innerHTML='';return}
    q=q.toUpperCase();
    var hits=SEARCH_IDX.filter(function(x){return x.n.toUpperCase().indexOf(q)>=0}).slice(0,50);
    if(hits.length===0){box.className='show';box.innerHTML='<div class="sr-item" style="color:#999">No matches</div>';return}
    box.className='show';
    box.innerHTML=hits.map(function(x){
      var bc=x.t==='CHAR'?'char':x.t==='TABLE'?'tbl':x.t==='CLASS'?'CNET':x.t==='CNET'?'CNET':'PROC';
      return '<div class="sr-item" data-sr="'+esc(x.n)+'" data-st="'+x.t+'"><span class="badge '+bc+'">'+x.t+'</span>'+esc(x.n)+'</div>';
    }).join('');
  }
  function gotoSearch(el){
    var n=el.getAttribute('data-sr'),t=el.getAttribute('data-st');
    if(t==='CHAR'){showChar(n);return}
    if(t==='TABLE'){showTable(n);return}
    if(t==='CLASS'){showClass(n);return}
    showOD(n);
  }
  var searchInput=document.getElementById('search-input');
  searchInput.addEventListener('input',function(){doSearch(searchInput.value)});
  searchInput.addEventListener('keydown',function(e){if(e.key==='Escape'){document.getElementById('search-results').className='';searchInput.blur();}});
  document.getElementById('search-results').addEventListener('click',function(e){
    var el=e.target.closest('[data-sr]');
    if(!el)return;
    document.getElementById('search-results').className='';
    searchInput.value='';
    gotoSearch(el);
  });
  buildSearchIndex();
}
buildTree();initEvents();switchTab('od');document.getElementById('main').style.height=(window.innerHeight-36)+'px';
</script>
</body>
</html>`;
  }

  _esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
}
module.exports = HtmlRenderer;
