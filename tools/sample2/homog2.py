import numpy as np, cv2
obl = cv2.imread('final_mask_oblique.png',0)>0
obl[:170,:]=False; obl[:,440:]=False
st_im = cv2.imread('tailall/t_110.png')[:, :, ::-1].astype(np.int32)
r,g,b = st_im[...,0],st_im[...,1],st_im[...,2]; gray=(0.299*r+0.587*g+0.114*b)
st = (gray<110)&((r-g)<30); st[:100,:]=False; st[545:,:]=False; st[:, :120]=False; st[:, 400:]=False
st = cv2.morphologyEx(st.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2,2),np.uint8))>0
def comps(mask, minpx=300):
    n,lab,stats,cent = cv2.connectedComponentsWithStats(mask.astype(np.uint8),8)
    out=[(stats[i,cv2.CC_STAT_AREA], tuple(cent[i])) for i in range(1,n) if stats[i,cv2.CC_STAT_AREA]>=minpx]
    return sorted(out, reverse=True)
co, cs = comps(obl), comps(st)
print("obl", co); print("still", cs)
k = min(len(co),len(cs))
src = np.float32([c[1] for c in co[:k]]); dst = np.float32([c[1] for c in cs[:k]])
H,_ = cv2.findHomography(src,dst,0)
def iou(H):
    w = cv2.warpPerspective(obl.astype(np.uint8)*255, H, (480,854))>127
    return (w&st).sum()/(w|st).sum(), w
print("centroid-seed IoU", iou(H)[0])
# contour ICP refinement
def contour_pts(m):
    cs_,_ = cv2.findContours(m.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    return np.concatenate([c.reshape(-1,2) for c in cs_]).astype(np.float32)
P = contour_pts(obl); Q = contour_pts(st)
from scipy.spatial import cKDTree
tree = cKDTree(Q)
for it in range(40):
    Pw = cv2.perspectiveTransform(P.reshape(-1,1,2), H).reshape(-1,2)
    d, idx = tree.query(Pw)
    keep = d < np.percentile(d, 80)
    Hn,_ = cv2.findHomography(P[keep], Q[idx[keep]], cv2.RANSAC, 3.0)
    if Hn is None: break
    H = Hn
    if it%10==9: print("iter", it, "median d", np.median(d).round(2), "IoU", round(iou(H)[0],3))
val, w = iou(H)
print("final IoU", round(val,3))
np.save('H_obl_to_still.npy', H); print("H=\n", np.round(H,4))
vis = np.zeros((854,480,3),np.uint8)+255
vis[st] = (0,0,255); vis[w] = (0,160,0); vis[st&w]=(0,0,0)
cv2.imwrite('overlay_obl_vs_still.png', vis)
fr = cv2.imread('dense/d_077.png'); cv2.imwrite('obl385_warped_to_still.png', cv2.warpPerspective(fr, H, (480,854)))
# how anisotropic is the oblique view? scale along x vs y at the character centre
c = np.float32([[[250,560]]]); 
for dv,name in (([1,0],'x'),([0,1],'y')):
    p2 = cv2.perspectiveTransform(np.float32([[[250+dv[0]*10,560+dv[1]*10]]]), H); p1 = cv2.perspectiveTransform(c,H)
    print("oblique 10px along", name, "-> still", np.round(np.linalg.norm(p2-p1),2), "px")
