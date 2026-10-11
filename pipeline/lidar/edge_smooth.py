"""Light seam fix: cells within 30 m of a 1.5 km lidar tile edge get a 3x3 mean, then are scaled down by the measured 7% edge excess."""
import numpy as np,json,pyproj
from scipy import ndimage as ndi
N='/workspace/christmas-tree-app/data/heat/sacramento/';hm=json.load(open(N+'meta.json'));BW,BS,BE,BN=hm['bbox'];gw,gh=hm['w'],hm['h']
d=np.load('/workspace/lidar/full/lidar_density_ha_raw.npy');c=np.load('/workspace/lidar/lidar_cover.npy')
cx=BW+(np.arange(gw)+.5)/gw*(BE-BW);cy=BN-(np.arange(gh)+.5)/gh*(BN-BS);X,Y=np.meshgrid(cx,cy);ux,uy=pyproj.Transformer.from_crs(4326,26913,always_xy=True).transform(X,Y)
ex=np.minimum(np.mod(ux-499,1500),1500-np.mod(ux-499,1500));ey=np.minimum(np.mod(uy,1500),1500-np.mod(uy,1500));edge=(np.minimum(ex,ey)<30)&c;inner=(np.minimum(ex,ey)>=60)&c
s=ndi.uniform_filter(d,3);ratio=d[edge].mean()/d[inner].mean();out=np.where(edge,s/max(ratio,1),d)
print('edge/interior before %.3f after %.3f'%(ratio,out[edge].mean()/out[inner].mean()))
np.save('/workspace/lidar/lidar_density_ha.npy',out.astype(np.float32))
