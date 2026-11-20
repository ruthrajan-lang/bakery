import json
import numpy as np
from scipy import ndimage as ndi
import potrace
pal=json.load(open('pal.json')); cellsj=json.load(open('cells.json')); NAMES=list(pal)
SC=2.2   # px -> art units (characters end up ~1000 tall)
def hexc(c): return '#%02x%02x%02x'%tuple(int(v) for v in c)
def trace(mask, ox, oy, smooth=1.0):
  if mask.sum()<8: return ''
  # supersample for smoother curves
  m=ndi.gaussian_filter(ndi.zoom(mask.astype(float),2,order=1),1.6)>.5   # smooth before tracing
  bm=potrace.Bitmap(~m)
  pl=bm.trace(turdsize=6,alphamax=smooth,opticurve=True,opttolerance=.4)
  f=lambda p:f'{(p.x/2-ox)*SC:.1f} {(p.y/2-oy)*SC:.1f}'
  s=[]
  for c in pl:
    s.append('M'+f(c.start_point))
    for seg in c.segments:
      if seg.is_corner: s.append('L'+f(seg.c)+'L'+f(seg.end_point))
      else: s.append('C'+f(seg.c1)+' '+f(seg.c2)+' '+f(seg.end_point))
    s.append('Z')
  return ''.join(s)
art={}
for nm in NAMES:
  lab=np.load(f'lab_{nm}.npy'); cl=np.load(f'cells_{nm}.npy'); P=pal[nm]['pal']; H,W=lab.shape
  ink=lab==0
  dist=ndi.distance_transform_edt(ink); lw=float(np.percentile(dist[dist>0],92))*2
  cells=sorted(cellsj[nm],key=lambda c:-c['area'])
  allc=np.isin(cl,[c['id'] for c in cells])|ink; ys,xs=np.nonzero(allc&(lab!=-1))
  feetY=ys.max(); cx=(xs.min()+xs.max())/2
  # name the cells
  def ctr(c): x0,y0,x1,y1=c['box']; return ((x0+x1)/2,(y0+y1)/2)
  named={}
  big=[c for c in cells if c['area']>10000]; small=[c for c in cells if c['area']<=10000]
  big.sort(key=lambda c:c['box'][1])   # topmost first
  if nm=='hedgehog':
    mane=max(big,key=lambda c:c['box'][3]-c['box'][1]); rest=[c for c in big if c is not mane]; rest.sort(key=lambda c:c['box'][1])
    named['mane']=mane; named['head']=rest[0]; named['body']=rest[1]
  else: named['head']=big[0]; named['body']=big[1]
  bodyBox=named['body']['box']
  for c in small:
    x,y=ctr(c)
    if y>bodyBox[3]-60 and c['area']<1400: named['footL' if x<cx else 'footR']=c
    elif nm=='cat' and c['area']>1500: named['tail']=c
    elif nm=='duck' and y<named['head']['box'][1]+20: named['tuft']=c
    else: named['armL' if x<cx else 'armR']=c
  parts=[]
  for pname,c in named.items():
    m=cl==c['id']; filled=ndi.binary_fill_holes(m)
    shape=filled.copy()
    ys2,xs2=np.nonzero(m); bx0,by0,bx1,by1=xs2.min(),ys2.min(),xs2.max(),ys2.max()
    if pname in ('armL','armR'):   # complete the hidden part behind the body
      s=1 if pname=='armL' else -1; sh=np.roll(filled,int(s*(bx1-bx0)*.55),axis=1)
      pts=np.argwhere(filled|sh)
      from skimage.morphology import convex_hull_image
      shape=convex_hull_image(filled|sh)
    if pname=='body':   # extend up under the head
      from skimage.morphology import convex_hull_image
      up=np.roll(filled,-int((by1-by0)*.12),axis=0); shape=filled|(up&(np.arange(H)[:,None]<by0+(by1-by0)*.3))
    sil=ndi.distance_transform_edt(~shape)<=lw*1.08   # even outline all round
    base=ndi.distance_transform_edt(~shape)<=1.2
    edge=m&~ndi.binary_erosion(filled,iterations=7); labs=lab[edge&(lab>0)]; bc=np.bincount(labs).argmax()   # the colour along the edge is the part's own colour
    det=[]
    for ci in range(1,len(P)):
      if ci==bc: continue
      inner=ndi.binary_erosion(filled,iterations=1 if pname=='tail' else 3)
      dm=ndi.binary_opening((lab==ci)&inner,iterations=1)
      l,n=ndi.label(dm)
      keep=np.zeros_like(dm)
      for k in range(1,n+1):
        if (l==k).sum()>=70: keep|=l==k
      if keep.sum(): det.append([hexc(P[ci]),trace(ndi.binary_dilation(keep,iterations=3)&filled,cx,feetY)])
    # ink features inside this part (eyes, mouth, nose)
    feat=ink&filled&~ndi.binary_dilation(~filled,iterations=2)
    l,n=ndi.label(feat); fm=np.zeros_like(feat); blobs=[]
    for k in range(1,n+1):
      a=(l==k).sum()
      if a>=15:
        fm|=l==k; yy,xx=np.nonzero(l==k); w=xx.max()-xx.min()+1; h=yy.max()-yy.min()+1
        if 120<a and .7<w/h<1.4 and a>.6*w*h: blobs.append(((xx.mean()-cx)*SC,(yy.mean()-feetY)*SC,max(w,h)/2*SC,a))
    blobs.sort(key=lambda b:-b[3]); eyes=sorted(blobs[:2],key=lambda b:b[0]) if len(blobs)>=2 else []
    mouth=None
    if pname=='head' and len(eyes)==2:
      ey=np.mean([e[1] for e in eyes])/SC+feetY; ex=(eyes[0][0]+eyes[1][0])/2/SC+cx; best=None
      for k in range(1,n+1):
        yy,xx=np.nonzero(l==k)
        if len(yy)<15: continue
        my,mx=yy.mean(),xx.mean(); w=xx.max()-xx.min()+1; h=yy.max()-yy.min()+1
        if my>ey+4 and abs(mx-ex)<40 and w>h*1.3:
          if best is None or my>best[0]: best=(my,xx.min(),yy.min(),xx.max(),yy.max())
      if best:
        _,x0,y0,x1,y1=best; ring=lab[max(0,y0-3):y1+4,max(0,x0-3):x1+4]; vals=ring[ring>0]
        col=P[np.bincount(vals).argmax()] if len(vals) else P[bc]
        mouth=[round((x0-cx)*SC,1),round((y0-feetY)*SC,1),round((x1-cx)*SC,1),round((y1-feetY)*SC,1),hexc(col)]
    eyes=[[round(b[0],1),round(b[1],1),round(b[2],1)] for b in eyes if nm!='hedgehog' or True]
    # pivots (art units)
    U=lambda x,y:[round((x-cx)*SC,1),round((y-feetY)*SC,1)]
    if pname=='head': piv=U((bx0+bx1)/2,by1)
    elif pname=='body' or pname=='mane': piv=U(cx,feetY)
    elif pname.startswith('arm'): piv=U(bx1-(bx1-bx0)*.25 if pname=='armL' else bx0+(bx1-bx0)*.25,by0+(by1-by0)*.2)
    elif pname.startswith('foot'): piv=U((bx0+bx1)/2,(by0+by1)/2)
    elif pname=='tail': piv=U(bx0,by1-(by1-by0)*.15)
    elif pname=='tuft': piv=U((bx0+bx1)/2,by1)
    parts.append({'n':pname,'piv':piv,'o':trace(sil,cx,feetY),'f':trace(base,cx,feetY),'fc':hexc(P[bc]),'d':det,'k':trace(fm,cx,feetY,.8) if fm.sum() else '','eyes':eyes if pname=='head' else [],'mouth':mouth if pname=='head' else None,'cap':[round((bx1-bx0)*SC,1),round((by1-by0)*SC,1)] if pname.startswith('arm') else None})
  top=min(np.nonzero(allc)[0])
  art[nm]={'h':round((feetY-top)*SC),'lw':round(lw*SC,1),'parts':parts}
  print(nm,'lw',round(lw,1),[p['n'] for p in parts],'h',art[nm]['h'])
open('../../site/bakery/critters/critter-art.js','w').write('// traced from the character lineup (focus-bakery/art-src/critter-lineup.webp) by the trace pipeline: vector paths, drawn in code\nwindow.CRITTER_ART = '+json.dumps(art,separators=(',',':'))+';\n')
import os; print(os.path.getsize('../../site/bakery/critters/critter-art.js'))
