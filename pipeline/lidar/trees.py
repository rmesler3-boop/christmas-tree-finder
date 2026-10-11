"""Detect small trees on the 1 m CHM and make a 30 m 'Christmas-size tree density' grid aligned to the Sacramento heat grid.
Growth assumption: lidar flown Nov 2018 - May 2019 (treat as leaf-off/dormant 2019 start); 8 growing seasons (2019-2026) at
0.5-1.0 ft/yr for young white fir / Douglas-fir => +4 to +8 ft (central +6 ft).  Today 5-13 ft  <=>  2019 height ~0-9 ft.
Lidar (QL2, ~2+ pts/m2) cannot reliably see stems < ~0.9 m, so we count 2019 maxima 0.9-2.7 m (3-9 ft):
 full weight 0.9-2.1 m (-> ~9-13 ft today at +6 ft), half weight 2.1-2.7 m (only right if growth was slow).
'Open' preference: weight by 1 - (fraction of CHM > 5 m within 6 m radius) so trees in gaps/edges count more than understory."""
import numpy as np, json, pyproj, sys
from scipy import ndimage as ndi
chm=np.load('chm_1m.npy');M=json.load(open('chm_meta.json'));x0,y0,x1,y1=M['aoi'];H,W=chm.shape
s=ndi.gaussian_filter(chm,0.7)
mx=ndi.maximum_filter(s,size=3)        # 3x3 window: small crowns ~1-2 m wide
peak=(s==mx)&(s>=0.9)&(s<=6)
# reject peaks that sit right under tall canopy (understory, invisible from the road and usually suppressed)
tall=(chm>5).astype(np.float32);yy,xx=np.mgrid[-6:7,-6:7];k=((xx**2+yy**2)<=36).astype(np.float32);k/=k.sum()
cov=ndi.convolve(tall,k,mode='nearest')
h=s[peak];r,c=np.nonzero(peak)
wt=np.where((h>=0.9)&(h<2.1),1.0,np.where((h>=2.1)&(h<=2.7),0.5,0.0))*(1-cov[peak])
sel=wt>0;r,c,h,wt,cv=r[sel],c[sel],h[sel],wt[sel],cov[peak][sel]
print('small-tree peaks',len(r),'weighted',wt.sum().round(1),'per ha',(wt.sum()/(W*H/1e4)).round(1))
X=x0+c+0.5;Y=y1-r-0.5;lon,lat=pyproj.Transformer.from_crs(26913,4326,always_xy=True).transform(X,Y)
np.save('trees.npy',np.c_[lon,lat,h,wt,cv].astype(np.float64))
# 30 m grid aligned to the Sacramento heat grid
hm=json.load(open('/workspace/christmas-tree-app/data/heat/sacramento/meta.json'));BW,BS,BE,BN=hm['bbox'];gw,gh=hm['w'],hm['h']
gx=((lon-BW)/(BE-BW)*gw).astype(int);gy=((BN-lat)/(BN-BS)*gh).astype(int)
dens=np.zeros((gh,gw),np.float32);np.add.at(dens,(gy,gx),wt)
# coverage mask: heat cells whose centre falls inside the AOI
cx=BW+(np.arange(gw)+.5)/gw*(BE-BW);cy=BN-(np.arange(gh)+.5)/gh*(BN-BS);CX,CY=np.meshgrid(cx,cy)
ux,uy=pyproj.Transformer.from_crs(4326,26913,always_xy=True).transform(CX,CY);cover=(ux>x0+15)&(ux<x1-15)&(uy>y0+15)&(uy<y1-15)
cell_area=(BE-BW)/gw*111320*np.cos(np.radians((BS+BN)/2))*(BN-BS)/gh*110540
dens_ha=dens/cell_area*1e4
np.save('lidar_density_ha.npy',dens_ha);np.save('lidar_cover.npy',cover)
v=dens_ha[cover];print('cells',cover.sum(),'trees/ha p50,p90,p99',np.percentile(v,[50,90,99]).round(1))
