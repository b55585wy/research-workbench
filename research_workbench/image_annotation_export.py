"""Portable, escaped static overlays; never flatten or modify source bitmaps."""
from html import escape
import json
import re
from uuid import UUID
from .images import ImageLibrary,EXTENSIONS
from .excerpts import checked_image
from .image_sources import source_error


def portable_source(source):
    result={k:v for k,v in source.items() if k not in ('frame_url','original_url')}
    identifier=str(UUID(source['source_id']))
    if source['source_kind']=='user_upload':
        result['frame_path']='images/upload-'+identifier+EXTENSIONS[source['frame_mime_type']]
        result['original_file_path']='uploads/'+identifier+EXTENSIONS[source['original_mime_type']]
    else:
        result['frame_path']='images/'+identifier+'.png'
        result['original_file_path']=result['frame_path'];result['source_pdf_path']='source.pdf'
    return result


def archive_files(store,document_id,groups):
    library=ImageLibrary(store);output=[]
    for group in groups:
        source=group['source'];portable=portable_source(source)
        if source['source_kind']=='user_upload':
            image=library.get(document_id,source['source_id'])
            if (image['sha256'],image['preview_sha256'])!=(source['source_sha256'],source['frame_sha256']):raise source_error()
            output.append((portable['original_file_path'],library.path(document_id,source['source_id']),source['source_sha256'],source['original_byte_size']))
            path=library.path(document_id,source['source_id'],True)
        else:path=checked_image(store,{'note_id':source['source_id'],'sha256':source['frame_sha256'],'byte_size':source['frame_byte_size']})
        output.append((portable['frame_path'],path,source['frame_sha256'],source['frame_byte_size']))
    return output


def documents(groups):
    portable=[];sections=[];markdown=[]
    for group in groups:
        source=portable_source(group['source']);width=source['frame_width'];height=source['frame_height']
        kind='用户上传图片预览 / User-uploaded image preview' if source['source_kind']=='user_upload' else 'PDF 摘录 / PDF excerpt'
        label=escape(source['label']);rectangles=[];descriptions=[];items=[]
        for index,item in enumerate(group['items'],1):
            left,top,right,bottom=item['rect']
            rectangles.append(f'<rect x="{left*width:g}" y="{top*height:g}" width="{(right-left)*width:g}" height="{(bottom-top)*height:g}" fill="none" stroke="#18749c" stroke-width="2" vector-effect="non-scaling-stroke"><title>{index}: {escape(item["text"])}</title></rect>')
            origin='助手建议（已确认） / Confirmed Agent proposal' if item['origin']=='agent_proposal' else '手动说明 / Manual description'
            descriptions.append(f'<li><p>{escape(item["text"]).replace(chr(10),"<br>")}</p><small>{origin}</small></li>')
            items.append({k:v for k,v in item.items() if k!='viewer_url'})
            literal=re.sub(r'([\\`*_{}\[\]()#+.!|>\-])',r'\\\1',escape(item['text'],quote=False))
            markdown.extend([f'{index}. '+literal.replace('\n','\n   '),''])
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" style="max-width:100%;height:auto" role="img" aria-label="{label}"><image href="{source["frame_path"]}" width="{width}" height="{height}"/>'+''.join(rectangles)+'</svg>'
        source_link=f'<a href="source.pdf#page={source["page"]}">查看原文 / View source</a>' if source['source_kind']=='pdf_excerpt' else f'<a href="{source["original_file_path"]}">下载上传原图 / Original upload</a>'
        sections.append('<section><h2>图片标注 / Image annotations</h2><h3>'+label+'</h3><p>'+kind+' · '+source_link+'</p>'+svg+'<ol>'+''.join(descriptions)+'</ol></section>')
        portable.append({'source':source,'items':items})
    payload={'format':'research-image-annotations/v1','sources':portable}
    return payload,''.join(sections),'\n'.join(markdown)
