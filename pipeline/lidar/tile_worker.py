"""Whole-district lidar: per LAZ tile download -> 1 m CHM -> small-tree tops -> trees/<key>.npy, then delete the LAZ.
Resumable: tiles with trees/<key>.npy are skipped. Same method as the Cloudcroft test box (pipeline/lidar/trees.py)."""
import json, os, sys, time, subprocess, numpy as np, laspy, pyproj, traceback
from scipy import ndimage as ndi
from concurrent.futures import ProcessPoolExecutor
TT=pyproj.Transformer.from_crs(26913,4326,always_xy=True)
def chm_tile(path):
    with laspy.open(path) as r:
        h=r.header;x0,y0=np.floor(h.mins[0]),np.floor(h.mins[1]);x1,y1=np.ceil(h.maxs[0]),np.ceil(h.maxs[1]);W,H=int(x1-x0),int(y1-y0)
        dtm=np.full(H*W,np.inf,np.float32);dsm=np.full(H*W,-np.inf,np.float32);n=0
        for ch in r.chunk_iterator(4_000_000):
            c=np.asarray(ch.classification);ok=(c!=7)&(c!=18)&(c!=6)&~np.asarray(ch.withheld,bool)
            x=np.asarray(ch.x)[ok];y=np.asarray(ch.y)[ok];z=np.asarray(ch.z,np.float32)[ok];c=c[ok];n+=len(x)
            col=np.minimum(((x-x0)).astype(np.int32),W-1);row=np.minimum(((y1-y)).astype(np.int32),H-1);idx=row*W+col
            np.maximum.at(dsm,idx,z);g=c==2;np.minimum.at(dtm,idx[g],z[g])
    dtm=dtm.reshape(H,W);dsm=dsm.reshape(H,W)
    if np.isinf(dtm).all():return None
    m=np.isinf(dtm);dtm=dtm[tuple(ndi.distance_transform_edt(m,return_distances=False,return_indices=True))];dtm=ndi.gaussian_filter(dtm,1)
    e=np.isinf(dsm);dsm=np.where(e,dsm[tuple(ndi.distance_transform_edt(e,return_distances=False,return_indices=True))],dsm)
    chm=ndi.median_filter(np.clip(dsm-dtm,0,60).astype(np.float32),3);return chm,x0,y1,n/(W*H),e.mean()
def trees(chm,x0,y1):
    s=ndi.gaussian_filter(chm,0.7);peak=(s==ndi.maximum_filter(s,size=3))&(s>=0.9)&(s<=6)
    yy,xx=np.mgrid[-6:7,-6:7];k=((xx**2+yy**2)<=36).astype(np.float32);k/=k.sum();cov=ndi.convolve((chm>5).astype(np.float32),k,mode='nearest')
    r,c=np.nonzero(peak);h=s[r,c];wt=np.where((h>=0.9)&(h<2.1),1.0,np.where((h>=2.1)&(h<=2.7),.5,0))*(1-cov[r,c]);sel=wt>0
    lon,lat=TT.transform(x0+c[sel]+.5,y1-r[sel]-.5);return np.c_[lon,lat,h[sel],wt[sel]].astype(np.float32)
def job(t):
    out=f"trees/{t['key']}.npy"
    if os.path.exists(out):return t['key'],'skip',0
    tmp=f"tmp/{t['key']}.laz";t0=time.time()
    try:
        for a in range(4):
            if subprocess.run(['curl','-sfL','--retry','3','-o',tmp,t['url']]).returncode==0 and os.path.getsize(tmp)>1000:break
            time.sleep(10*(a+1))
        else:raise RuntimeError('download failed')
        td=time.time()-t0;res=chm_tile(tmp)
        tr=np.zeros((0,4),np.float32) if res is None else trees(res[0],res[1],res[2])
        stats=dict(key=t['key'],n=len(tr),dens=None if res is None else round(float(res[3]),2),empty=None if res is None else round(float(res[4]),3),t_dl=round(td,1),t_all=round(time.time()-t0,1),mb=round(os.path.getsize(tmp)/1e6,1))
        np.save(out+'.tmp.npy',tr);os.replace(out+'.tmp.npy',out)
        with open('done.jsonl','a') as f:f.write(json.dumps(stats)+'\n')
        return t['key'],'ok',stats['t_all']
    except Exception as e:
        with open('failed.jsonl','a') as f:f.write(json.dumps(dict(key=t['key'],err=repr(e)))+'\n')
        return t['key'],'fail',0
    finally:
        if os.path.exists(tmp):os.remove(tmp)
if __name__=='__main__':
    T=json.load(open('../district_tiles.json'));N=int(sys.argv[1]) if len(sys.argv)>1 else 6;t0=time.time();k=0
    with ProcessPoolExecutor(N) as ex:
        for key,st,dt in ex.map(job,T):
            k+=1
            if k%10==0 or st=='fail':print(time.strftime('%H:%M:%S'),k,len(T),key,st,dt,'elapsed %.0fs'%(time.time()-t0),'free GB %.0f'%(os.statvfs('.').f_bavail*os.statvfs('.').f_frsize/1e9),flush=True)
    print('ALL DONE',time.time()-t0)
