import numpy as np, cv2
cap = cv2.VideoCapture("/Users/yuchao/Documents/vibe coding/bimo/sample2.mp4")
fps = cap.get(cv2.CAP_PROP_FPS); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); print("fps", fps, "frames", n)
frames = []
i = 0
while True:
    ok, fr = cap.read()
    if not ok: break
    t = i/fps
    if 4.0 <= t <= 38.6:
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        frames.append(g)
    i += 1
G = np.stack(frames)  # (T,H,W)
T,H,W = G.shape; print("stacked", G.shape)
# background-normalised darkness: paper local brightness via large blur of each frame's max-ish; simpler: fixed threshold since paper ~180-200, ink ~<60, hand shadow ~120-150
dark = G < 90
final = dark[-15:].mean(0) > 0.8   # persistently dark at 38.1-38.6s (no hand)
# also exclude regions outside paper: top bar/wood (y<130) and bottom bar (y>775)
final[:130,:] = False; final[775:,:] = False
print("final ink px", final.sum())
# arrival: first frame f such that dark in >=27 of frames f..f+29
win = 30
cs = np.cumsum(np.concatenate([np.zeros((1,H,W),np.int32), dark.astype(np.int32)],0), axis=0)
cnt = cs[win:] - cs[:-win]     # (T-win+1,H,W) count of dark in window starting at f
persist = cnt >= 27
arr = np.where(persist.any(0), persist.argmax(0), -1).astype(np.int32)
arr[~final] = -1
t_arr = np.where(arr>=0, 4.0 + arr/fps, np.nan)
np.save('arrival_t.npy', t_arr)
# ink increments per 0.5 s bin
bins = np.arange(4.0, 39.01, 0.5)
h,_ = np.histogram(t_arr[~np.isnan(t_arr)], bins=bins)
for b0,c in zip(bins[:-1],h):
    print(f"{b0:5.1f}-{b0+0.5:5.1f}s new ink px {c:5d} " + "#"*(c//20))
# colour map image
vis = np.zeros((H,W,3),np.uint8)+255
valid = ~np.isnan(t_arr)
norm = ((t_arr - 4.0)/(38.6-4.0)*255).clip(0,255)
cm = cv2.applyColorMap(norm.astype(np.uint8), cv2.COLORMAP_JET)
vis[valid] = cm[valid]
cv2.imwrite('arrival_map.png', vis)
# also save the 'final' mask
cv2.imwrite('final_mask_oblique.png', (final*255).astype(np.uint8))
