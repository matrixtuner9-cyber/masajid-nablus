import sys
from PIL import Image,ImageDraw
out=sys.argv[1];web=sys.argv[2]
def icon(S,round_=True,fg_only=False,scale=1.0):
    im=Image.new('RGBA',(S,S),(0,0,0,0));d=ImageDraw.Draw(im)
    if not fg_only:
        d.rounded_rectangle([0,0,S-1,S-1],int(S*0.22) if round_ else 0,fill=(47,61,39,255))
    bg=(0,0,0,0) if fg_only else (47,61,39,255)
    g=(201,162,74,255);c=S/2;w=S*0.44*scale;base=S*(0.70 if scale==1 else 0.64)
    d.pieslice([c-w/2,base-w*0.95,c+w/2,base+w*0.05],180,360,fill=g);d.rectangle([c-w/2,base-w*0.45,c+w/2,base],fill=g)
    dw=S*0.10*scale;d.rounded_rectangle([c-dw/2,base-S*0.16*scale,c+dw/2,base],int(dw/2),fill=bg)
    d.rectangle([c-w*0.65,base,c+w*0.65,base+S*0.04*scale],fill=g)
    d.rectangle([c-S*0.012*scale,base-w*0.95-S*0.10*scale,c+S*0.012*scale,base-w*0.93],fill=g)
    cr=S*0.06*scale;cy=base-w*0.95-S*0.14*scale
    d.ellipse([c-cr,cy-cr,c+cr,cy+cr],fill=g);d.ellipse([c-cr+S*0.03*scale,cy-cr-S*0.01*scale,c+cr+S*0.03*scale,cy+cr-S*0.01*scale],fill=bg)
    return im
icon(1024,round_=False).convert('RGB').save(out+'/icon.png')
icon(1024,fg_only=True,scale=0.7).save(out+'/icon_fg.png')
im=Image.open(web+'/nablus.avif');r=im.resize((720,int(im.size[1]*720/im.size[0])),Image.LANCZOS);r.save(out+'/nablus.webp','WEBP',quality=45)
print('assets ok')
