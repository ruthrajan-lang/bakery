import json
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage as ndi
pal=json.load(open('pal.json')); NAMES=list(pal); sheets=[]; out={}
for nm in NAMES:
  lab=np.load(f'lab_{nm}.npy'); H,W=lab.shape
  ink=lab==0; bg=lab==-1
  # close tiny gaps in the ink so cells separate cleanly
  inkc=ndi.binary_closing(ink,iterations=1)
  cl,n=ndi.label(~inkc&~bg)
  cells=[]
  for k in range(1,n+1):
    m=cl==k; a=int(m.sum())
    if a<120: continue
    ys,xs=np.nonzero(m); cells.append({'id':k,'area':a,'box':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]})
  np.save(f'cells_{nm}.npy',cl); out[nm]=cells
  P=pal[nm]['pal']; vis=np.zeros((H,W,3),np.uint8)+255
  rng=np.random.default_rng(3)
  for c in cells: vis[cl==c['id']]=rng.integers(80,255,3)
  vis[ink]=(60,40,30)
  img=Image.fromarray(vis).resize((W*2,H*2),Image.NEAREST); d=ImageDraw.Draw(img)
  for c in cells: x0,y0,x1,y1=c['box']; d.text((x0+x1,y0+y1),str(c['id']),fill=(0,0,0))
  sheets.append(img)
json.dump(out,open('cells.json','w'))
w=sum(i.width for i in sheets); o=Image.new('RGB',(w,sheets[0].height),'white'); x=0
for i in sheets: o.paste(i,(x,0)); x+=i.width
o.resize((w//2,o.height//2)).save('cells.png')
for nm in NAMES: print(nm,[(c['id'],c['area']) for c in out[nm]])
