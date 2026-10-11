# NM Christmas Tree Finder (PWA)
Plain static site (HTML/JS/PNG/binary grids, all relative paths). Any static web server works; nothing server-side is needed.

## Run it on Windows (no Python)
In PowerShell, from the `christmas-tree-app` folder:

    powershell -ExecutionPolicy Bypass -File .\serve.ps1
    # or: .\serve.ps1 -Root C:\Users\rmesl\TreeFinder\christmas-tree-app -Port 8000

Open http://localhost:8000/ . If you use your own HttpListener script, make sure it maps `/` to `index.html`
and sends `.js` as `text/javascript` (needed for offline mode; the map works either way).
After an update, press Ctrl+Shift+R once.

## Other servers
`python3 -m http.server 8000` · `npx serve` · GitHub Pages / Netlify (HTTPS – needed for GPS + install on Android).

## Install on Android
Host on HTTPS (e.g. GitHub Pages), open in Chrome, menu → Install app / Add to Home screen.

## Rebuild heat map / masks
`python pipeline/build_heatmap.py <area_id> W S E N [width]` (needs numpy, tifffile, pillow, scipy).
No-cut distances per forest live in `setbacks.js` (verified vs DEFAULT, with sources) and are applied live in the browser.
