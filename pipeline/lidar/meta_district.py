"""Meta small-tree density (same detector as lidar) for the part of Sacramento RD inside Meta tile 023103221, binned to the 30 m heat grid."""
import tifffile, zarr, numpy as np, json, math
from scipy import ndimage as ndi
T=tifffile.imread('meta_chm_023103221.tif',aszarr=True);Z=zarr.open(T,mode='r');ps=1.1943285669558747;ox,oy=-11818999.061567092,3913575.8482010234;N=65536
hm=json.load(open('/workspace/christmas-tree-app/data/heat/sacramento/meta.json'));BW,BS,BE,BN=hm['bbox'];gw,gh=hm['w'],hm['h']
R=6378137.0;mx=lambda lon:math.radians(lon)*R;my=lambda lat:R*math.log(math.tan(math.pi/4+math.radians(lat)/2))
c0=max(0,int((mx(BW)-ox)/ps));c1=min(N,int((mx(BE)-ox)/ps)+1);r0=max(0,int((oy-my(BN))/ps));r1=min(N,int((oy-my(BS))/ps)+1);print('cols',c0,c1,'rows',r0,r1)
dens=np.zeros((gh,gw),np.float64);seen=np.zeros((gh,gw),np.int32)
lon=np.degrees((ox+(np.arange(c0,c1)+.5)*ps)/R);gx=((lon-BW)/(BE-BW)*gw).astype(int);okx=(gx>=0)&(gx<gw)
yy,xx=np.mgrid[-6:7,-6:7];k=((xx**2+yy**2)<=36).astype(np.float32);k/=k.sum();S=2000;P=8
for a in range(r0,r1,S):
    lo=max(r0,a-P);hi=min(r1,a+S+P);m=np.asarray(Z[lo:hi,c0:c1]).astype(np.float32);m[m==255]=0
    s=ndi.gaussian_filter(m,0.7);peak=(s==ndi.maximum_filter(s,3))&(s>=0.9)&(s<=6);cov=ndi.convolve((m>5).astype(np.float32),k,mode='nearest')
    rows=np.arange(lo,hi);lat=np.degrees(2*np.arctan(np.exp((oy-(rows+.5)*ps)/R))-np.pi/2);gy=((BN-lat)/(BN-BS)*gh).astype(int)
    core=(rows>=a)&(rows<min(r1,a+S));r,c=np.nonzero(peak&core[:,None]);h=s[r,c];wt=np.where((h>=0.9)&(h<2.1),1.0,np.where((h>=2.1)&(h<=2.7),.5,0))*(1-cov[r,c])
    Gy=gy[r];Gx=gx[c];ok=(Gy>=0)&(Gy<gh)&okx[c]&(wt>0);np.add.at(dens,(Gy[ok],Gx[ok]),wt[ok])
    cr=np.nonzero(core)[0];RR=np.repeat(gy[cr],okx.sum());CC=np.tile(gx[okx],len(cr));ok2=(RR>=0)&(RR<gh);np.add.at(seen,(RR[ok2],CC[ok2]),1)
    print(a,flush=True)
cell_area=(BE-BW)/gw*111320*math.cos(math.radians((BS+BN)/2))*(BN-BS)/gh*110540
cover=seen>cell_area/ps/ps*0.8;np.save('meta_density_ha.npy',(dens/cell_area*1e4).astype(np.float32));np.save('meta_cover.npy',cover);print('meta cover cells',cover.sum(),'of',gw*gh)
