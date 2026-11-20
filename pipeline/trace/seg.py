import sys, json
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage as ndi
im=np.array(Image.open('lineup.webp').convert('RGB')).astype(float)
BG=np.array([253,246,237.]); INK=np.array([93,70,58.])
XS=[(58,358),(383,650),(668,985),(1008,1302),(1335,1618),(1648,1940)]
NAMES=['cat','bunny','hedgehog','bear','frog','duck']
def kmeans(X,k,it=20):
  rng=np.random.default_rng(1); C=X[rng.choice(len(X),k,replace=False)]
  for _ in range(it):
    L=((X[:,None]-C[None])**2).sum(2).argmin(1)
    for j in range(k):
      if (L==j).any(): C[j]=X[L==j].mean(0)
  return C
out={}
for (x0,x1),nm in zip(XS,NAMES):
  a=im[100:590,x0-6:x1+6]; H,W,_=a.shape
  lum=a.mean(2); dbg=np.abs(a-BG).sum(2)
  ink=(np.abs(a-INK).sum(2)<90)|(lum<105)
  bgm=dbg<18
  fillpx=~ink&~bgm
  X=a[fillpx]
  # palette: kmeans on strong (non-edge) pixels
  er=ndi.binary_erosion(fillpx,iterations=2); C=kmeans(a[er],9)
  # merge near-duplicate centres
  keep=[]
  for c in C:
    if all(np.abs(c-k).sum()>18 for k in keep): keep.append(c)
  C=np.array(keep)
  # label every non-bg pixel: ink or nearest palette colour (antialias edges by nearest)
  P=np.vstack([INK,C]); lab=((a[:,:,None,:]-P[None,None])**2).sum(3).argmin(2)
  lab[bgm]=-1
  out[nm]={'pal':P.round().astype(int).tolist(),'shape':[H,W],'x0':x0-6,'y0':100}
  np.save(f'lab_{nm}.npy',lab)
  # debug image
  vis=np.zeros((H,W,3),np.uint8)+255
  for i,c in enumerate(P): vis[lab==i]=c
  Image.fromarray(vis).save(f'q_{nm}.png')
json.dump(out,open('pal.json','w'))
print(json.dumps({k:v['pal'] for k,v in out.items()}))
