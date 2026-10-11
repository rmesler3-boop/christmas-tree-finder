"""Meta/WRI 1 m global canopy height (Tolan et al. 2024; dataforgood-fb-data/forests/v1/alsgedi_global_v6_float), EPSG:3857 ~1.19 m, uint8 metres.
Clip to the AOI, resample to the lidar 1 m UTM grid (nearest), compare, and compute the same small-tree density."""
import tifffile, zarr, numpy as np, json, pyproj
from scipy import ndimage as ndi
T=tifffile.imread('meta_chm_023103221.tif',aszarr=True);Z=zarr.open(T,mode='r');ps=1.1943285669558747;ox,oy=-11818999.061567092,3913575.8482010234
M=json.load(open('chm_meta.json'));x0,y0,x1,y1=M['aoi'];H=W=5000
t=pyproj.Transformer.from_crs(26913,3857,always_xy=True)
xs,ys=t.transform([x0,x1,x0,x1],[y0,y0,y1,y1]);c0=int((min(xs)-ox)/ps)-5;c1=int((max(xs)-ox)/ps)+5;r0=int((oy-max(ys))/ps)-5;r1=int((oy-min(ys))/ps)+5
win=np.asarray(Z[r0:r1,c0:c1]).astype(np.float32);print('meta window',win.shape,'max',win.max())
gx,gy=np.meshgrid(x0+np.arange(W)+.5,y1-np.arange(H)-.5);mx,my=t.transform(gx,gy)
ci=((mx-ox)/ps).astype(int)-c0;ri=((oy-my)/ps).astype(int)-r0;meta=win[ri,ci];np.save('meta_chm_1m.npy',meta)
chm=np.load('chm_1m.npy')
def agg(a,f=30):return a[:H//f*f,:W//f*f].reshape(H//f,f,W//f,f).mean((1,3))
A,B=agg(chm),agg(meta);print('30m mean height: lidar %.2f m, meta %.2f m, r=%.3f, MAE %.2f m'%(A.mean(),B.mean(),np.corrcoef(A.ravel(),B.ravel())[0,1],np.abs(A-B).mean()))
for th in (2,5):print('canopy cover >%dm: lidar %.1f%%, meta %.1f%%, pixel agreement %.1f%%'%(th,(chm>th).mean()*100,(meta>th).mean()*100,((chm>th)==(meta>th)).mean()*100))
sm=(chm>=0.9)&(chm<=2.7);smm=(meta>=1)&(meta<=3);print('1m pixels 0.9-2.7m: lidar %.2f%%, meta(1-3m) %.2f%%'%(sm.mean()*100,smm.mean()*100))
# small-tree density from Meta with the same detector (heights are integer metres -> coarser)
s=ndi.gaussian_filter(meta,0.7);peak=(s==ndi.maximum_filter(s,3))&(s>=0.9)&(s<=6)
tall=(meta>5).astype(np.float32);yy,xx=np.mgrid[-6:7,-6:7];k=((xx**2+yy**2)<=36).astype(np.float32);k/=k.sum();cov=ndi.convolve(tall,k,mode='nearest')
h=s[peak];wt=np.where((h>=0.9)&(h<2.1),1.0,np.where((h>=2.1)&(h<=2.7),.5,0))*(1-cov[peak]);r,c=np.nonzero(peak)
print('meta small peaks weighted',wt.sum().round(0))
D=np.zeros((H//30,W//30));np.add.at(D,(np.minimum(r//30,H//30-1),np.minimum(c//30,W//30-1)),wt)
tr=np.load('trees.npy');L=np.zeros_like(D)
X,Y=pyproj.Transformer.from_crs(4326,26913,always_xy=True).transform(tr[:,0],tr[:,1]);np.add.at(L,(np.minimum(((y1-Y)//30).astype(int),H//30-1),np.minimum(((X-x0)//30).astype(int),W//30-1)),tr[:,3])
print('30m small-tree density corr lidar vs meta r=%.3f; spearman-ish r=%.3f'%(np.corrcoef(L.ravel(),D.ravel())[0,1],np.corrcoef(np.argsort(np.argsort(L.ravel())),np.argsort(np.argsort(D.ravel())))[0,1]))
np.save('meta_density_30m_aoi.npy',D);np.save('lidar_density_30m_aoi.npy',L)
