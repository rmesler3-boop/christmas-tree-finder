const $=s=>document.querySelector(s);
const EDW='https://apps.fs.usda.gov/arcx/rest/services/EDW';
if('serviceWorker' in navigator){const hadCtl=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>{r.update();document.addEventListener('visibilitychange',()=>{if(!document.hidden)r.update();});});
 // a new version took over: reload automatically unless the user is mid-edit, then offer a toast
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!hadCtl)return;if(!document.querySelector('#wpedit')&&!window.__reloading){window.__reloading=1;location.reload();return;}
  const t=document.createElement('div');t.id='updtoast';t.innerHTML='🎄 Update available – <b>tap to reload</b>';t.onclick=()=>location.reload();document.body.appendChild(t);});}
// tabs
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#tab-'+b.dataset.t).classList.add('on');if(b.dataset.t==='map')map.invalidateSize();if(b.dataset.t==='saved')renderSaved();});
const msg=t=>$('#msg').innerHTML=t;
// map
const map=L.map('map',{zoomControl:true}).setView([32.957,-105.742],12);
// panes: base tiles(200) < heat(350) < no-cut(380) < roads/boundaries vectors(overlayPane 400) < markers
map.createPane('heatPane').style.zIndex=350;map.createPane('nocutPane').style.zIndex=380;['heatPane','nocutPane'].forEach(p=>map.getPane(p).style.pointerEvents='none');
const TO={referrerPolicy:'strict-origin-when-cross-origin',crossOrigin:'anonymous'}; // OSM requires a Referer; CORS mode keeps SW caching clean
const base={
 'Street map (OpenStreetMap)':L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{...TO,maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://www.openstreetmap.org/fixthemap" target=_blank>Report a map issue</a>'}),
 'Topo (USGS)':L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',{...TO,maxZoom:16,attribution:'<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target=_blank>USGS The National Map</a> (public domain)'}),
 'Satellite + topo (USGS)':L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}',{...TO,maxZoom:16,attribution:'<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target=_blank>USGS The National Map</a> (public domain)'})};
base['Topo (USGS)'].addTo(map);
// auto-fallback: if OpenStreetMap tiles fail (blocked/403/offline), switch to USGS Topo (public domain). Esri removed: keyless public use isn't authorized.
{let errs=0;base['Street map (OpenStreetMap)'].on('tileerror',()=>{if(++errs===4&&map.hasLayer(base['Street map (OpenStreetMap)'])){map.removeLayer(base['Street map (OpenStreetMap)']);base['Topo (USGS)'].addTo(map);msg('OpenStreetMap tiles were unavailable – switched to USGS Topo.');}});
 base['Street map (OpenStreetMap)'].on('add',()=>errs=0);}
const over={};
const lc=L.control.layers(base,over,{collapsed:innerWidth<900}).addTo(map);
async function gj(url,style,name,on=true,popup){const d=await (await fetch(url)).json();const l=L.geoJSON(d,{style,onEachFeature:popup?(f,ly)=>ly.bindPopup(popup(f.properties)):null});lc.addOverlay(l,name);if(on)l.addTo(map);return l;}
gj('data/forests.geojson',{color:'#0a6b2a',weight:2,fill:false},'National forest boundaries (USFS)');
gj('data/districts.geojson',{color:'#555',weight:1,dashArray:'4 4',fill:false},'Ranger districts (USFS)',false,p=>p.districtname);
gj('data/wilderness.geojson',{color:'#444',weight:1.5,dashArray:'6 3',fillColor:'#777',fillOpacity:.35},'Wilderness – NO cutting (USFS, gray)',true,p=>`<b>${p.wildernessname}</b><br>Wilderness: no Christmas tree cutting`);
const roadStyle=f=>({color:/open/.test((f.properties.passengervehicle||'')+(f.properties.highclearancevehicle||''))?'#1d1d1d':'#8a8a8a',weight:2});
const roadPop=p=>`<b>FR ${p.id||''}</b> ${p.name||''}<br>Passenger: ${p.passengervehicle||'?'} · High-clearance: ${p.highclearancevehicle||'?'}<br>${p.seasonal||''}<br><i>From MVUM; check current closures/snow.</i>`;
gj('data/mvum_sacramento.geojson',roadStyle,'MVUM roads – Sacramento RD',true,roadPop);
// forest selector
const fs=$('#forest');for(const [k,f] of Object.entries(FORESTS)){fs.add(new Option(f.name,k));}
fs.onchange=()=>{const f=FORESTS[fs.value];map.setView(f.center,f.zoom);renderRules();};
// ===== heat map (statewide, per ranger district): each district = 30 m grayscale score + land mask, coloured in-browser,
// drawn as smooth tiles; setbacks clipped per tile from VECTOR buffers using that district's forest rules (setbacks.js).
// Districts load on demand when in view (zoom >= 9); levels are quintiles WITHIN each district.
const LEVELS=[{n:'Low',c:[44,123,182],a:70},{n:'Fair',c:[0,166,150],a:140},{n:'Good',c:[166,217,106],a:175},{n:'Very good',c:[253,174,97],a:200},{n:'Best',c:[197,27,125],a:225}];
const levelOf=(q,mins)=>{let L=null;LEVELS.forEach((l,i)=>{if(q>=mins[i])L=l;});return L;};
let INDEX=[],AREAS={},heatLayer=null,noCutLayer=null;const MINZ=9;
async function imgData(url){const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0);return x.getImageData(0,0,c.width,c.height);}
function bboxOf(g){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const w=c=>{if(typeof c[0]==='number'){x0=Math.min(x0,c[0]);x1=Math.max(x1,c[0]);y0=Math.min(y0,c[1]);y1=Math.max(y1,c[1]);}else c.forEach(w);};w(g.coordinates);return [x0,y0,x1,y1];}
function getSetbacks(fk){const saved=JSON.parse(localStorage.getItem('tf-setbacks-'+fk)||'{}');const o={};for(const [k,v] of Object.entries(SETBACKS[fk]))o[k]=saved[k]!=null?saved[k]:v.ft;return o;}
const aBounds=e=>L.latLngBounds([[e.bbox[1],e.bbox[0]],[e.bbox[3],e.bbox[2]]]);
async function loadArea(e){if(AREAS[e.id])return AREAS[e.id];const D=`data/heat/${e.id}/`;const A={e,D,heat:{},grids:{}};AREAS[e.id]=A;
 A.p=(async()=>{A.meta=await (await fetch(D+'meta.json')).json();const d=await imgData(D+'land.png');for(let i=0;i<d.data.length;i+=4){d.data[i+3]=d.data[i];d.data[i]=d.data[i+1]=d.data[i+2]=0;}
  const c=document.createElement('canvas');c.width=d.width;c.height=d.height;c.getContext('2d').putImageData(d,0,0);A.land={c,raw:d};
  A.vec=await (await fetch(D+'vec.json')).json();for(const k in A.vec)A.vec[k].forEach(f=>f.bb=bboxOf(f.geometry));A.ready=true;return A;})();
 return A;}
async function areaHeat(A,sp){if(A.heat[sp])return A.heat[sp];const d=await imgData(`${A.D}s_${sp}.png`),W0=d.width,H0=d.height,g=new Uint8Array(W0*H0);for(let i=0;i<g.length;i++)g[i]=d.data[i*4];
 const h=new Uint32Array(256),ld=A.land.raw.data;let n=0;for(let i=0;i<g.length;i++)if(g[i]>=31&&ld[i*4+3]){h[g[i]]++;n++;}
 const mins=[31/255];let acc=0,t=1;for(let v=31;v<256&&t<5;v++){acc+=h[v];while(t<5&&acc>=n*t/5){mins.push((v+1)/255);t++;}}while(mins.length<5)mins.push(1.01);
 const levels=[];for(const k of [1,2,4,8]){const w=Math.ceil(W0/k),hh=Math.ceil(H0/k),c=document.createElement('canvas');c.width=w;c.height=hh;const x=c.getContext('2d'),o=x.createImageData(w,hh);
  for(let y=0;y<hh;y++)for(let X=0;X<w;X++){let v=0;for(let jj=0;jj<k;jj++){const yy=y*k+jj;if(yy>=H0)break;for(let ii=0;ii<k;ii++){const xx=X*k+ii;if(xx<W0){const tt=g[yy*W0+xx];if(tt>v)v=tt;}}}
   const p=(y*w+X)*4,lv=levelOf(v/255,mins);if(!lv)continue;o.data[p]=lv.c[0];o.data[p+1]=lv.c[1];o.data[p+2]=lv.c[2];o.data[p+3]=lv.a;}
  x.putImageData(o,0,0);levels.push({k,c});}
 return A.heat[sp]={levels,mins,n};}
async function loadGrid(A,n){if(A.grids[n])return A.grids[n];const d=await imgData(`${A.D}g_${n}.png`),o=new Uint8Array(d.width*d.height);for(let i=0;i<o.length;i++)o[i]=d.data[i*4];return A.grids[n]=o;}
function drawAllowed(A,ctx,coords,size){const m=A.meta,[W,S,E,N]=m.bbox,z=coords.z,org=L.point(coords.x*size.x,coords.y*size.y);
 const P=(lat,lng)=>map.project([lat,lng],z).subtract(org);const a=P(N,W),b=P(S,E);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const cp=(b.x-a.x)/m.w;if(cp>3)ctx.filter=`blur(${(cp*.3).toFixed(1)}px)`;ctx.drawImage(A.land.c,a.x,a.y,b.x-a.x,b.y-a.y);ctx.filter='none';
 const nw=map.unproject(org,z),se=map.unproject(org.add(size),z);const sb=getSetbacks(A.e.forest);
 const mpp=40075016.686*Math.cos(nw.lat*Math.PI/180)/Math.pow(2,z+8);ctx.globalCompositeOperation='destination-out';ctx.strokeStyle=ctx.fillStyle='#000';ctx.lineCap=ctx.lineJoin='round';
 for(const k in sb){const r=sb[k]*0.3048/mpp;if(r<0.75||!A.vec[k])continue;const pad=sb[k]*0.3048/90000;ctx.lineWidth=Math.max(1,2*r);
  for(const f of A.vec[k]){const [x0,y0,x1,y1]=f.bb;if(x1<nw.lng-pad||x0>se.lng+pad||y1<se.lat-pad||y0>nw.lat+pad)continue;const g=f.geometry,t=g.type;
   if(t==='Point'){const p=P(g.coordinates[1],g.coordinates[0]);ctx.beginPath();ctx.arc(p.x,p.y,Math.max(r,2),0,7);ctx.fill();continue;}
   const lines=t==='LineString'?[g.coordinates]:t==='MultiLineString'||t==='Polygon'?g.coordinates:g.coordinates.flat();
   ctx.beginPath();for(const ln of lines){ln.forEach((c,i)=>{const p=P(c[1],c[0]);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});}ctx.stroke();if(t.endsWith('Polygon'))ctx.fill();}}
 ctx.globalCompositeOperation='source-over';}
const tileBox=(coords,size)=>{const org=L.point(coords.x*size.x,coords.y*size.y);return L.latLngBounds(map.unproject(org.add([0,size.y]),coords.z),map.unproject(org.add([size.x,0]),coords.z));};
const readyAreasIn=bb=>Object.values(AREAS).filter(A=>A.ready&&aBounds(A.e).intersects(bb));
const HeatGrid=L.GridLayer.extend({createTile(coords,done){const t=document.createElement('canvas'),s=this.getTileSize();t.width=s.x;t.height=s.y;const sp=this.options.sp;
 (async()=>{if(coords.z<MINZ)return;const tb=tileBox(coords,s);const ctx=t.getContext('2d');for(const A of readyAreasIn(tb)){const H=await areaHeat(A,sp);const tmp=document.createElement('canvas');tmp.width=s.x;tmp.height=s.y;const tc=tmp.getContext('2d');
  drawAllowed(A,tc,coords,s);const m=A.meta,[W,S,E,N]=m.bbox,org=L.point(coords.x*s.x,coords.y*s.y),a=map.project([N,W],coords.z).subtract(org),b=map.project([S,E],coords.z).subtract(org);
  const cellPx=(b.x-a.x)/m.w,lv=H.levels,L0=cellPx>=1?lv[0]:cellPx>=.5?lv[1]:cellPx>=.25?lv[2]:lv[3];tc.globalCompositeOperation='source-in';tc.imageSmoothingEnabled=true;tc.imageSmoothingQuality='high';
  if(cellPx>3)tc.filter=`blur(${(cellPx*.4).toFixed(1)}px)`;tc.drawImage(L0.c,a.x,a.y,b.x-a.x,b.y-a.y);tc.filter='none';ctx.drawImage(tmp,0,0);}})().then(()=>done(null,t),err=>done(err,t));return t;}});
const NoCutGrid=L.GridLayer.extend({createTile(coords){const t=document.createElement('canvas'),s=this.getTileSize();t.width=s.x;t.height=s.y;if(coords.z<MINZ)return t;const ctx=t.getContext('2d');
 const As=readyAreasIn(tileBox(coords,s)),org=L.point(coords.x*s.x,coords.y*s.y);ctx.fillStyle='rgb(85,85,85)';
 for(const A of As){const [W,S,E,N]=A.meta.bbox,a=map.project([N,W],coords.z).subtract(org),b=map.project([S,E],coords.z).subtract(org);ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);} // gray over all loaded district boxes…
 for(const A of As){const mk=document.createElement('canvas');mk.width=s.x;mk.height=s.y;drawAllowed(A,mk.getContext('2d'),coords,s);ctx.globalCompositeOperation='destination-out';ctx.drawImage(mk,0,0);ctx.globalCompositeOperation='source-over';} // …minus every district's allowed land
 return t;}});
let coverLayer=null;
async function initHeat(){INDEX=await (await fetch('data/heat/index.json')).json();
 coverLayer=L.layerGroup(INDEX.map(e=>L.rectangle(aBounds(e),{color:'#6a1b9a',weight:1,dashArray:'3 4',fill:false,interactive:false}))).addTo(map);lc.addOverlay(coverLayer,'Heat-map coverage (district boxes)');
 noCutLayer=new NoCutGrid({pane:'nocutPane',opacity:+(localStorage.getItem('tf-nocut-op')||.25)});lc.addOverlay(noCutLayer,'No cutting (light gray)');noCutLayer.addTo(map);
 map.on('moveend',syncAreas);await syncAreas();}
async function syncAreas(){if(map.getZoom()<MINZ){checkCover();return;}const vb=map.getBounds().pad(.1);const need=INDEX.filter(e=>aBounds(e).intersects(vb));
 const fresh=need.filter(e=>!AREAS[e.id]);if(!fresh.length){checkCover();return;}msg(`Loading heat map: ${fresh.map(e=>e.name.replace(' Ranger District',' RD')).join(', ')}…`);
 await Promise.all(fresh.map(e=>loadArea(e).then(A=>A.p)));
 // keep memory bounded on phones: drop districts far from view
 const ids=Object.keys(AREAS);if(ids.length>6)for(const id of ids)if(!need.find(e=>e.id===id)&&id!=='sacramento')delete AREAS[id];
 noCutLayer.redraw();if(heatLayer)heatLayer.redraw();showLegend();checkCover();}
const heatReady=initHeat();
function showLegend(){const sp=$('#species').value;if(!sp)return msg('Heat map off. Pick a tree type above.');const lab={fir:'White fir / Douglas-fir (mixed conifer)',spruce:'Spruce / subalpine & corkbark fir',ponderosa:'Ponderosa pine',pinyon:'Pinyon pine (and juniper)'}[sp];
 msg(`<b>${lab}</b> likelihood <span class="est">ESTIMATE</span> <div class="lvls">${LEVELS.map(l=>`<span><i style="background:rgba(${l.c},${(l.a/255).toFixed(2)})"></i>${l.n}</span>`).join('')}</div><span class="small">Levels are <b>relative within each ranger district</b> (fifths of its scored, cuttable land), so “Best” = best in that district – compare districts by habitat, not colour · light gray = no cutting · tap map for details</span>`);}
async function setHeat(){await heatReady;const sp=$('#species').value;if(heatLayer){map.removeLayer(heatLayer);heatLayer=null;}if(!sp){showLegend();return;}
 heatLayer=new HeatGrid({sp,pane:'heatPane',opacity:.85}).addTo(map);showLegend();}
window.refreshMask=async()=>{await heatReady;noCutLayer.redraw();if(heatLayer)heatLayer.redraw();};
$('#species').onchange=setHeat;
function pickSp(sp){$('#species').value=sp;document.querySelectorAll('#spbar button').forEach(b=>b.classList.toggle('on',b.dataset.sp===sp));setHeat().then(checkCover);}
document.querySelectorAll('#spbar button').forEach(b=>b.onclick=()=>pickSp(b.dataset.sp));
const areaAt=(lat,lng)=>Object.values(AREAS).filter(A=>A.ready).find(A=>{const [W,S,E,N]=A.meta.bbox;if(lng<W||lng>E||lat<S||lat>N)return false;const d=A.land.raw,x=Math.floor((lng-W)/(E-W)*d.width),y=Math.floor((N-lat)/(N-S)*d.height);return d.data[(y*d.width+x)*4+3]>0;})
 ||Object.values(AREAS).filter(A=>A.ready).find(A=>aBounds(A.e).contains([lat,lng]));
// ----- district bar (inside the bottom panel, never over the map) + offline district downloads
const DC='tf-v-districts',savedD=()=>JSON.parse(localStorage.getItem('tf-saved-districts')||'{}'),setSavedD=o=>localStorage.setItem('tf-saved-districts',JSON.stringify(o));
const DL={};let coverKey='',coverTimer=null;const mb=b=>(b/1e6).toFixed(1)+' MB';
function coverSet(key,html,collapse=true){const el=$('#cover');el.hidden=!html;if(key===coverKey&&!DL.busy)return;coverKey=key;el.innerHTML=html;el.classList.remove('mini');clearTimeout(coverTimer);
 if(collapse)coverTimer=setTimeout(()=>el.classList.add('mini'),5000);}
$('#cover').onclick=e=>{if(e.target.tagName!=='BUTTON')$('#cover').classList.toggle('mini');};
function distHtml(e){const s=savedD()[e.id],d=DL[e.id],nm=e.name.replace(' Ranger District',' RD');
 if(d&&d.state==='busy')return `<span class="t">⬇ ${nm}: ${d.n} of ${d.N} files, ${mb(d.b)} / ${mb(e.bytes)}</span><span class="pb"><i style="width:${Math.round(100*d.n/d.N)}%"></i></span>`;
 if(d&&d.state==='err')return `<span class="t err">⚠ ${nm}: download failed (${d.msg}).</span><button onclick="dlArea('${e.id}')">Retry</button>`;
 if(s)return `<span class="t">📍 ${nm} <span class="ok">· Saved for offline ✓</span></span>`;
 return `<span class="t">📍 ${nm}<span class="x"> (${e.forestname.replace(' National Forest',' NF')})</span></span><button onclick="dlArea('${e.id}')">⬇ Offline (${mb(e.bytes)})</button>`;}
function checkCover(){const sp=$('#species').value;if(!INDEX.length)return;const c=map.getCenter();
 if(map.getZoom()<MINZ)return coverSet('zoom',`<span class="t">Heat maps: ${INDEX.length} NM ranger districts (purple boxes). <b>Zoom in</b> to load one.</span>`);
 if(!INDEX.some(e=>aBounds(e).intersects(map.getBounds())))return coverSet('none','<span class="t">No heat map here (outside NM national-forest districts).</span>');
 const A=areaAt(c.lat,c.lng),e=A?A.e:INDEX.find(e=>aBounds(e).contains(c));if(!e)return coverSet('','');
 coverSet('d:'+e.id+':'+(savedD()[e.id]?1:0),distHtml(e),!DL[e.id]);}
function redrawCover(id){const e=INDEX.find(x=>x.id===id);coverKey='';const el=$('#cover');el.hidden=false;el.classList.remove('mini');el.innerHTML=distHtml(e);renderSavedD();}
window.dlArea=async id=>{const e=INDEX.find(x=>x.id===id);if(!e||(DL[id]&&DL[id].state==='busy'))return;DL.busy=1;
 const D=new URL(`data/heat/${id}/`,location.href).href,files=['index.json',...e.files.map(f=>id+'/'+f)].map(f=>new URL('data/heat/'+f,location.href).href);
 const d=DL[id]={state:'busy',n:0,N:files.length,b:0};redrawCover(id);
 try{if(!('caches' in window))throw new Error('this browser has no offline storage (needs HTTPS)');const cache=await caches.open(DC);
  for(const u of files){let r;try{r=await fetch(u,{cache:'no-cache'});}catch(x){throw new Error('network error – check signal');}
   if(!r.ok)throw new Error(`HTTP ${r.status} for ${u.split('/').slice(-2).join('/')}`);const blob=await r.blob();
   await cache.put(u,new Response(blob,{headers:{'Content-Type':r.headers.get('Content-Type')||''}}));d.n++;d.b+=blob.size;redrawCover(id);}
  const o=savedD();o[id]={bytes:d.b,date:new Date().toISOString().slice(0,10),name:e.name};setSavedD(o);delete DL[id];
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();msg(`Saved ${e.name} for offline ✓ (${mb(d.b)}). Use “Save area” too, to keep base-map tiles.`);}
 catch(err){d.state='err';d.msg=err.message||String(err);msg('Offline download failed: '+d.msg);}
 DL.busy=0;redrawCover(id);};
window.delArea=async id=>{const cache=await caches.open(DC);for(const k of await cache.keys())if(k.url.includes(`/data/heat/${id}/`))await cache.delete(k);const o=savedD();delete o[id];setSavedD(o);renderSavedD();coverKey='';checkCover();};
function renderSavedD(){const el=$('#savedd');if(!el)return;const o=savedD(),ks=Object.keys(o);
 el.innerHTML=ks.length?ks.map(k=>`<div class="card">🗺 <b>${o[k].name}</b> · ${mb(o[k].bytes)} · saved ${o[k].date} <button onclick="document.querySelector('nav button[data-t=map]').click();map.setView(aBounds(INDEX.find(e=>e.id==='${k}')).getCenter(),11)">Show</button> <button onclick="delArea('${k}')">🗑 Delete</button></div>`).join('')+`<p class="small">Total ${mb(ks.reduce((s,k)=>s+o[k].bytes,0))}.</p>`
  :'<p class="small">None yet. Zoom into a district on the map and tap “⬇ Offline”.</p>';}
renderSavedD();
// reconcile saved list with what is really in the cache (e.g. browser cleared storage)
caches&&caches.open(DC).then(c=>c.keys()).then(ks=>{const o=savedD();let ch=0;for(const id in o)if(!ks.some(k=>k.url.includes(`/data/heat/${id}/meta.json`))){delete o[id];ch=1;}if(ch){setSavedD(o);renderSavedD();}}).catch(()=>{});
map.on('click',async e=>{const sp=$('#species').value;let html=navTop(e.latlng.lat,e.latlng.lng,'Spot')+`${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;const A=areaAt(e.latlng.lat,e.latlng.lng);
 if(A)html+=`<br><span class=small>${A.e.name}, ${A.e.forestname}</span>`;
 if(sp&&A){const m=A.meta,[W,S,E,N]=m.bbox,gw=Math.ceil(m.w/2),gh=Math.ceil(m.h/2),i=Math.min(gh-1,Math.floor((N-e.latlng.lat)/(N-S)*gh))*gw+Math.min(gw-1,Math.floor((e.latlng.lng-W)/(E-W)*gw));
  const g={};for(const n of [`score_${sp}`,`hab_${sp}`,'f_height','f_cover','f_disturb','f_slope','f_twi','f_road','elev50ft'])g[n]=(await loadGrid(A,n))[i];const H=await areaHeat(A,sp);
  const p=v=>Math.round(v/2.55)+'%';const lv=levelOf(g['score_'+sp]/255,H.mins);
  html+=`<br><b>Level: ${lv?lv.n:'Very low'}</b> <span class=small>(relative to this district)</span><br>Relative likelihood score: ${p(g['score_'+sp])} <span class="est">estimate</span><table>
  <tr><td>Habitat match (LANDFIRE EVT)</td><td>${p(g['hab_'+sp])}</td></tr><tr><td>Small-tree canopy height (EVH)</td><td>${p(g.f_height)}</td></tr>
  <tr><td>Open/moderate cover (EVC)</td><td>${p(g.f_cover)}</td></tr><tr><td>Regrowth 9–26 yr after fire/thinning</td><td>${g.f_disturb>200?'yes':'no'}</td></tr>
  <tr><td>Gentle slope</td><td>${p(g.f_slope)}</td></tr><tr><td>Moisture (TWI)</td><td>${p(g.f_twi)}</td></tr><tr><td>Road access</td><td>${p(g.f_road)}</td></tr>
  <tr><td>Elevation (LANDFIRE)</td><td>~${g.elev50ft*50} ft</td></tr>${A.meta.small_tree?await (async()=>{const fs=(await loadGrid(A,'f_small'))[i],src=(await loadGrid(A,'src_small'))[i];return src?`<tr><td>Christmas-size trees nearby (${src>=200?'lidar 2018-19':'Meta 1 m CHM'}) <span class=est>est.</span></td><td>${p(fs)}</td></tr>`:'';})():''}</table>`;}
 {const r=reasonAt(e.latlng.lat,e.latlng.lng);if(r!==null){html+=r?`<div style="background:#ddd;padding:4px;margin-top:4px"><b>⛔ No cutting:</b> ${r}</div>`:`<div class=small>✔ Not in a mapped no-cut area (still check your permit map)</div>`;}}
 {const tf=tuneAt(e.latlng.lat,e.latlng.lng);if(tf!==1)html+=`<div class=small>Your field notes nearby: local tuning ${tf>1?'boost':'penalty'} ×${tf.toFixed(2)} <span class=est>local tuning</span></div>`;}
 html+=`<br><button onclick="newWp(${e.latlng.lat},${e.latlng.lng})">+ Waypoint here</button> <button onclick="saveSpot(${e.latlng.lat},${e.latlng.lng},true)">🌲 Found good tree here</button>`;
 html+=navHtml(e.latlng.lat,e.latlng.lng,'Spot');
 L.popup().setLatLng(e.latlng).setContent(html).openOn(map);});
function distToFeat(lat,lng,f){const g=f.geometry,kx=111320*Math.cos(lat*Math.PI/180),ky=110540;const X=c=>(c[0]-lng)*kx,Y=c=>(c[1]-lat)*ky;let best=1e12;
 const seg=(p,q)=>{const ax=X(p),ay=Y(p),bx=X(q),by=Y(q),dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?-(ax*dx+ay*dy)/l:0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy;best=Math.min(best,x*x+y*y);};
 if(g.type==='Point')return Math.hypot(X(g.coordinates),Y(g.coordinates));
 const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'||g.type==='Polygon'?g.coordinates:g.coordinates.flat();for(const ln of lines)for(let i=1;i<ln.length;i++)seg(ln[i-1],ln[i]);return Math.sqrt(best);}
function reasonAt(lat,lng,A0){const A=A0||areaAt(lat,lng);if(!A)return null;const m=A.meta,[W,S,E,N]=m.bbox;const d=A.land.raw,x=Math.floor((lng-W)/(E-W)*d.width),y=Math.floor((N-lat)/(N-S)*d.height);
 if(x<0||y<0||x>=d.width||y>=d.height||!d.data[(y*d.width+x)*4+3])return 'Not USFS land open to cutting (private/state/other, wilderness, developed, or outside the district)';const sb=getSetbacks(A.e.forest);
 for(const k in sb){const r=sb[k]*0.3048;if(r<=0)continue;const pad=r/90000+.0002;for(const f of A.vec[k]||[]){const [x0,y0,x1,y1]=f.bb;if(lng<x0-pad||lng>x1+pad||lat<y0-pad||lat>y1+pad)continue;const dd=distToFeat(lat,lng,f);if(dd<r)return `Within ${sb[k]} ft of ${SETBACK_LABELS[k].toLowerCase()} (~${Math.round(dd*3.28)} ft away)`;}}
 return '';}
const treeIcon=(fill,label='')=>L.divIcon({className:'treemk',iconSize:[30,38],iconAnchor:[15,36],popupAnchor:[0,-32],
 html:`<svg viewBox="0 0 30 38" width="30" height="38"><polygon points="15,2 3,16 9,16 1,28 29,28 21,16 27,16" fill="${fill}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><rect x="12" y="28" width="6" height="7" fill="#6b4226" stroke="#fff" stroke-width="1.5"/>${label?`<text x="15" y="23" text-anchor="middle" font-size="10" font-weight="bold" fill="#fff" font-family="sans-serif">${label}</text>`:''}</svg>`});
// GPS
let me=null;$('#gps').onclick=()=>{msg('Locating…');navigator.geolocation.getCurrentPosition(p=>{const ll=[p.coords.latitude,p.coords.longitude];
 if(me)map.removeLayer(me);me=L.circleMarker(ll,{radius:8,color:'#06f',fillOpacity:.8}).addTo(map).bindPopup(`You (±${Math.round(p.coords.accuracy)} m)`);map.setView(ll,14);msg('Location found. Blue dot = you.');},
 err=>msg('Location unavailable: '+err.message),{enableHighAccuracy:true,timeout:15000});};
// best nearby (statewide): top cells within 8 km across all loaded districts, spread out
let topLayer=L.layerGroup().addTo(map);
$('#top').onclick=async()=>{const sp=$('#species').value||'fir';if(!$('#species').value)pickSp(sp);await heatReady;const c=me?me.getLatLng():map.getCenter();
 if(map.getZoom()<MINZ)map.setView(c,11);await syncAreas();const cand=[];
 for(const A of Object.values(AREAS).filter(A=>A.ready&&aBounds(A.e).pad(.2).contains(c))){const sc=await loadGrid(A,'score_'+sp),H=await areaHeat(A,sp),m=A.meta,[W,S,E,N]=m.bbox,gw=Math.ceil(m.w/2),gh=Math.ceil(m.h/2);
  for(let y=0;y<gh;y+=2)for(let x=0;x<gw;x+=2){const v=sc[y*gw+x]/255;if(v<H.mins[3])continue;const lat=N-(y+.5)/gh*(N-S),lng=W+(x+.5)/gw*(E-W);const d=map.distance(c,[lat,lng]);if(d<8000)cand.push({v:v*tuneAt(lat,lng),raw:v,lat,lng,d,A,H});}}
 cand.sort((a,b)=>b.v-a.v);const pick=[];for(const k of cand){if(reasonAt(k.lat,k.lng,k.A))continue;if(pick.every(p=>map.distance([p.lat,p.lng],[k.lat,k.lng])>700))pick.push(k);if(pick.length>=8)break;}
 topLayer.clearLayers();pick.forEach((p,i)=>L.marker([p.lat,p.lng],{icon:treeIcon('#b3122e',i+1)}).addTo(topLayer).bindPopup(navTop(p.lat,p.lng,'Suggestion '+(i+1))+`#${i+1} suggestion · <b>${(levelOf(p.raw,p.H.mins)||{n:''}).n}</b> in ${p.A.e.name} <span class="est">estimate</span><br>${(p.d/1000).toFixed(1)} km from ${me?'you':'map centre'}${p.v!==p.raw?' · <span class=est>tuned by your notes</span>':''}<br><button onclick="newWp(${p.lat},${p.lng})">+ Save as waypoint</button>${navHtml(p.lat,p.lng,'Suggestion '+(i+1))}`,{maxWidth:290}));
 msg(pick.length?`${pick.length} suggested top-scoring spots (numbered red trees; Very good/Best level) within 8 km. Verify land status & rules on the ground.`:'No Very good/Best cuttable spots within 8 km of here. Try another tree type or move the map.');};
// roads in view (live from USFS MVUM)
$('#roads').onclick=async()=>{if(map.getZoom()<11)return msg('Zoom in closer (zoom ≥ 11) to load roads.');const b=map.getBounds();msg('Loading MVUM roads…');
 try{const u=`${EDW}/EDW_MVUM_02/MapServer/1/query?where=1%3D1&geometry=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=id,name,passengervehicle,highclearancevehicle,seasonal&maxAllowableOffset=0.0002&f=geojson`;
 const d=await (await fetch(u)).json();L.geoJSON(d,{style:roadStyle,onEachFeature:(f,l)=>l.bindPopup(roadPop(f.properties))}).addTo(map);msg(`Loaded ${d.features.length} MVUM roads (black = open to vehicles). Saved for offline once viewed.`);}catch(e){msg('Could not load roads (offline?)');}};
// offline area: prefetch tiles of the active basemap for current view, zoom z..z+3
$('#offline').onclick=async()=>{const b=map.getBounds(),z0=map.getZoom();let urls=[];let layer=Object.values(base).find(l=>map.hasLayer(l));
 // OSM tile policy forbids prefetch/offline downloads from tile.openstreetmap.org, so Save area always uses USGS (public domain) tiles
 let note='';if(!layer||/openstreetmap/.test(layer._url)){layer=base['Topo (USGS)'];note=' (USGS Topo – OpenStreetMap tiles can’t be saved for offline under the OSM tile policy)';}
 for(let z=z0;z<=Math.min(z0+3,16);z++){const p1=map.project(b.getNorthWest(),z).divideBy(256).floor(),p2=map.project(b.getSouthEast(),z).divideBy(256).floor();
  for(let x=p1.x;x<=p2.x;x++)for(let y=p1.y;y<=p2.y;y++)urls.push(layer._url.replace('{z}',z).replace('{x}',x).replace('{y}',y).replace('{s}','a'));}
 if(urls.length>2500)return msg(`That's ${urls.length} tiles – zoom in further first.`);let n=0;const c=await caches.open('tf-tiles');
 for(const u of urls){try{const r=await fetch(u);if(r.ok){await c.put(u,r);n++;}}catch(e){} if(n%25===0)msg(`Saving tiles ${n}/${urls.length}${note}…`);}
 msg(`Saved ${n} map tiles for offline use.`);};
// ===== waypoints (replaces old "saved spots"; old ones are migrated) =====
Object.assign(L.Popup.prototype.options,{maxHeight:Math.max(180,Math.round(innerHeight*.36)),autoPanPaddingTopLeft:L.point(8,innerWidth<800?175:70),autoPanPaddingBottomRight:L.point(8,innerWidth<800?20:8)});
const WK='tf-waypoints',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WT={tree:{n:'Tree spot',c:'#1b7a3a',e:'🌲'},parking:{n:'Parking',c:'#1565c0',e:'🅿️'},trailhead:{n:'Trailhead',c:'#6d4c41',e:'🥾'},camp:{n:'Camp',c:'#e65100',e:'⛺'},other:{n:'Other',c:'#7b1fa2',e:'📍'}};
const FOUND={yes:'✅ Trees found',some:'🟡 Some trees',no:'❌ No good trees','':'Not recorded'};
const today=()=>new Date().toISOString().slice(0,10);
const wps=()=>{let w=JSON.parse(localStorage.getItem(WK)||'null');if(!w){w=JSON.parse(localStorage.getItem('tf-spots')||'[]').map((s,k)=>({id:'m'+k+Date.now(),lat:s.lat,lng:s.lng,name:s.good?'Good tree':'Saved spot',note:s.note||'',type:'tree',found:s.good?'yes':'',visited:(s.date||'').slice(0,10),species:s.species||'',created:s.date||new Date().toISOString()}));localStorage.setItem(WK,JSON.stringify(w));}return w;};
const setWps=w=>{localStorage.setItem(WK,JSON.stringify(w));drawWps();renderSaved();if(window.tuneLayer)tuneLayer.redraw();};
const pinIcon=c=>L.divIcon({className:'treemk',iconSize:[26,36],iconAnchor:[13,35],popupAnchor:[0,-30],html:`<svg viewBox="0 0 26 36" width="26" height="36"><path d="M13 1C6 1 1 6 1 13c0 9 12 22 12 22s12-13 12-22C25 6 20 1 13 1z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg>`});
const wpIcon=w=>w.type==='tree'?treeIcon(w.found==='no'?'#8a8a8a':w.found==='some'?'#c8961e':'#1b7a3a'):pinIcon(WT[w.type].c);
const spotLayer=L.layerGroup().addTo(map);
function bearing(a,b){const r=Math.PI/180,y=Math.sin((b.lng-a.lng)*r)*Math.cos(b.lat*r),x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lng-a.lng)*r);const d=(Math.atan2(y,x)/r+360)%360;return Math.round(d)+'° '+['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];}
const fmtD=m=>m<1000?Math.round(m*3.281)+' ft':(m/1609.34).toFixed(1)+' mi';
// nearest point on a loaded MVUM (motor-vehicle-use-map) road; MVUM roads are the designated open roads (some seasonal / high-clearance)
function nearestRoad(lat,lng){let best=null;const kx=111320*Math.cos(lat*Math.PI/180),ky=110540;
 for(const A of Object.values(AREAS).filter(A=>A.ready&&aBounds(A.e).pad(.05).contains([lat,lng])))for(const f of A.vec.fsroad||[]){const [x0,y0,x1,y1]=f.bb;if(lng<x0-.06||lng>x1+.06||lat<y0-.05||lat>y1+.05)continue;
  const g=f.geometry,lines=g.type==='LineString'?[g.coordinates]:g.coordinates;for(const ln of lines)for(let i=1;i<ln.length;i++){const ax=(ln[i-1][0]-lng)*kx,ay=(ln[i-1][1]-lat)*ky,bx=(ln[i][0]-lng)*kx,by=(ln[i][1]-lat)*ky,dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;let t=l?-(ax*dx+ay*dy)/l:0;t=Math.max(0,Math.min(1,t));const x=ax+t*dx,y=ay+t*dy,d=Math.hypot(x,y);
   if(!best||d<best.d)best={d,lat:lat+y/ky,lng:lng+x/kx,id:(f.properties||{}).id||''};}}
 return best&&best.d<8000?best:null;}
const gmaps=(lat,lng)=>`https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}&travelmode=driving`;
const geoUri=(lat,lng,lab)=>`geo:${lat.toFixed(6)},${lng.toFixed(6)}?q=${lat.toFixed(6)},${lng.toFixed(6)}(${encodeURIComponent(lab||'Waypoint')})`;
function navTop(lat,lng,lab){return `<div class="navtop"><a class="dirbtn" target=_blank rel=noopener href="${gmaps(lat,lng)}">🚗 Directions</a><a class="btn" href="${geoUri(lat,lng,lab)}">🗺 Other app</a></div>`;}
window.navTop=navTop;
function navHtml(lat,lng,lab){let h=`<details><summary>Road access, distance & bearing</summary>`;
 const r=nearestRoad(lat,lng);
 if(r)h+=`<div class="small">Nearest MVUM forest road${r.id?' ('+esc(r.id)+')':''}: <b>${fmtD(r.d)}</b> walk (straight line, ${bearing(L.latLng(r.lat,r.lng),L.latLng(lat,lng))} from road). <a class="btn" target=_blank rel=noopener href="${gmaps(r.lat,r.lng)}">🚗 Directions to nearest road access</a> <button onclick="map.setView([${r.lat},${r.lng}],16)">Show</button></div>`;
 else h+=`<div class="small">Nearest forest road: zoom into this district to load its roads.</div>`;
 if(me){const m=me.getLatLng(),p=L.latLng(lat,lng);h+=`<div class="small">From your GPS: <b>${fmtD(m.distanceTo(p))}</b>, bearing <b>${bearing(m,p)}</b> (straight line, works offline)</div>`;}
 return h+`<div class="small warn">⚠ Google may route on roads that are missing, closed, seasonal or need high clearance/4WD. Check the MVUM and conditions; don’t rely on phone signal.</div></details>`;}
function wpPopup(w){const t=WT[w.type]||WT.other;return navTop(w.lat,w.lng,w.name)+`<b>${t.e} ${esc(w.name)||t.n}</b> <span class=small>· ${t.n}</span><br>${w.type==='tree'||w.found?`<b>${FOUND[w.found||'']}</b>`:''}${w.visited?` <span class=small>· visited ${esc(w.visited)}</span>`:''}
 ${w.note?`<div class="note">${esc(w.note).replace(/\n/g,'<br>')}</div>`:'<div class="small">(no notes)</div>'}<div class="small">${w.lat.toFixed(5)}, ${w.lng.toFixed(5)} · drag marker to move</div>
 <button onclick="editWp('${w.id}')">✏️ Edit / notes</button> <button onclick="delWp('${w.id}')">🗑 Delete</button>${navHtml(w.lat,w.lng,w.name)}`;}
function drawWps(){spotLayer.clearLayers();wps().forEach(w=>{const m=L.marker([w.lat,w.lng],{icon:wpIcon(w),draggable:true,title:w.name}).addTo(spotLayer);
 m.bindPopup(()=>wpPopup(w),{maxWidth:290});m.on('dragend',()=>{const ll=m.getLatLng(),a=wps(),x=a.find(z=>z.id===w.id);if(x){x.lat=ll.lat;x.lng=ll.lng;setWps(a);}msg('Waypoint moved.');});});}
// editor (modal sheet)
function editWp(id,init){map.closePopup();const a=wps();let w=a.find(z=>z.id===id)||Object.assign({id:'w'+Date.now().toString(36),name:'',note:'',type:'tree',found:'',visited:today(),species:$('#species').value||'',created:new Date().toISOString()},init);
 const d=document.createElement('div');d.id='wpedit';d.innerHTML=`<form><h3>${a.includes(w)?'Edit':'New'} waypoint</h3>
 <label>Name <input name=name maxlength=60 value="${esc(w.name)}" placeholder="e.g. Fir patch off FR 64"></label>
 <label>Type <select name=type>${Object.entries(WT).map(([k,t])=>`<option value=${k} ${k===w.type?'selected':''}>${t.e} ${t.n}</option>`).join('')}</select></label>
 <fieldset><legend>Trees found?</legend>${[['yes','Yes'],['some','Some'],['no','No'],['','Not yet']].map(([k,n])=>`<label class=rb><input type=radio name=found value="${k}" ${w.found===k?'checked':''}> ${n}</label>`).join('')}</fieldset>
 <label>Date visited <input type=date name=visited value="${esc(w.visited)}"></label>
 <label>Notes <textarea name=note rows=5 placeholder="Species, height, how many, access, road condition…">${esc(w.note)}</textarea></label>
 <div class=small>${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}</div>
 <div class=row><button type=submit>💾 Save</button><button type=button id=wpc>Cancel</button></div></form>`;
 document.body.appendChild(d);const f=d.querySelector('form');f.name.focus();d.querySelector('#wpc').onclick=()=>d.remove();
 f.onsubmit=ev=>{ev.preventDefault();Object.assign(w,{name:f.name.value.trim(),type:f.type.value,found:f.found.value,visited:f.visited.value,note:f.note.value});const b=wps();const k=b.findIndex(z=>z.id===w.id);if(k>=0)b[k]=w;else b.push(w);setWps(b);d.remove();msg(`Saved waypoint “${esc(w.name||WT[w.type].n)}”. It’s in the Saved tab.`);};}
window.editWp=editWp;
window.delWp=id=>{const w=wps().find(z=>z.id===id);if(!w||!confirm(`Delete waypoint “${w.name||WT[w.type].n}”?`))return;map.closePopup();setWps(wps().filter(z=>z.id!==id));};
window.newWp=(lat,lng)=>editWp(null,{lat,lng});
map.on('popupopen',()=>{$('#xhair').hidden=true;$('#panel').classList.add('popup-hide');});map.on('popupclose',()=>{$('#xhair').hidden=false;$('#panel').classList.remove('popup-hide');}); // the bottom panel sits above the map, so hide it while a popup is open
window.saveSpot=(lat,lng,good)=>editWp(null,{lat,lng,found:good?'yes':''});
map.on('contextmenu',e=>newWp(e.latlng.lat,e.latlng.lng));   // right-click, or long-press on phones
$('#addwp').onclick=()=>{const c=map.getCenter();newWp(c.lat,c.lng);};
$('#markme').onclick=()=>{msg('Getting your location…');navigator.geolocation.getCurrentPosition(p=>newWp(p.coords.latitude,p.coords.longitude),err=>msg('Location unavailable: '+err.message),{enableHighAccuracy:true,timeout:15000});};
function renderSaved(){const s=wps();$('#saved').innerHTML=s.length?s.slice().reverse().map(x=>{const t=WT[x.type]||WT.other;return `<div class="card">${navTop(x.lat,x.lng,x.name)}<b>${t.e} ${esc(x.name)||t.n}</b> <span class=small>${t.n}${x.visited?' · visited '+esc(x.visited):''}</span><br>
 ${x.type==='tree'||x.found?`<b>${FOUND[x.found||'']}</b><br>`:''}${x.note?`<div class="note">${esc(x.note).replace(/\n/g,'<br>')}</div>`:''}<span class="small">${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}</span><br>
 <button onclick="go('${x.id}')">Show</button> <button onclick="editWp('${x.id}')">✏️ Edit</button><button onclick="delWp('${x.id}')">🗑</button></div>`;}).join('')
  :'<p>No waypoints yet. Long-press (or right-click) the map, tap “+ Waypoint”, or “Mark my location”.</p>';}
window.go=id=>{const x=wps().find(z=>z.id===id);document.querySelector('nav button[data-t=map]').click();map.setView([x.lat,x.lng],15);spotLayer.eachLayer(m=>{if(m.getLatLng().equals([x.lat,x.lng]))m.openPopup();});};
const dl=(name,type,text)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();a.remove();};
const xesc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function toGpx(w){return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="NM Christmas Tree Finder" xmlns="http://www.topografix.com/GPX/1/1" xmlns:tf="https://rmesler3-boop.github.io/christmas-tree-finder/gpx">\n`+
 w.map(x=>{const desc=[`Trees found: ${FOUND[x.found||'']}`,x.visited?`Visited: ${x.visited}`:'',x.note].filter(Boolean).join('\n');return ` <wpt lat="${x.lat.toFixed(7)}" lon="${x.lng.toFixed(7)}">${x.visited?`<time>${x.visited}T12:00:00Z</time>`:''}<name>${xesc(x.name||WT[x.type].n)}</name><cmt>${xesc(x.note)}</cmt><desc>${xesc(desc)}</desc><sym>${{tree:'Forest',parking:'Parking Area',trailhead:'Trail Head',camp:'Campground',other:'Flag, Blue'}[x.type]}</sym><type>${x.type}</type>
  <extensions><tf:found>${x.found||''}</tf:found><tf:visited>${x.visited||''}</tf:visited><tf:species>${xesc(x.species)}</tf:species></extensions></wpt>`;}).join('\n')+'\n</gpx>\n';}
$('#export').onclick=()=>dl('treefinder-waypoints.json','application/json',JSON.stringify(wps(),null,1));
$('#exportgpx').onclick=()=>dl('treefinder-waypoints.gpx','application/gpx+xml',toGpx(wps()));
$('#importf').onchange=async ev=>{const f=ev.target.files[0];if(!f)return;const txt=await f.text();let add=[];
 try{if(/^\s*[\[{]/.test(txt)){let j=JSON.parse(txt);if(!Array.isArray(j))j=[j];add=j.map(s=>({id:s.id||'i'+Math.random().toString(36).slice(2),lat:+s.lat,lng:+(s.lng??s.lon),name:s.name||(s.good?'Good tree':'Imported'),note:s.note||'',type:WT[s.type]?s.type:'tree',found:s.found??(s.good?'yes':''),visited:s.visited||(s.date||'').slice(0,10),species:s.species||'',created:s.created||s.date||new Date().toISOString()}));}
  else{const x=new DOMParser().parseFromString(txt,'application/xml'),T=(e,n)=>{const q=e.getElementsByTagName(n)[0]||e.getElementsByTagName('tf:'+n)[0];return q?q.textContent:'';};
   add=[...x.getElementsByTagName('wpt')].map(e=>{const ty=T(e,'type');return {id:'g'+Math.random().toString(36).slice(2),lat:+e.getAttribute('lat'),lng:+e.getAttribute('lon'),name:T(e,'name'),note:T(e,'cmt')||T(e,'desc'),type:WT[ty]?ty:'other',found:['yes','some','no'].includes(T(e,'found'))?T(e,'found'):'',visited:T(e,'visited')||T(e,'time').slice(0,10),species:T(e,'species'),created:new Date().toISOString()};});}
  add=add.filter(w=>isFinite(w.lat)&&isFinite(w.lng));const cur=wps(),ids=new Set(cur.map(w=>w.id));setWps(cur.concat(add.filter(w=>!ids.has(w.id))));$('#importmsg').textContent=`Imported ${add.length} waypoint(s).`;}
 catch(err){$('#importmsg').textContent='Could not read that file: '+err.message;}ev.target.value='';};
// ----- local tuning from your field notes: light boost near "found", light penalty near "not found" (labelled; does not change the source data)
const TUNE_R=350;function tuneAt(lat,lng){let f=1;for(const w of wps()){if(!w.found)continue;const d=map.distance([lat,lng],[w.lat,w.lng]);if(d>TUNE_R)continue;const k=1-d/TUNE_R;f*=w.found==='yes'?1+.25*k:w.found==='some'?1+.1*k:1-.35*k;}return f;}
window.tuneAt=tuneAt;
const TuneGrid=L.GridLayer.extend({createTile(coords){const t=document.createElement('canvas'),s=this.getTileSize();t.width=s.x;t.height=s.y;if(coords.z<11)return t;const ctx=t.getContext('2d'),org=L.point(coords.x*s.x,coords.y*s.y),tb=tileBox(coords,s).pad(.5);
 for(const w of wps()){if(!w.found||!tb.contains([w.lat,w.lng]))continue;const p=map.project([w.lat,w.lng],coords.z).subtract(org),r=TUNE_R/(40075016.686*Math.cos(w.lat*Math.PI/180)/Math.pow(2,coords.z+8));
  const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r),c=w.found==='no'?'90,90,110':'255,215,0';g.addColorStop(0,`rgba(${c},.45)`);g.addColorStop(1,`rgba(${c},0)`);ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.fill();
  ctx.setLineDash(w.found==='no'?[5,4]:[]);ctx.strokeStyle=w.found==='no'?'#556':'#b8860b';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.stroke();ctx.setLineDash([]);}
 return t;}});
window.tuneLayer=new TuneGrid({pane:'heatPane',zIndex:5}).addTo(map);lc.addOverlay(tuneLayer,'Your field-note tuning (gold = found, gray = none)');
drawWps();renderSaved();
drawWps();
// rules page
function renderRules(){const f=FORESTS[fs.value];$('#rules').innerHTML=`<h2>${f.name}</h2>${f.focus?`<p class="small">Focus: ${f.focus}</p>`:''}
 <div class="card"><b>Buy permit:</b> <a target=_blank href="${f.permit}">${f.permit}</a><br><span class="small">${f.phone}</span></div>
 <div class="card"><b>Season</b><br>${f.season}</div><div class="card"><b>Cost & limits</b><br>${f.cost}</div><div class="card"><b>Tree size</b><br>${f.size}</div>
 <div class="card"><b>Species</b><br>${f.species}</div><div class="card"><b>Where you may NOT cut</b><ul>${f.rules.map(r=>`<li>${r}</li>`).join('')}</ul></div>${setbackCard(fs.value)}
 <div class="card small"><b>⚠ Dates/prices are from the 2025 season.</b> The official permit and its cutting-area map always win. Check forest alerts for fire closures.<br>Sources:<br>${f.sources.map(s=>`<a target=_blank href="${s}">${s}</a>`).join('<br>')}</div>
 <div class="card small"><b>General tips</b> (ABQ Journal / Recreation.gov): bring a handsaw, tape measure, gloves, boots, tarp, rope/straps; full gas tank, warm clothes, survival kit and a paper map – cell service is spotty. Fourth graders with an Every Kid Outdoors pass get a free permit (everykidoutdoors.gov).</div>`;}
renderRules();
fetch('about.html').then(r=>r.text()).then(t=>$('#about').innerHTML=t);
pickSp('fir');
// deep links: #rules #saved #about #top (handy for testing/screenshots)
setTimeout(()=>{const h=location.hash.slice(1);if(['rules','saved','about'].includes(h.split(',')[0]))document.querySelector(`nav button[data-t=${h.split(',')[0]}]`).click();if(h.startsWith('top'))$('#top').click();},300);
{const m=location.hash.match(/view=([-\d.]+),([-\d.]+),(\d+)/);if(m)map.setView([+m[1],+m[2]],+m[3]);}

function setbackCard(fk){const cfg=SETBACKS[fk],cur=getSetbacks(fk);
 return `<div class="card"><b>No-cut distances used on the map</b> <span class="small">(feet)</span><table>${Object.entries(cfg).map(([k,v])=>`<tr><td>${SETBACK_LABELS[k]}</td>
 <td><input type="number" min="0" max="1000" step="10" value="${cur[k]}" data-k="${k}" style="width:70px"></td>
 <td class="small">${v.verified?`✔ official: ${v.note} <a target=_blank href="${v.src}">source</a>`:`<span class="est">DEFAULT</span> ${v.note}`}${cur[k]!==v.ft?` · <i>you changed this (rule/default: ${v.ft} ft)</i>`:''}</td></tr>`).join('')}</table>
 <button onclick="saveSetbacks('${fk}')">Apply to map</button> <button onclick="localStorage.removeItem('tf-setbacks-${fk}');renderRules();refreshMask()">Reset</button>
 <p class="small">Changes update the heat map and no-cut shading for this forest's districts immediately. Road/trail/stream/rec-site setbacks are drawn from vector lines (accurate to the source data, ~10–20 m); land status is a 30 m grid. Stay well clear on the ground.<br><b>Not mapped (no data):</b> ${SETBACK_NODATA.join('; ')}.</p></div>`;}
window.saveSetbacks=fk=>{const o={};document.querySelectorAll('#rules input[data-k]').forEach(i=>o[i.dataset.k]=Math.max(0,+i.value||0));localStorage.setItem('tf-setbacks-'+fk,JSON.stringify(o));renderRules();refreshMask();};

// gentle snowfall (off by default; disabled for reduced-motion users)
let snowOn=false,snowRaf=0;const sc=$('#snow');
$('#snowbtn').onclick=()=>{snowOn=!snowOn;localStorage.setItem('tf-snow',snowOn?'1':'');$('#snowbtn').classList.toggle('on',snowOn);snowOn?startSnow():stopSnow();};
function startSnow(){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;sc.hidden=false;const x=sc.getContext('2d');let fl=[];const rs=()=>{sc.width=innerWidth;sc.height=innerHeight;fl=Array.from({length:Math.min(70,innerWidth/12)},()=>({x:Math.random()*sc.width,y:Math.random()*sc.height,r:1+Math.random()*2.2,v:.3+Math.random()*.7,d:Math.random()*6}));};rs();onresize=rs;
 const step=t=>{x.clearRect(0,0,sc.width,sc.height);x.fillStyle='rgba(255,255,255,.85)';for(const f of fl){f.y+=f.v;f.x+=Math.sin(t/1500+f.d)*.3;if(f.y>sc.height){f.y=-4;f.x=Math.random()*sc.width;}x.beginPath();x.arc(f.x,f.y,f.r,0,7);x.fill();}snowRaf=requestAnimationFrame(step);};snowRaf=requestAnimationFrame(step);}
function stopSnow(){cancelAnimationFrame(snowRaf);sc.hidden=true;}
if(localStorage.getItem('tf-snow')||location.hash.includes('snow')){snowOn=true;$('#snowbtn').classList.add('on');startSnow();}
{const m=location.hash.match(/base=([a-z]+)/);if(m){const want={osm:'Street map (OpenStreetMap)',esri:'Topo (USGS)',topo:'Topo (USGS)',img:'Satellite + topo (USGS)'}[m[1]];if(want&&base[want]){Object.values(base).forEach(l=>map.removeLayer(l));base[want].addTo(map);}}}
{const m=location.hash.match(/sp=([a-z]*)/);if(m)setTimeout(()=>pickSp(m[1]==='off'?'':m[1]),0);}

{const s=$('#nocutop');if(s){s.value=Math.round((noCutLayer?noCutLayer.options.opacity:+(localStorage.getItem('tf-nocut-op')||.25))*100);
 s.oninput=()=>{const v=s.value/100;localStorage.setItem('tf-nocut-op',v);$('#nocutv').textContent=s.value+'%';heatReady.then(()=>noCutLayer.setOpacity(v));};$('#nocutv').textContent=s.value+'%';}}
