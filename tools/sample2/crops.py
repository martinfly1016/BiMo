from PIL import Image
im = Image.open('tailall/t_110.png')  # t=42.17 static
print(im.size)
crops = {'still_xiao': (120,130,330,270), 'still_han': (120,290,380,530), 'still_seal': (190,540,310,660), 'still_han_left': (120,380,260,530), 'still_han_right': (240,380,380,530)}
for name,box in crops.items():
    c = im.crop(box)
    c = c.resize((c.width*3, c.height*3), Image.LANCZOS)
    c.save(f'{name}.png'); print(name, c.size)
im.save('still_ref_42.17.png')
