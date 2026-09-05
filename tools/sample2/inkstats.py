import numpy as np, cv2
im = cv2.imread('tailall/t_110.png')[:, :, ::-1].astype(np.int32)  # RGB
H,W,_ = im.shape
# exclude black letterbox bars: find rows where mean>20
rowmean = im.mean(axis=(1,2)); rows = np.where(rowmean>20)[0]; print("content rows", rows.min(), rows.max())
r,g,b = im[...,0],im[...,1],im[...,2]
gray = (0.299*r+0.587*g+0.114*b)
content = np.zeros((H,W),bool); content[rows.min():rows.max()+1,:]=True
# paper sample: a region without ink (left margin)
paper = im[200:500, 20:100].reshape(-1,3); print("paper mean", paper.mean(0).round(1), "std", paper.std(0).round(1), "gray mean", gray[200:500,20:100].mean().round(1), "gray min", gray[200:500,20:100].min())
# seal region red stats
seal = im[560:640, 210:290].reshape(-1,3)
red = seal[(seal[:,0]-seal[:,1])>40]; print("seal red px", len(red), "mean", red.mean(0).round(1) if len(red) else None)
# ink candidate: gray < thresholds; report counts
for th in (60,80,100,120,140):
    m = (gray<th)&content
    print(f"gray<{th}: {m.sum()} px")
# darkest ink stats
ink = im[(gray<70)&content]; print("ink core mean RGB", ink.mean(0).round(1), "std", ink.std(0).round(1))
# check whether seal red pixels are dark in gray
sealgray = gray[560:640,210:290]; print("seal gray min/mean", sealgray.min().round(1), sealgray.mean().round(1))
# mask by gray<110 and not red: r-g<30
mask = (gray<110)&content&((r-g)<30)
cv2.imwrite('still_inkmask_g110.png', (mask*255).astype(np.uint8))
# stroke width via distance transform
dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
# skeleton approx: local maxima of dist
from scipy import ndimage
