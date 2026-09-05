import numpy as np, cv2, glob
files = sorted(glob.glob('headall/h_*.png'))
for i,f in enumerate(files):
    im = cv2.imread(f, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    t = i/10.0
    print(f"{i:3d} t={t:5.1f} mean={im.mean():6.1f} max={im.max():5.0f}")
