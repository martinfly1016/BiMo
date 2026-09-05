from PIL import Image
def crop(src, box, name, s=3):
    im = Image.open(src).crop(box); im = im.resize((im.width*s, im.height*s), Image.LANCZOS); im.save(name); print(name, im.size)
# 38.5s no-hand oblique frame: dense/d_077.png ; 35.0 -> d_070 ; 10.5 -> d_021 ; 20.0 -> d_040 ; 34.0 -> d_068
crop('dense/d_077.png', (40,290,240,430), 'obl385_xiao.png')
crop('dense/d_077.png', (130,460,400,730), 'obl385_han.png')
crop('dense/d_070.png', (260,560,480,660), 'obl350_na.png', 4)
crop('dense/d_021.png', (40,290,240,430), 'obl105_xiao.png')
crop('dense/d_040.png', (130,460,330,600), 'obl200_mian.png')
crop('dense/d_011.png', (60,280,220,420), 'obl055_tip.png', 4)   # 5.5s tip touching
crop('dense/d_014.png', (60,280,220,420), 'obl070_hook.png', 4)  # 7.0s hook
crop('dense/d_055.png', (200,520,400,660), 'obl275_heng.png', 4) # 27.5 long heng end
crop('dense/d_063.png', (150,520,420,760), 'obl315_pie.png', 3)  # 31.5 pie
