#!/usr/bin/env python3
"""TreeFinder NM heat-map pipeline (reusable for any bbox / NM forest).

Usage: python build_heatmap.py <area_id> <west> <south> <east> <north> [width_px]
Outputs into ../data/heat/<area_id>/ : <species>.png overlays, factors_*.bin grids, meta.json

ALL OUTPUTS ARE LIKELIHOOD ESTIMATES from a rules-based score, not field-verified data.
Data (fetched live from public services):
  LANDFIRE LF2024 EVT/EVH/EVC (lfps.usgs.gov ImageServer), LANDFIRE LF2020 Elev/SlpD/Asp (Landfire_Topo)
  USFS EDW: forest boundaries, wilderness, MVUM roads, MTBS burned areas, FACTS timber harvest,
  hazardous fuels (mechanical) treatments.
"""
import sys, os, json, io, csv, math, urllib.request, urllib.parse
import numpy as np, tifffile
from PIL import Image, ImageDraw
from scipy import ndimage

LF = "https://lfps.usgs.gov/arcgis/rest/services"
EDW = "https://apps.fs.usda.gov/arcx/rest/services/EDW"
CUR_YEAR = 2026

def get(url, params, binary=False):
    u = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(5):  # USFS/LANDFIRE servers drop connections now and then
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "treefinder-pipeline"}), timeout=180) as r:
                b = r.read()
            break
        except Exception as e:
            if attempt == 4: raise
            import time; time.sleep(5 * (attempt + 1))
    return b if binary else json.loads(b)

def lf_raster(svc, bbox, w, h):
    if w*h > 5e6:  # server limit: fetch in 2x2 pieces and stitch
        W, S, E, N = bbox; w1, h1 = w//2, h//2; xm = W+(E-W)*w1/w; ym = N-(N-S)*h1/h
        top = np.hstack([lf_raster(svc, (W, ym, xm, N), w1, h1), lf_raster(svc, (xm, ym, E, N), w-w1, h1)])
        bot = np.hstack([lf_raster(svc, (W, S, xm, ym), w1, h-h1), lf_raster(svc, (xm, S, E, ym), w-w1, h-h1)])
        return np.vstack([top, bot])
    b = get(f"{LF}/{svc}/ImageServer/exportImage", dict(bbox=",".join(map(str, bbox)), bboxSR=4326, imageSR=4326,
            size=f"{w},{h}", format="tiff", pixelType="F32", interpolation="RSP_NearestNeighbor", f="image"), True)
    return tifffile.imread(io.BytesIO(b)).astype(np.float32)

def edw_features(layer, bbox, where="1=1", fields="*", offset=0.0003, base=None):
    feats, off = [], 0
    while True:
        d = get(f"{base or EDW}/{layer}/query", dict(where=where, geometry=",".join(map(str, bbox)), geometryType="esriGeometryEnvelope",
                inSR=4326, outSR=4326, spatialRel="esriSpatialRelIntersects", outFields=fields, maxAllowableOffset=offset,
                geometryPrecision=5, resultOffset=off, resultRecordCount=1000, f="geojson"))
        fs = d.get("features", []); feats += fs
        if len(fs) < 1000: return feats
        off += 1000

def rasterize(feats, bbox, w, h, line_width=0):
    W, S, E, N = bbox
    img = Image.new("L", (w, h), 0); dr = ImageDraw.Draw(img)
    px = lambda c: ((c[0]-W)/(E-W)*w, (N-c[1])/(N-S)*h)
    for f in feats:
        g = f.get("geometry");
        if not g: continue
        t, cs = g["type"], g["coordinates"]
        if t == "Polygon": cs, t = [cs], "MultiPolygon"
        if t == "LineString": cs, t = [cs], "MultiLineString"
        if t == "MultiPolygon":
            for poly in cs:
                dr.polygon([px(c) for c in poly[0]], fill=1)
                for hole in poly[1:]: dr.polygon([px(c) for c in hole], fill=0)
        elif t == "Point":
            x, y = px(cs); dr.ellipse([x-1, y-1, x+1, y+1], fill=1)
        elif t == "MultiLineString":
            for ln in cs: dr.line([px(c) for c in ln], fill=1, width=max(1, line_width))
    return np.array(img, dtype=bool)

# ---- Species habitat from LANDFIRE EVT (system names; weights are estimates) ----
SPECIES = {
  "fir": {"label": "White fir / Douglas-fir (mixed conifer)", "elev_ft": (7800, 9800),
          "evt": {"Madrean Upper Montane Conifer-Oak": 1.0, "Dry-Mesic Montane Mixed Conifer": 1.0, "Mesic Montane Mixed Conifer": 1.0,
                  "Aspen-Mixed Conifer": 0.9, "Ponderosa Pine Woodland": 0.3, "Spruce-Fir": 0.6, "Aspen Forest": 0.4}, "north": True},
  "spruce": {"label": "Spruce / subalpine & corkbark fir", "elev_ft": (9500, 11800),
          "evt": {"Spruce-Fir": 1.0, "Mesic Montane Mixed Conifer": 0.5, "Aspen-Mixed Conifer": 0.5}, "north": True},
  "ponderosa": {"label": "Ponderosa pine", "elev_ft": (6800, 8800),
          "evt": {"Ponderosa Pine": 1.0, "Pine-Oak": 0.8, "Conifer-Oak": 0.5, "Dry-Mesic Montane Mixed Conifer": 0.4}, "north": False},
  "pinyon": {"label": "Pinyon pine (and juniper)", "elev_ft": (5500, 7600),
          "evt": {"Pinyon-Juniper": 1.0, "Juniper Woodland": 0.4, "Pine-Oak": 0.3, "Ponderosa Pine Woodland": 0.2}, "north": False},
}
# Northern NM (Santa Fe, Carson, Cibola Mt Taylor/Sandia; mean lat >= 34.8) bands — ESTIMATES (ft), slightly higher/wider than the south
ELEV_NORTH = {"fir": (8000, 10200), "spruce": (9500, 12000), "ponderosa": (7000, 9000), "pinyon": (5800, 7600)}
LIDAR_W, META_W = 0.35, 0.12   # weight of 'Christmas-size tree density' where lidar (2) or Meta 1 m CHM (1) covers a cell
WEIGHTS = {"height": 0.20, "cover": 0.12, "disturb": 0.13, "elev": 0.15, "aspect": 0.10, "slope": 0.10, "twi": 0.05, "road": 0.15}

def band(x, lo, hi, soft=600.0):
    return np.clip(np.minimum((x-(lo-soft))/soft, ((hi+soft)-x)/soft), 0, 1)

def twi(dem, cell_m, slope_deg):
    # Simple D8 flow accumulation (estimate) -> TWI = ln(a / tan b)
    h, w = dem.shape; order = np.argsort(-dem, axis=None)
    acc = np.ones(dem.size, np.float64); z = dem.ravel()
    offs = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
    best = np.full(dem.size, -1, np.int64); bdrop = np.zeros(dem.size)
    for dy, dx in offs:
        sh = np.full_like(dem, np.inf); ys = slice(max(dy,0), h+min(dy,0)); yd = slice(max(-dy,0), h+min(-dy,0))
        xs = slice(max(dx,0), w+min(dx,0)); xd = slice(max(-dx,0), w+min(-dx,0))
        sh[yd, xd] = dem[ys, xs]
        drop = ((dem - sh) / math.hypot(dy, dx)).ravel()
        idx = (np.arange(dem.size).reshape(h, w) + dy*w + dx).ravel()
        better = drop > bdrop; bdrop[better] = drop[better]; best[better] = idx[better]
    for i in order:
        j = best[i]
        if j >= 0: acc[j] += acc[i]
    a = acc.reshape(h, w) * cell_m
    return np.log(a / np.maximum(np.tan(np.radians(np.maximum(slope_deg, 0.5))), 1e-3))

def main():
    aid = sys.argv[1]; bbox = tuple(map(float, sys.argv[2:6])); W, S, E, N = bbox
    opts = dict(a.split("=", 1) for a in sys.argv[6:] if "=" in a)   # district=030802 forest=lincoln name="..."
    w = int(opts.get("width", 0)) or int(round((E-W)*111320*math.cos(math.radians((S+N)/2))/30))  # native 30 m
    region = "north" if (S+N)/2 >= 34.8 else "south"
    cell_m = (E-W)/w*111320*math.cos(math.radians((S+N)/2)); h = int(round((N-S)*111320/cell_m))
    out = os.path.join(os.path.dirname(__file__), "..", "data", "heat", aid); os.makedirs(out, exist_ok=True)
    print("grid", w, h, "cell ~%.0f m" % cell_m)
    evt = lf_raster("Landfire_LF2024/LF2024_EVT_CONUS", bbox, w, h)
    evh = lf_raster("Landfire_LF2024/LF2024_EVH_CONUS", bbox, w, h)
    evc = lf_raster("Landfire_LF2024/LF2024_EVC_CONUS", bbox, w, h)
    elev = lf_raster("Landfire_Topo/LF2020_Elev_CONUS", bbox, w, h)
    slp = lf_raster("Landfire_Topo/LF2020_SlpD_CONUS", bbox, w, h)
    asp = lf_raster("Landfire_Topo/LF2020_Asp_CONUS", bbox, w, h)
    print("rasters ok", np.nanmin(elev), np.nanmax(elev), np.nanmax(slp))
    names = {int(r["VALUE"]): r["EVT_NAME"] for r in csv.DictReader(io.StringIO(urllib.request.urlopen(
        "https://landfire.gov/sites/default/files/CSV/2024/LF2024_EVT.csv", timeout=120).read().decode("latin1")))}
    forest = rasterize(edw_features("EDW_ForestSystemBoundaries_01/MapServer/1", bbox, offset=0.0005), bbox, w, h)
    wild = rasterize(edw_features("EDW_Wilderness_01/MapServer/0", bbox, offset=0.0005), bbox, w, h)
    roads_f = edw_features("EDW_MVUM_02/MapServer/1", bbox, fields="id,name,passengervehicle,highclearancevehicle,seasonal,surfacetype")
    roads = rasterize([f for f in roads_f if "open" in (str(f["properties"].get("passengervehicle"))+str(f["properties"].get("highclearancevehicle")))], bbox, w, h)
    burns, harv = [], []
    mtbs_meta = get(f"{EDW}/EDW_MTBS_01/MapServer", {"f": "json"})["layers"]
    for L in mtbs_meta:
        nm = L["name"]
        if nm.endswith("Burned Area Boundaries") and nm[:4].isdigit() and CUR_YEAR-26 <= int(nm[:4]) <= CUR_YEAR-9:
            burns += edw_features(f"EDW_MTBS_01/MapServer/{L['id']}", bbox, fields="fire_name,year", offset=0.0005)
    harv = edw_features("EDW_TimberHarvest_01/MapServer/8", bbox, where=f"fy_completed>='{CUR_YEAR-26}' AND fy_completed<='{CUR_YEAR-8}' AND activity_name NOT LIKE '%Natural Changes%'", fields="activity_name,fy_completed", offset=0.0005)
    try:
        fuel = edw_features("EDW_HazardousFuelsTreatments_01/MapServer/15", bbox, where=f"fy_planned_or_accomplished>={CUR_YEAR-26} AND fy_planned_or_accomplished<={CUR_YEAR-8} AND date_completed IS NOT NULL", fields="treatment_name,fy_planned_or_accomplished", offset=0.0005)
    except Exception as e:
        print("fuels failed", e); fuel = []
    print("features: roads", len(roads_f), "burns", len(burns), "harvest", len(harv), "fuels", len(fuel))
    disturbed = rasterize(burns + harv + fuel, bbox, w, h)

    # ---- factor scores 0..1 ----
    ht = np.where((evh >= 101) & (evh < 200), evh-100, np.nan)        # dominant canopy height (m)
    f_small, src_small = None, None
    LD = os.environ.get("SMALLTREE_DIR")   # outputs of pipeline/lidar/*.py, already on this area's heat grid
    if LD and aid == "sacramento" and os.path.exists(os.path.join(LD, "lidar_density_ha.npy")):
        ld, lc = np.load(os.path.join(LD, "lidar_density_ha.npy")), np.load(os.path.join(LD, "lidar_cover.npy"))
        src_small = np.where(lc, 2, 0).astype(np.uint8); f_small = 1 - np.exp(-ld/12.0)   # ~12 weighted small trees/ha -> 0.63
        if os.path.exists(os.path.join(LD, "meta_density_ha.npy")):
            md, mc = np.load(os.path.join(LD, "meta_density_ha.npy")), np.load(os.path.join(LD, "meta_cover.npy"))
            f_meta = 1 - np.exp(-md/40.0)   # Meta over-detects 1-3 m pixels (~4x lidar in the test area), so a softer scale
            src_small = np.where((src_small == 0) & mc, 1, src_small); f_small = np.where(src_small == 1, f_meta, f_small)
        # put lidar and Meta on the same footing: percentile rank (mid-rank for ties) of density within each source
        for code, dens in ((2, ld), (1, md if os.path.exists(os.path.join(LD, "meta_density_ha.npy")) else None)):
            sel = src_small == code
            if dens is None or not sel.any(): continue
            v = dens[sel]; srt = np.sort(v); lo = np.searchsorted(srt, v, "left"); hi = np.searchsorted(srt, v, "right")
            f_small[sel] = (lo + hi) / 2 / len(v)
        print("small-tree factor: lidar cells", int((src_small == 2).sum()), "meta cells", int((src_small == 1).sum()))
    f_height = np.where(np.isnan(ht), 0.35, np.interp(np.nan_to_num(ht), [0, 5, 10, 15, 25], [1.0, 1.0, 0.7, 0.4, 0.15]))
    cc = np.where((evc >= 110) & (evc < 200), evc-100, np.nan)        # tree canopy cover %
    f_cover = np.where(np.isnan(cc), 0.4, np.interp(np.nan_to_num(cc), [0, 15, 25, 60, 80, 100], [0.4, 0.7, 1.0, 1.0, 0.6, 0.3]))
    f_dist = np.where(disturbed, 1.0, 0.45)
    f_slope = np.interp(slp, [0, 8, 17, 25, 35], [1.0, 1.0, 0.65, 0.3, 0.05])  # degrees
    dist_road_m = ndimage.distance_transform_edt(~roads) * cell_m
    f_road = np.interp(dist_road_m, [0, 60, 400, 1200, 2500], [0.0, 0.9, 1.0, 0.6, 0.3])
    t = twi(np.nan_to_num(elev), cell_m, slp); t_ok = np.isfinite(t)
    f_twi = np.interp(np.where(t_ok, t, 8), [4, 7, 10, 13], [0.6, 0.8, 1.0, 0.6])   # moist-but-not-channel
    elev_ft = elev * 3.28084
    developed = np.vectorize(lambda v: ("Developed" in names.get(int(v), "")) or ("Open Water" in names.get(int(v), "")) or v < 0)(evt)
    # ---- legal-land mask (land status) + setback distance grids (setbacks applied live in the app) ----
    own = rasterize(edw_features("EDW_BasicOwnership_02/MapServer/0", bbox, where="ownerclassification='USDA FOREST SERVICE'", offset=0.0002), bbox, w, h)
    SMA = "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer"
    non = np.zeros_like(own)
    for lid in (12, 14, 15, 16):  # BIA, State, Local, Private/Unknown
        try: non |= rasterize(edw_features(str(lid), bbox, offset=0.0002, base=SMA), bbox, w, h)
        except Exception as e: print("SMA", lid, "failed", e)
    road_dev = np.vectorize(lambda v: names.get(int(v), "") == "Developed-Roads")(evt)
    developed_nr = developed & ~road_dev
    paved = rasterize([f for f in roads_f if str(f["properties"].get("surfacetype", "")).upper().startswith(("P -", "PAV", "BST"))], bbox, w, h) | road_dev
    rec_pts = edw_features("EDW_RecInfraRecreationSites_02/MapServer/0", bbox, fields="site_name,site_type")
    rec_poly = edw_features("EDW_DevelopedSite_01/MapServer/0", bbox, fields="areaname", offset=0.0002)
    rec = rasterize(rec_pts + rec_poly, bbox, w, h)
    trails_f = edw_features("EDW_TrailNFSPublish_01/MapServer/0", bbox, fields="trail_name", offset=0.0002)
    trails = rasterize(trails_f, bbox, w, h)
    streams_f = edw_features("6", bbox, where="fcode=46006", fields="gnis_name", offset=0.0002, base="https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer")
    streams = rasterize(streams_f, bbox, w, h)
    print("mask feats: rec", len(rec_pts)+len(rec_poly), "trails", len(trails_f), "streams", len(streams_f), "own px", int(own.sum()), "non px", int((non&own).sum()))
    legal = own & ~non & ~wild & ~developed_nr & (dist_road_m > 15)
    def savegrid(name, arr):  # 8-bit grayscale PNG grid at 2x cell size (lossless, small)
        Image.fromarray(np.ascontiguousarray(arr.astype(np.uint8)[::2, ::2]), "L").save(os.path.join(out, f"g_{name}.png"), optimize=True)
    def dgrid(m):  # metres to nearest feature, stored in 2 m units (cap 510 m)
        return np.clip(ndimage.distance_transform_edt(~m) * cell_m / 2, 0, 255) if m.any() else np.full(m.shape, 255)
    for nm, m in dict(paved=paved, fsroad=roads, rec=rec, trail=trails, stream=streams).items():
        savegrid("d_" + nm, dgrid(m))
    landok = own & ~non & ~wild & ~developed_nr
    if opts.get("district"):
        dmask = rasterize(edw_features("EDW_RangerDistricts_03/MapServer/1", bbox, where=f"districtorgcode='{opts['district']}'", offset=0.0002), bbox, w, h)
        landok &= dmask; legal &= dmask
    Image.fromarray((landok*255).astype(np.uint8), "L").save(os.path.join(out, "land.png"), optimize=True)
    hw = edw_features("6", bbox, fields="NAME", offset=0.0001, base="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer")
    def slim(fs, keep=()):
        return [{"type": "Feature", "properties": {k: f["properties"].get(k) for k in keep}, "geometry": f["geometry"]} for f in fs if f.get("geometry")]
    usfs_f = []
    non_f = []
    wild_f = []  # land status is shipped as the 30 m land.png mask instead (vectors too large)
    vec = {"paved": slim([f for f in roads_f if str(f["properties"].get("surfacetype", "")).upper().startswith(("P -", "PAV", "BST"))]) + slim(hw),
           "fsroad": slim(roads_f, ("id",)), "rec": slim(rec_pts + rec_poly), "trail": slim(trails_f), "stream": slim(streams_f)}
    json.dump(vec, open(os.path.join(out, "vec.json"), "w"), separators=(",", ":"))
    print("vec sizes", {k: len(v) for k, v in vec.items()}, "highways", len(hw))
    uniq = np.unique(evt); meta = {"area": aid, "bbox": bbox, "w": w, "h": h, "cell_m": cell_m, "weights": WEIGHTS,
        "generated": "LANDFIRE LF2024 EVT/EVH/EVC; LANDFIRE LF2020 Elev/Slope/Aspect; USFS EDW boundaries, wilderness, MVUM, MTBS, FACTS harvest, hazardous fuels",
        "counts": {"rec": len(rec_pts)+len(rec_poly), "trails": len(trails_f), "streams": len(streams_f), "roads": len(roads_f), "burns": len(burns), "harvest": len(harv), "fuels": len(fuel)}, "species": {}}
    for sp, cfg in SPECIES.items():
        lut = {int(v): max([wt for k, wt in cfg["evt"].items() if k in names.get(int(v), "")] or [0]) for v in uniq}
        f_hab = np.vectorize(lambda v: lut.get(int(v), 0))(evt).astype(np.float32)
        f_elev = band(elev_ft, *(ELEV_NORTH[sp] if region == "north" else cfg["elev_ft"]))
        f_asp = np.where(asp < 0, 0.75, 0.75 + 0.25*np.cos(np.radians(asp - 22.5))) if cfg["north"] else np.where(asp < 0, 0.8, 0.8 + 0.2*np.cos(np.radians(asp - 202.5)))
        F = dict(height=f_height, cover=f_cover, disturb=f_dist, elev=f_elev, aspect=f_asp, slope=f_slope, twi=f_twi, road=f_road)
        comb = sum(WEIGHTS[k]*F[k] for k in WEIGHTS)
        if f_small is not None:  # lidar / Meta small-tree density replaces most of the coarse LANDFIRE EVH height factor
            rest = (comb - WEIGHTS["height"]*f_height) / (1 - WEIGHTS["height"])
            comb = np.where(src_small == 2, LIDAR_W*f_small + 0.05*f_height + (0.95-LIDAR_W)*rest,
                   np.where(src_small == 1, META_W*f_small + 0.15*f_height + (0.85-META_W)*rest, comb))
        score = np.where(~developed_nr & ~wild, f_hab * comb * np.minimum(1, f_elev*1.5+0.2), 0)  # land status & setbacks are clipped as vectors in the app
        pos = score[(score > 0) & legal]
        p99 = float(np.percentile(pos, 99)) if pos.size else 1.0
        q = np.clip(score/max(p99, 1e-6), 0, 1)  # relative within area (99th pct = top colour)
        Image.fromarray(np.clip(q*255, 0, 255).astype(np.uint8), "L").save(os.path.join(out, f"s_{sp}.png"), optimize=True)  # coloured in the app
        savegrid("score_" + sp, np.clip(q*255, 0, 255))
        savegrid("hab_" + sp, np.clip(f_hab*255, 0, 255))
        meta["species"][sp] = {"label": cfg["label"], "elev_ft": cfg["elev_ft"], "share_high": float((q > 0.6).mean())}
        print(sp, "cells>0.6:", int((q > 0.6).sum()))
    if f_small is not None:
        Image.fromarray(np.ascontiguousarray((np.clip(f_small, 0, 1)*255).astype(np.uint8)[::2, ::2]), "L").save(os.path.join(out, "g_f_small.png"), optimize=True)
        Image.fromarray(np.ascontiguousarray((src_small*100).astype(np.uint8)[::2, ::2]), "L").save(os.path.join(out, "g_src_small.png"), optimize=True)
        meta["small_tree"] = {"lidar_weight": LIDAR_W, "meta_weight": META_W, "lidar": "USGS 3DEP NM_SouthEast_2018_D19 (QL2, flown Nov 2018-May 2019), test area ~5x5 km around Cloudcroft",
                              "meta": "Meta/WRI 1 m canopy height v1 (imagery 2018), tile 023103221", "growth_ft_per_yr": [0.5, 1.0], "seasons": 8}
    for k, arr in dict(height=f_height, cover=f_cover, disturb=f_dist, slope=f_slope, twi=f_twi, road=f_road).items():
        savegrid("f_" + k, np.clip(arr*255, 0, 255))
    savegrid("elev50ft", np.clip(np.nan_to_num(elev_ft)/50, 0, 255))
    meta["gw"], meta["gh"] = legal[::2, ::2].shape[1], legal[::2, ::2].shape[0]
    meta.update(region=region, district=opts.get("district"), forest=opts.get("forest"), name=opts.get("name"),
                elev_bands={sp: (ELEV_NORTH[sp] if region == "north" else SPECIES[sp]["elev_ft"]) for sp in SPECIES})
    json.dump(meta, open(os.path.join(out, "meta.json"), "w"), indent=1)
    print("done", out)

if __name__ == "__main__": main()
