import numpy as np, cv2, glob, os
files = sorted(glob.glob('dense/d_*.png'))
ref = cv2.imread(files[0], cv2.IMREAD_GRAYSCALE).astype(np.float32)
# region: left strip of paper away from hand/ink: x 0..70, y 150..760 ; and top wooden strip x 0..200, y 45..120
def shift(a,b):
    a = a - a.mean(); b = b - b.mean()
    win = cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F)
    (dx,dy),resp = cv2.phaseCorrelate(a*win, b*win)
    return dx,dy,resp
for f in files[::2]:
    im = cv2.imread(f, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    idx = int(os.path.basename(f)[2:5]); t=idx*0.5
    dx1,dy1,r1 = shift(ref[150:760,0:70], im[150:760,0:70])
    dx2,dy2,r2 = shift(ref[45:125,0:220], im[45:125,0:220])
    print(f"t={t:5.1f} leftstrip dx={dx1:6.2f} dy={dy1:6.2f} r={r1:.2f} | wood dx={dx2:6.2f} dy={dy2:6.2f} r={r2:.2f}")
