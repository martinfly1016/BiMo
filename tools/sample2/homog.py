import numpy as np, cv2
# oblique final mask (from arrival.py) and still mask
obl = cv2.imread('final_mask_oblique.png',0)>0
obl[:170,:]=False  # drop wood strip
st_im = cv2.imread('tailall/t_110.png')[:, :, ::-1].astype(np.int32)
r,g,b = st_im[...,0],st_im[...,1],st_im[...,2]; gray=(0.299*r+0.587*g+0.114*b)
st = (gray<110)&((r-g)<30); st[:100,:]=False; st[545:,:]=False; st[:, :120]=False; st[:, 400:]=False
st = cv2.morphologyEx(st.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2,2),np.uint8))>0
def comps(mask, minpx=30):
    n,lab,stats,cent = cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
    out=[]
    for i in range(1,n):
        if stats[i,cv2.CC_STAT_AREA]>=minpx: out.append((stats[i,cv2.CC_STAT_AREA], stats[i,cv2.CC_STAT_LEFT],stats[i,cv2.CC_STAT_TOP],stats[i,cv2.CC_STAT_WIDTH],stats[i,cv2.CC_STAT_HEIGHT]))
    return sorted(out, reverse=True)
print("oblique comps (area,x,y,w,h):", comps(obl)[:8])
print("still comps:", comps(st)[:8])
# ICP-like homography fit from mask contours: use extreme points as seeds
def extremes(m):
    ys,xs=np.where(m)
    pts = {}
    pts['top']   = (xs[ys.argmin()], ys.min())
    pts['bottom']= (xs[ys.argmax()], ys.max())
    pts['left']  = (xs.min(), ys[xs.argmin()])
    pts['right'] = (xs.max(), ys[xs.argmax()])
    return pts
eo, es = extremes(obl), extremes(st)
print("oblique extremes", eo); print("still extremes", es)
# split into xiao (upper) and han (lower) by y gap for extra points
def split(m):
    ys = np.where(m.any(1))[0]; gaps = np.where(np.diff(ys)>15)[0]
    cut = ys[gaps[0]]+1 if len(gaps) else None
    a=m.copy(); a[cut:]=False; b=m.copy(); b[:cut]=False; return a,b,cut
xo,ho,co = split(obl); xs_,hs_,cs_ = split(st); print("cuts", co, cs_)
exo,exs = extremes(xo),extremes(xs_); eho,ehs = extremes(ho),extremes(hs_)
src = np.float32([exo['top'],exo['left'],exo['right'],exo['bottom'],eho['left'],eho['right'],eho['bottom'],eho['top']])
dst = np.float32([exs['top'],exs['left'],exs['right'],exs['bottom'],ehs['left'],ehs['right'],ehs['bottom'],ehs['top']])
Hm, inl = cv2.findHomography(src,dst,0)
print("H=\n", np.round(Hm,4))
warp = cv2.warpPerspective(obl.astype(np.uint8)*255, Hm, (480,854))>127
inter = (warp&st).sum(); union=(warp|st).sum(); print("IoU seed", inter/union, "warp px", warp.sum(), "still px", st.sum())
# refine with ECC on distance-transform images
def dtimg(m):
    d = cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2,5); return np.exp(-d/6).astype(np.float32)
try:
    crit=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    cc,Hr = cv2.findTransformECC(dtimg(st), dtimg(obl), Hm.astype(np.float32), cv2.MOTION_HOMOGRAPHY, crit, None, 5)
    warp2 = cv2.warpPerspective(obl.astype(np.uint8)*255, Hr, (480,854))>127
    print("ECC cc", cc, "IoU refined", (warp2&st).sum()/(warp2|st).sum())
    Hm = Hr
    warp = warp2
except Exception as e:
    print("ECC failed", e)
np.save('H_obl_to_still.npy', Hm)
vis = np.zeros((854,480,3),np.uint8)+255
vis[st] = (0,0,255); vis[warp] = (0,160,0); vis[st&warp]=(0,0,0)
cv2.imwrite('overlay_obl_vs_still.png', vis)
# also warp the actual 38.5s frame
fr = cv2.imread('dense/d_077.png'); cv2.imwrite('obl385_warped_to_still.png', cv2.warpPerspective(fr, Hm, (480,854)))
