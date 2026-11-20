import json
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy import ndimage as ndi
im=np.array(Image.open('lineup.webp').convert('RGB')).astype(float)
pal=json.load(open('pal.json')); NAMES=list(pal)
res={}
sheets=[]
for nm in NAMES:
  lab=np.load(f'lab_{nm}.npy'); P=pal[nm]['pal']
  # background = bg-labelled pixels connected to the border; enclosed bg-coloured pixels are a white fill
  bgl,n=ndi.label(lab==-1); border=set(np.unique(np.r_[bgl[0],bgl[-1],bgl[:,0],bgl[:,-1]]))-{0}
  outside=np.isin(bgl,list(border)); inside=(lab==-1)&~outside
  if inside.sum()>500: P=P+[[255,251,246]]; lab[inside]=len(P)-1
  else: lab[inside]=0
  lab[outside]=-1
  pal[nm]['pal']=P; np.save(f'lab_{nm}.npy',lab)
  comps=[]; L=np.zeros(lab.shape,int); cid=0
  for ci in range(1,len(P)):
    l,n=ndi.label(lab==ci)
    for k in range(1,n+1):
      m=l==k; a=m.sum()
      if a<25: continue
      cid+=1; L[m]=cid; ys,xs=np.nonzero(m)
      comps.append({'id':cid,'col':ci,'area':int(a),'box':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]})
  # ink features: ink components not connected to the big outline network
  l,n=ndi.label(lab==0); sizes=ndi.sum(lab==0,l,range(1,n+1)); big=np.argmax(sizes)+1
  for k in range(1,n+1):
    if k==big or sizes[k-1]<15: continue
    m=l==k; cid+=1; L[m]=cid; ys,xs=np.nonzero(m)
    comps.append({'id':cid,'col':0,'area':int(m.sum()),'box':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())]})
  np.save(f'comp_{nm}.npy',L); res[nm]=comps
  # debug sheet with ids
  H,W=lab.shape; vis=np.zeros((H,W,3),np.uint8)+255
  for i,c in enumerate(P): vis[lab==i]=c
  img=Image.fromarray(vis).resize((W*2,H*2),Image.NEAREST); d=ImageDraw.Draw(img)
  for c in comps:
    x0,y0,x1,y1=c['box']; d.text(((x0+x1),(y0+y1)-6),str(c['id']),fill=(0,0,255) if c['col'] else (255,0,0))
  sheets.append(img)
json.dump(pal,open('pal.json','w')); json.dump(res,open('comps.json','w'))
w=sum(i.width for i in sheets); o=Image.new('RGB',(w,sheets[0].height),'white'); x=0
for i in sheets: o.paste(i,(x,0)); x+=i.width
o.crop((0,0,w//2,o.height)).save('ids1.png'); o.crop((w//2,0,w,o.height)).save('ids2.png')
for nm in NAMES: print(nm, [(c['id'],c['col'],c['area']) for c in res[nm]])
