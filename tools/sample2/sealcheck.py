import numpy as np, cv2
im = cv2.imread('tailall/t_110.png')[:, :, ::-1].astype(np.int32)
r,g,b = im[...,0],im[...,1],im[...,2]; gray=(0.299*r+0.587*g+0.114*b)
roi = (slice(545,660), slice(190,320))
for rule,name in (((gray<110),'gray<110'), ((gray<110)&((r-g)<30),'gray<110 & r-g<30'), ((gray<110)&((r-g)<20)&((r-b)<25),'gray<110 & r-g<20 & r-b<25'), ((gray<90),'gray<90'), ((np.maximum(r,np.maximum(g,b))<100),'max(rgb)<100')):
    m = rule
    print(f"{name:32s} seal-ROI px {m[roi].sum():5d} | 寒 ROI px {m[290:540,120:380].sum():6d} | 小 ROI px {m[120:280,140:320].sum():5d}")
# seal red pixel RGB stats vs ink pixel stats
seal = im[roi].reshape(-1,3); red = seal[(seal[:,0]-seal[:,1])>40]
print("seal red mean", red.mean(0).round(1), "min gray", (0.299*red[:,0]+0.587*red[:,1]+0.114*red[:,2]).min().round(1))
ink = im[290:540,120:380].reshape(-1,3); ink = ink[(0.299*ink[:,0]+0.587*ink[:,1]+0.114*ink[:,2])<60]
print("ink core mean", ink.mean(0).round(1), "r-g mean", (ink[:,0]-ink[:,1]).mean().round(1), "b-r mean", (ink[:,2]-ink[:,0]).mean().round(1))
# oblique video ink colour (38.5 s frame) and pen body / hand shadow colours
fr = cv2.imread('dense/d_077.png')[:, :, ::-1].astype(np.int32)
fg = (0.299*fr[...,0]+0.587*fr[...,1]+0.114*fr[...,2])
inkv = fr[470:720,150:420][fg[470:720,150:420]<60]; print("oblique ink core mean RGB", inkv.mean(0).round(1))
fr2 = cv2.imread('dense/d_060.png')[:, :, ::-1].astype(np.int32)  # 30 s, pen + hand in frame
fg2 = (0.299*fr2[...,0]+0.587*fr2[...,1]+0.114*fr2[...,2])
print("30s frame: pen body sample RGB", fr2[330:380,330:360].reshape(-1,3).mean(0).round(1), "hand-shadow paper sample", fr2[600:700,300:400].reshape(-1,3).mean(0).round(1), "lit paper sample", fr2[300:400,20:80].reshape(-1,3).mean(0).round(1))
