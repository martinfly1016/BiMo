import glob, os
from PIL import Image, ImageDraw
files = sorted(glob.glob('dense/d_*.png'))
# index i -> t = i*0.5
per = 12; cols=4; rows=3
W,H = 240, 427
for s in range(0, len(files), per):
    chunk = files[s:s+per]
    sheet = Image.new('RGB', (cols*W, rows*H), 'white')
    d = ImageDraw.Draw(sheet)
    for k,f in enumerate(chunk):
        idx = int(os.path.basename(f)[2:5]); t = idx*0.5
        im = Image.open(f).resize((W,H))
        x,y = (k%cols)*W, (k//cols)*H
        sheet.paste(im,(x,y))
        d.rectangle([x,y,x+60,y+16], fill='yellow'); d.text((x+3,y+3), f"{t:.1f}s", fill='black')
    sheet.save(f'sheet_{s//per:02d}.png')
    print('sheet', s//per, chunk[0], chunk[-1])
