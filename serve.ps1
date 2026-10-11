# Minimal static server for TreeFinder (no Python needed). Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1            (serves the folder this script is in)
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1 -Root C:\Users\rmesl\TreeFinder\christmas-tree-app -Port 8000
param([string]$Root = $PSScriptRoot, [int]$Port = 8000)
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json'; '.geojson'='application/geo+json'; '.webmanifest'='application/manifest+json';
  '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.bin'='application/octet-stream'; '.md'='text/plain' }
$l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$Port/"); $l.Start()
Write-Host "Serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"
while ($l.IsListening) {
  $c = $l.GetContext(); $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/')
  if ($p -eq '' -or $p.EndsWith('/')) { $p += 'index.html' }
  $f = Join-Path $Root ($p -replace '/', '\')
  if ((Test-Path $f -PathType Leaf) -and ([IO.Path]::GetFullPath($f).StartsWith([IO.Path]::GetFullPath($Root)))) {
    $b = [IO.File]::ReadAllBytes($f); $e = [IO.Path]::GetExtension($f).ToLower()
    $c.Response.ContentType = $(if ($mime[$e]) { $mime[$e] } else { 'application/octet-stream' })
    $c.Response.Headers.Add('Cache-Control', 'no-cache'); $c.Response.ContentLength64 = $b.Length
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
