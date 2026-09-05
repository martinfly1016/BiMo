import numpy as np, cv2, glob, os
# camera stability: track wooden edge at top-left in each dense frame, column x=30, find strongest vertical gradient in y in [30,130]
files = sorted(glob.glob('dense/d_*.png'))
for f in files[::4]:
    im = cv2.imread(f, cv2.IMREAD_GRAYSCALE).astype(np.float32)
    idx = int(os.path.basename(f)[2:5]); t=idx*0.5
    col = im[20:160, 10:60].mean(axis=1)
    gy = np.diff(col)
    edge = 20+int(np.argmax(gy))
    # also left-margin paper brightness
    print(f"t={t:5.1f} woodedge_y={edge:4d} paperL_mean={im[300:600,0:60].mean():6.1f} frame_mean={im.mean():6.1f}")
