const V='tf-v12', SHELL=['./','index.html','style.css','app.js','forests.js','setbacks.js','about.html','manifest.webmanifest','icon-192.png','icon-512.png','fonts/MountainsOfChristmas-Bold.woff2',
'vendor/leaflet.js','vendor/leaflet.css','vendor/images/marker-icon.png','vendor/images/marker-icon-2x.png','vendor/images/marker-shadow.png','vendor/images/layers.png',
'data/heat/index.json','data/forests.geojson','data/wilderness.geojson','data/districts.geojson','data/mvum_sacramento.geojson',
...['meta.json','land.png','vec.json',...['fir','ponderosa','pinyon','spruce'].flatMap(s=>[`s_${s}.png`,`g_score_${s}.png`,`g_hab_${s}.png`]),
 ...['height','cover','disturb','slope','twi','road'].map(k=>`g_f_${k}.png`),'g_elev50ft.png',...['paved','fsroad','rec','trail','stream'].map(k=>`g_d_${k}.png`)].map(f=>'data/heat/sacramento/'+f)];
self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!=='tf-tiles'&&k!=='tf-v-districts').map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=e.request.url;if(e.request.method!=='GET')return;
 if(u.startsWith(self.location.origin)){e.respondWith(fetch(e.request).then(resp=>{if(resp.ok){const cl=resp.clone();caches.open(V).then(c=>c.put(e.request,cl));}return resp;}).catch(()=>caches.match(e.request).then(r=>r||Response.error())));return;}
 const tile=/\/tile\/\d+\/\d+\/\d+|tile\.openstreetmap\.org\/\d+/.test(u);if(!tile)return; // other cross-origin requests (e.g. live road queries) go straight to the network
 // map tiles: network first (keeps the request's Referer/CORS mode), fall back to cache offline; only cache good CORS responses, never opaque/error tiles
 e.respondWith(fetch(e.request).then(resp=>{if(resp.ok&&resp.type!=='opaque'){const cl=resp.clone();caches.open('tf-tiles').then(c=>c.put(e.request,cl));}return resp;})
  .catch(()=>caches.match(e.request,{ignoreVary:true}).then(r=>r||Response.error())));});
