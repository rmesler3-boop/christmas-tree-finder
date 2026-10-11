"""Bin all tile tree tops into the Sacramento 30 m heat grid -> ../lidar_density_ha.npy + ../lidar_cover.npy (cover = cell centre inside a processed tile)."""
import json, glob, os, numpy as np, math
T={t['key']:t for t in json.load(open('../district_tiles.json'))}
hm=json.load(open('/workspace/christmas-tree-app/data/heat/sacramento/meta.json'));BW,BS,BE,BN=hm['bbox'];gw,gh=hm['w'],hm['h']
dens=np.zeros((gh,gw),np.float64);cover=np.zeros((gh,gw),bool);n=0
cx=BW+(np.arange(gw)+.5)/gw*(BE-BW);cy=BN-(np.arange(gh)+.5)/gh*(BN-BS)
for f in glob.glob('trees/*.npy'):
    k=os.path.basename(f)[:-4];a=np.load(f);n+=len(a)
    if len(a):gx=((a[:,0]-BW)/(BE-BW)*gw).astype(int);gy=((BN-a[:,1])/(BN-BS)*gh).astype(int);ok=(gx>=0)&(gx<gw)&(gy>=0)&(gy<gh);np.add.at(dens,(gy[ok],gx[ok]),a[ok,3])
    x0,y0,x1,y1=T[k]['bb'];ix=np.nonzero((cx>x0)&(cx<x1))[0];iy=np.nonzero((cy>y0)&(cy<y1))[0]
    if len(ix) and len(iy):cover[iy[0]:iy[-1]+1,ix[0]:ix[-1]+1]=True
cell=(BE-BW)/gw*111320*math.cos(math.radians((BS+BN)/2))*(BN-BS)/gh*110540
np.save('../lidar_density_ha.npy',(dens/cell*1e4).astype(np.float32));np.save('../lidar_cover.npy',cover)
print('tiles',len(glob.glob('trees/*.npy')),'trees',n,'cover cells',cover.sum())
