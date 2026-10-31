"""Fixed child-process image decoder. Original bytes are never rewritten."""
import io
import json
from pathlib import Path
import sys
import warnings

from PIL import Image,ImageOps


def inspect(source,target):
    Image.MAX_IMAGE_PIXELS=16_000_000
    with warnings.catch_warnings():
        warnings.simplefilter('error',Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            if opened.format not in ('PNG','JPEG','WEBP') or getattr(opened,'is_animated',False):
                raise ValueError('Unsupported image')
            width,height=opened.size
            if min(width,height)<1 or max(width,height)>8192 or width*height>16_000_000:
                raise ValueError('Image bounds')
            mime={'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}[opened.format]
            opened.load()
            image=ImageOps.exif_transpose(opened).convert('RGBA' if 'A' in opened.getbands() or 'transparency' in opened.info else 'RGB')
            image.thumbnail((1600,1600))
            clean=Image.new(image.mode,image.size)
            clean.paste(image)
            output=io.BytesIO()
            clean.save(output,format='PNG',optimize=True)
            preview_mime='image/png'
            if output.tell()>2*1024*1024:
                white=Image.new('RGB',clean.size,'white')
                white.paste(clean,mask=clean.getchannel('A') if clean.mode=='RGBA' else None)
                output=io.BytesIO()
                white.save(output,format='JPEG',quality=88)
                preview_mime='image/jpeg'
            if output.tell()>2*1024*1024:
                raise ValueError('Preview bounds')
            Path(target).write_bytes(output.getvalue())
            return {'mime_type':mime,'width':width,'height':height,'preview_mime_type':preview_mime}


if __name__=='__main__':
    try:
        print(json.dumps(inspect(sys.argv[1],sys.argv[2])))
    except Exception:
        print(json.dumps({'error':'invalid_image'}))
        raise SystemExit(1)
