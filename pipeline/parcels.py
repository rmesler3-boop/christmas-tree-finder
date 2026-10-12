"""Mask private inholdings using NM county assessor parcels (NM OSE/TRD 'County_Parcels_2026' statewide service).
Usage: python parcels.py <district_id> [...]   (run from data/heat parent; edits land.png + s_*.png in place, hard zero)
A parcel is masked only if it has an owner name and that name is NOT federal (US/USDA/Forest Service/BLM/etc.).
Null/blank owners are left alone (conservative: never mask USFS land on missing data)."""
import json, os, re, sys, time, urllib.request, urllib.parse
import numpy as np
from PIL import Image, ImageDraw
B = "https://gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2026/MapServer"
LAYERS = {0:'Bernalillo',1:'Catron',2:'Chaves',3:'Cibola',4:'Colfax',8:'Eddy',9:'Grant',14:'Lincoln',17:'McKinley',18:'Mora',19:'Otero',
          21:'Rio Arriba',23:'Sandoval',25:'San Miguel',26:'Santa Fe',27:'Sierra',28:'Socorro',29:'Taos',30:'Torrance',32:'Valencia'}
FED = re.compile(r"UNITED STATES|\bU\.? ?S\.? ?A\b|\bUSA\b|\bU ?S\b.*(GOV|FOREST|DEPT|OF AMERICA)|USDA|FOREST SERVICE|NATIONAL FOREST|"
                 r"BUREAU OF LAND|\bBLM\b|DEPT\.? OF (THE )?INTERIOR|DEPARTMENT OF (THE )?INTERIOR|DEPARTMENT OF AGRICULTURE|FEDERAL|"
                 r"US GOV|U S GOV|GOVERNMENT OF THE UNITED|NATIONAL PARK|FISH (&|AND) WILDLIFE|STATE OF NEW ME|COMMISSIONER OF PUBLIC LANDS|STATE LAND OFFICE|STATE OF N\.? ?M\b|ENABLING ACT|BUREAU OF RECLAMATION|U\.S\. GOV", re.I)
def get(url, tries=5):
    for i in range(tries):
        try: return json.load(urllib.request.urlopen(url, timeout=120))
        except Exception as e:
            if i == tries-1: raise
            time.sleep(2**i)
def fetch(lid, bbox):
    out, off = [], 0
    while True:
        q = dict(where="1=1", geometry=",".join(map(str,bbox)), geometryType="esriGeometryEnvelope", inSR=4326, outSR=4326,
                 spatialRel="esriSpatialRelIntersects", outFields="OwnerAll,Owner1", returnGeometry="true", maxAllowableOffset=0.00005,
                 resultOffset=off, resultRecordCount=2000, f="json")
        d = get(f"{B}/{lid}/query?" + urllib.parse.urlencode(q))
        if "error" in d: print(LAYERS[lid], "error", d["error"]); break
        fs = d.get("features", []); out += fs; off += len(fs)
        if not fs or not d.get("exceededTransferLimit"): break
    return out
def run(D, base="data/heat"):
    m = json.load(open(f"{base}/{D}/meta.json")); W,S,E,N = m["bbox"]
    land = np.array(Image.open(f"{base}/{D}/land.png")); h,w = land.shape
    land0 = land.copy(); own_ct = {}; skipped = []; BIG = 260e4/900  # 1 sq mi in 30 m cells
    img = Image.new("L",(w,h),0); dr = ImageDraw.Draw(img); stats = {}
    px = lambda p: ((p[0]-W)/(E-W)*w, (N-p[1])/(N-S)*h)
    for lid, cn in LAYERS.items():
        fs = fetch(lid, (W,S,E,N)); npriv = nfed = nnull = nskip = 0
        for f in fs:
            g = f.get("geometry") or {}; rings = g.get("rings")
            if not rings: continue
            o = ((f["attributes"].get("OwnerAll") or f["attributes"].get("Owner1") or "")).strip()
            if not o: nnull += 1; continue
            if FED.search(o): nfed += 1; continue
            pr = [[px(p) for p in r] for r in rings if len(r) > 2]
            area = sum(abs(sum(x0*y1-x1*y0 for (x0,y0),(x1,y1) in zip(r, r[1:]+r[:1])))/2 for r in pr)  # in cells
            if area > BIG:  # big private parcel: skip if mostly on USFS-cuttable land (likely assessor geometry error, don't mask USFS)
                t = Image.new("L",(w,h),0); td = ImageDraw.Draw(t)
                for r in pr: td.polygon(r, fill=255)
                tm = np.array(t) > 0
                ov = int((tm & (land0 > 0)).sum())
                if ov: nskip += 1; skipped.append((o, round(area*0.09), ov)); continue  # >1 sq mi and on land USFS+BLM layers call USFS: skip
            npriv += 1; own_ct[o] = own_ct.get(o, 0) + area
            for r in pr:  # exterior + holes both filled by XOR trick: draw exteriors, holes are rare in assessor data -> ignore holes conservatively? no: fill all, inholdings inside private are private too
                dr.polygon(r, fill=255, outline=255)
        if fs: stats[cn] = dict(parcels=len(fs), private=npriv, federal=nfed, no_owner=nnull, big_skipped=nskip)
    pm = np.array(img) > 0
    newly = int((pm & (land > 0)).sum())
    np.save(f"pipeline/cache/parcels/{D}.npy", pm)
    land[pm] = 0; Image.fromarray(land).save(f"{base}/{D}/land.png", optimize=True)
    for fn in os.listdir(f"{base}/{D}"):
        if fn.startswith("s_") and fn.endswith(".png"):
            s = np.array(Image.open(f"{base}/{D}/{fn}")); s[pm] = 0; Image.fromarray(s).save(f"{base}/{D}/{fn}", optimize=True)
    m["parcels"] = dict(source=B, tax_year=2026, counties=stats, cells_newly_masked=newly, top_private_owners_by_cells=sorted(((k, round(v)) for k, v in own_ct.items()), key=lambda t: -t[1])[:15],
                        skipped_big=sorted(skipped, key=lambda s: -s[2])[:50], rule="private = parcel with an owner name not matching federal agencies; blank owners not masked; cells already non-USFS per USFS Basic Ownership/BLM SMA are masked anyway; parcels >1 sq mi touching land those layers call USFS are skipped (likely assessor geometry errors/allotments), smaller ones are masked as inholdings")
    json.dump(m, open(f"{base}/{D}/meta.json","w"), indent=1)
    print(D, "newly masked cells", newly, stats, flush=True)
if __name__ == "__main__":
    for D in sys.argv[1:]: run(D)
