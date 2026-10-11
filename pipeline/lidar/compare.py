import numpy as np, json, pyproj
from PIL import Image, ImageDraw
M=json.load(open('chm_meta.json'));x0,y0,x1,y1=M['aoi'];NEW='/workspace/christmas-tree-app/data/heat/sacramento/'
hm=json.load(open(NEW+'meta.json'));BW,BS,BE,BN=hm['bbox'];gw,gh=hm['w'],hm['h']
def lab(im,t):d=ImageDraw.Draw(im);d.rectangle([0,0,im.width,22],fill=(255,255,255));d.text((6,5),t,fill=(0,0,0));return im
def heat(path,land):
    s=np.array(Image.open(path)).astype(float)/255;l=np.array(Image.open(land))>0
    v=s[l&(s>=31/255)];q=np.quantile(v,[.2,.4,.6,.8]);C=np.array([[44,123,182],[0,166,150],[166,217,106],[253,174,97],[197,27,125]])
    rgb=C[np.digitize(s,q)].astype(np.uint8);rgb[~l|(s<31/255)]=[235,235,235];return rgb
b=heat('before_sac/s_fir.png','before_sac/land.png');a=heat(NEW+'s_fir.png',NEW+'land.png')
ti=pyproj.Transformer.from_crs(26913,4326,always_xy=True);W0,S0=ti.transform(x0,y0);E0,N0=ti.transform(x1,y1)
cx0,cx1=int((W0-BW)/(BE-BW)*gw),int((E0-BW)/(BE-BW)*gw);cy0,cy1=int((BN-N0)/(BN-BS)*gh),int((BN-S0)/(BN-BS)*gh)
crop=lambda r:Image.fromarray(r[cy0:cy1,cx0:cx1]).resize((600,600),Image.NEAREST)
f=np.array(Image.open(NEW+'g_f_small.png'));ff=f.astype(float);fr=np.stack([255-ff*.85,255-ff*.5,255-ff*.8],-1).astype(np.uint8)
P=Image.new('RGB',(1860,640),'white');P.paste(lab(crop(b),'BEFORE (fir): LANDFIRE EVH height factor'),(0,30));P.paste(lab(crop(fr),'Lidar small-tree density factor (rank)'),(630,30));P.paste(lab(crop(a),'AFTER: + lidar small-tree density (w=0.35)'),(1260,30))
ImageDraw.Draw(P).text((6,8),'Cloudcroft lidar test area 5x5 km - fir levels are district quintiles (blue Low ... magenta Best); gray = not scored / no-cut land',fill=(0,0,0));P.save('/workspace/treefinder-lidar-before-after-aoi.png')
sc=lambda r:Image.fromarray(r).resize((gw//3,gh//3),Image.NEAREST)
Q=Image.new('RGB',(2*(gw//3)+20,gh//3+30),'white');Q.paste(lab(sc(b),'BEFORE - Sacramento RD (fir)'),(0,30));Q.paste(lab(sc(a),'AFTER - lidar in test box (w=.35), Meta 1 m CHM west of -105.47 (w=.12)'),(gw//3+20,30));Q.save('/workspace/treefinder-lidar-before-after-district.png')
sb=np.array(Image.open('before_sac/s_fir.png')).astype(float);sa=np.array(Image.open(NEW+'s_fir.png')).astype(float);l=np.array(Image.open('before_sac/land.png'))>0
dl=np.load('lidar_density_ha.npy');lc=np.load('lidar_cover.npy');m=lc&l&(sb>30)
print('AOI cells',m.sum(),'corr score vs lidar density: before %.3f after %.3f; before-vs-after %.3f'%(np.corrcoef(sb[m],dl[m])[0,1],np.corrcoef(sa[m],dl[m])[0,1],np.corrcoef(sb[m],sa[m])[0,1]))
mc=np.load('meta_cover.npy')&~lc&l&(sb>30);print('Meta-area before-vs-after corr %.3f'%np.corrcoef(sb[mc],sa[mc])[0,1])
# level shares in AOI
qa=np.quantile(sa[l&(sa>30)],[.2,.4,.6,.8]);qb=np.quantile(sb[l&(sb>30)],[.2,.4,.6,.8])
print('AOI level shares before',np.bincount(np.digitize(sb[m],qb),minlength=5)/m.sum(),'after',np.bincount(np.digitize(sa[m],qa),minlength=5)/m.sum())
