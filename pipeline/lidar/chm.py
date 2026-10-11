"""Build a 1 m CHM for the AOI from USGS 3DEP LAZ tiles (NM_SouthEast_2018_D19, QL2), detect small trees, write outputs."""
import laspy, numpy as np, json, glob, os, sys
from scipy import ndimage as ndi
x0,y0,x1,y1=json.load(open('aoi_utm.json'));R=1.0;W=int((x1-x0)/R);H=int((y1-y0)/R)
dtm=np.full((H,W),np.inf,np.float32);dsm=np.full((H,W),-np.inf,np.float32);npts=np.zeros((H,W),np.uint16);nfirst=0
for f in sorted(glob.glob('laz/*.laz')):
    with laspy.open(f) as r:
        if f==sorted(glob.glob('laz/*.laz'))[0]:print('CRS',r.header.parse_crs().name if r.header.parse_crs() else None, 'pts',r.header.point_count)
        for ch in r.chunk_iterator(5_000_000):
            x=np.asarray(ch.x);y=np.asarray(ch.y);z=np.asarray(ch.z,dtype=np.float32);c=np.asarray(ch.classification)
            ok=(x>=x0)&(x<x1)&(y>y0)&(y<=y1)&(c!=7)&(c!=18)&(c!=6)&~np.asarray(ch.withheld,bool)
            if not ok.any():continue
            col=((x[ok]-x0)/R).astype(np.int32);row=((y1-y[ok])/R).astype(np.int32);zz=z[ok];cc=c[ok];idx=row*W+col
            np.maximum.at(dsm.ravel(),idx,zz);np.add.at(npts.ravel(),idx,1)
            g=cc==2;np.minimum.at(dtm.ravel(),idx[g],zz[g])
    print(f,flush=True)
dens=npts.sum()/(W*H);print('mean point density pts/m2',round(float(dens),2))
# fill DTM gaps by nearest ground cell, then light smoothing
m=np.isinf(dtm);ii=ndi.distance_transform_edt(m,return_distances=False,return_indices=True);dtm=dtm[tuple(ii)];dtm=ndi.gaussian_filter(dtm,1)
e=np.isinf(dsm);ii=ndi.distance_transform_edt(e,return_distances=False,return_indices=True);dsm2=dsm[tuple(ii)];dsm=np.where(e,dsm2,dsm)
chm=np.clip(dsm-dtm,0,60).astype(np.float32)
chm=ndi.median_filter(chm,3)  # pit/spike filter
np.save('chm_1m.npy',chm);np.save('dtm_1m.npy',dtm.astype(np.float32))
json.dump(dict(aoi=[x0,y0,x1,y1],epsg=26913,res=R,pt_density=float(dens),empty_cells_pct=float(e.mean()*100)),open('chm_meta.json','w'))
print('done',chm.shape,float(np.percentile(chm,[50,90,99])[2]))
