#!/usr/bin/env python3
"""Build heat maps for every NM national-forest ranger district (skips Kiowa/Rita Blanca grasslands: no conifers).
Writes ../data/heat/<id>/ per district and ../data/heat/index.json. Usage: build_all_nm.py [parallel=3] [only=id,id]"""
import json, os, re, subprocess, sys, math
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
FK = {"Lincoln": "lincoln", "Santa Fe": "santafe", "Carson": "carson", "Cibola": "cibola", "Gila": "gila"}
args = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
d = json.load(open(os.path.join(DATA, "districts.geojson")))
jobs = []
for f in d["features"]:
    p = f["properties"]; fk = next((v for k, v in FK.items() if k in p["forestname"]), None)
    if not fk or "Grassland" in p["districtname"]: continue
    g = f["geometry"]; polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    cs = [c for P in polys for r in P for c in r]; xs = [c[0] for c in cs]; ys = [c[1] for c in cs]
    bb = [round(min(xs)-.01, 3), round(min(ys)-.01, 3), round(max(xs)+.01, 3), round(max(ys)+.01, 3)]
    aid = "sacramento" if p["districtorgcode"] == "030802" else re.sub(r"[^a-z]+", "-", p["districtname"].lower().replace(" ranger district", "")).strip("-")
    jobs.append(dict(id=aid, name=p["districtname"], forest=fk, forestname=p["forestname"], district=p["districtorgcode"], bbox=bb))
if "only" in args: jobs = [j for j in jobs if j["id"] in args["only"].split(",")]
def run(j):
    log = open(os.path.join("/tmp", f"heat_{j['id']}.log"), "w")
    r = subprocess.run([sys.executable, os.path.join(HERE, "build_heatmap.py"), j["id"], *map(str, j["bbox"]), f"district={j['district']}", f"forest={j['forest']}", f"name={j['name']}"], stdout=log, stderr=subprocess.STDOUT)
    print(j["id"], "OK" if r.returncode == 0 else "FAILED", flush=True); return r.returncode
with ThreadPoolExecutor(int(args.get("parallel", 3))) as ex: list(ex.map(run, jobs))
idx = []
for j in json.load(open(os.path.join(DATA, "heat", "index.json"))) if os.path.exists(os.path.join(DATA, "heat", "index.json")) else []:
    if j["id"] not in [k["id"] for k in jobs]: idx.append(j)
for j in jobs:
    out = os.path.join(DATA, "heat", j["id"])
    if not os.path.exists(os.path.join(out, "meta.json")): continue
    files = sorted(os.listdir(out)); j["files"] = files; j["bytes"] = sum(os.path.getsize(os.path.join(out, f)) for f in files); idx.append(j)
json.dump(sorted(idx, key=lambda x: x["id"]), open(os.path.join(DATA, "heat", "index.json"), "w"), indent=1)
print("index:", len(idx), "areas")
