import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

from .agent_store import now
from .excerpts import verify_source
from .images import image_record
from .library import read_metadata
from .models import WorkspaceError
from .note_lifecycle import ensure_active,read_state
from .image_sources import checked_bytes

PROBE=Path(__file__).with_name('page_text_probe.py')


class PageTextReader:
    def __init__(self,timeout=8):
        self.timeout=timeout
        self.slots=threading.BoundedSemaphore(2)

    def __call__(self,source,page):
        if not self.slots.acquire(blocking=False):
            raise WorkspaceError('text_busy','正在读取其他页面，请稍后重试。',429)
        try:
            return self.read(source,page)
        finally:
            self.slots.release()

    def read(self,source,page):
        try:
            result=subprocess.run([sys.executable,str(PROBE),str(source),str(page)],
                capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=self.timeout,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            value=json.loads(result.stdout)
            if result.returncode or not isinstance(value.get('text'),str) or value.get('page')!=page:
                raise ValueError()
            return {'page':page,'text':value['text'][:12000],'truncated':bool(value.get('truncated'))}
        except subprocess.TimeoutExpired:
            raise WorkspaceError('text_timeout','读取页面超时，请换一页或使用图片参考。',422) from None
        except OSError:
            raise WorkspaceError('text_unavailable','暂时无法读取页面文字。',503) from None
        except (ValueError,TypeError,AttributeError):
            raise WorkspaceError('text_unavailable','页面文字无法读取，可选择图片参考。',422) from None


class ReadingWorkspace:
    def __init__(self,store,images,reader=None,analysis=None):
        self.store,self.images=store,images
        self.analysis=analysis
        self.reader=reader or PageTextReader()

    def capture(self,identifier,context):
        with self.store.connection() as connection:
            connection.execute('BEGIN')
            document=read_metadata(connection,identifier)
            if context.page>document['page_count']:
                raise WorkspaceError('invalid_page','当前页码超出论文范围。')
            active_note=None
            if context.active_note_id:
                active_note=ensure_active(read_state(connection,identifier,str(context.active_note_id)))
                active_note.pop('rich_html',None)
            images=[image_record(self.images.row(connection,identifier,str(i))) for i in context.image_ids]
            dataset=None
            active_analysis=None
            active_image=None
            active_chart=None
            if context.dataset_id:
                if self.analysis is None:raise WorkspaceError('agent_tool_unavailable','数据读取服务尚未安装。',409)
                row=self.analysis.datasets.row(connection,identifier,str(context.dataset_id))
                self.analysis.datasets.checked(row);dataset=self.analysis.datasets.record(row)
            if context.active_analysis_id:
                if self.analysis is None:raise WorkspaceError('agent_tool_unavailable','分析服务尚未安装。',409)
                row=self.analysis.row(connection,identifier,str(context.active_analysis_id))
                if dataset is None or row['dataset_id']!=dataset['id']:
                    raise WorkspaceError('agent_analysis_not_shared','请明确共享这份分析对应的数据后再发送。',409)
                payload=json.loads(row['payload_json'])
                active_analysis={k:row[k] for k in ('id','dataset_id','status','engine_version','created_at','finished_at')}
                active_analysis.update(engine=payload['engine'],columns=payload['columns'])
            if context.active_image:
                selected=context.active_image
                service=getattr(self,'image_annotations',None)
                if service is None:raise WorkspaceError('agent_tool_unavailable','图片标注服务尚未接入。',409)
                value,_=service.view_in(connection,identifier,selected.source_kind,str(selected.source_id))
                annotation=None
                if selected.annotation_id:
                    annotation=next((i for i in value['items'] if i['id']==str(selected.annotation_id)),None)
                    if annotation is None:raise WorkspaceError('not_found','当前标注不属于这张图片。',404)
                active_image={**selected.model_dump(mode='json'),'source':value['source'],'annotation':annotation,
                    'pixels_shared':selected.source_kind=='user_upload' and str(selected.source_id) in [i['id'] for i in images]}
            if context.active_chart_id:
                service=getattr(self,'charts',None)
                if service is None:raise WorkspaceError('agent_tool_unavailable','绘图工具尚未安装。',409)
                selected=service.row(connection,identifier,str(context.active_chart_id))
                if dataset is None or selected['dataset_id']!=dataset['id']:
                    raise WorkspaceError('agent_chart_not_shared','请明确共享这张图表对应的数据后再发送。',409)
                active_chart,_=service.data_in(connection,identifier,str(context.active_chart_id))
        result={'document':document,'page':context.page,'rect':list(context.rect) if context.rect else None,
                'active_note_id':str(context.active_note_id) if context.active_note_id else None,
                'active_note':active_note,'image_ids':[r['id'] for r in images],'images':images,
                'language':context.language,'captured_at':now(),
                'dataset_id':str(context.dataset_id) if context.dataset_id else None,'dataset':dataset,
                'active_analysis_id':str(context.active_analysis_id) if context.active_analysis_id else None,'active_analysis':active_analysis,
                'initiator':{'identity_source':'local_compat','authenticated':False}}
        if active_image is not None:result['active_image']=active_image
        if active_chart is not None:result.update(active_chart_id=active_chart['id'],active_chart=active_chart)
        return result

    def page(self,document_id,number):
        document=self.store.get_document(document_id)
        if type(number) is not int or not 1<=number<=document['page_count']:
            raise WorkspaceError('invalid_page','页码超出论文范围。')
        source=verify_source(self.store,document)
        result=self.reader(source,number)
        verify_source(self.store,document)
        return {**result,'source_sha256':document['sha256'],'document_id':document_id}

    def pixels(self,document_id,image):
        path=self.images.path(document_id,image['id'],True)
        data=checked_bytes(path,image['preview_byte_size'],image['preview_sha256'],2*1024*1024)
        return 'data:'+image['preview_mime_type']+';base64,'+base64.b64encode(data).decode('ascii')


class Sources:
    def __init__(self,document_id,context):
        self.document_id=document_id
        self.context=context
        self.items=[]

    def add(self,kind,label,**fields):
        item={'kind':kind,'label':label,'document_id':self.document_id,**fields}
        for previous in self.items:
            if {k:v for k,v in previous.items() if k!='ref'}==item:return previous
        item['ref']='R'+str(len(self.items)+1)
        self.items.append(item)
        return item

    def page(self,value):
        page=value['page']
        label=f'Page {page}' if self.context['language']=='en' else f'第 {page} 页'
        return self.add('pdf_page',label,page=page,rect=None,
            url=f'/api/v1/documents/{self.document_id}/file#page={page}',text=value['text'],
            truncated=value['truncated'],source_sha256=value['source_sha256'])

    def selection(self):
        if not self.context.get('rect'):return None
        page=self.context['page']
        label='Selected display region (position only)' if self.context['language']=='en' else '显示选区（仅位置，未提取区域内容）'
        return self.add('display_selection',label,page=page,rect=self.context['rect'],
            url=f'/api/v1/documents/{self.document_id}/file#page={page}',
            source_sha256=self.context['document']['sha256'])

    def image(self,value):
        return self.add('user_upload',value['original_filename'],page=self.context['page'],rect=None,
            image_id=value['id'],url=value['preview_url'],source_sha256=self.context['document']['sha256'])

    def note(self,value):
        return self.add('note',f"第 {value['page']} 页笔记",document_id=value['document_id'],page=value['page'],
            rect=value['rect'],note_id=value['id'],revision=value['revision'],text=value['text'][:4000],
            truncated=len(value['text'])>4000,url=f"/?document={value['document_id']}&note={value['id']}",
            source_sha256=self.context['document']['sha256'] if value['document_id']==self.document_id else None)

    def image_annotation(self,value,source):
        return self.add('image_annotation','图片标注 · '+source['label'],source_kind=value['source_kind'],source_id=value['source_id'],
            annotation_id=value['id'],image_rect=value['rect'],frame_sha256=value['frame_sha256'],
            source_sha256=value['source_sha256'],text=value['text'],revision=value['revision'],deleted_at=value['deleted_at'],
            url=value['viewer_url'],notice='Image-frame annotation text; not PDF coordinates or implicit image pixels.')

    def dataset(self,value):
        return self.add('dataset_sample',value['original_filename'],page=self.context['page'],rect=None,
            dataset_id=value['id'],dataset_sha256=value['sha256'],source_sha256=self.context['document']['sha256'],
            text=json.dumps({'columns':value['columns'],'row_count':value['row_count'],'preview':value['preview'],
                             'sample_truncated':value['sample_truncated']},ensure_ascii=False),
            url=f"/?document={self.document_id}&dataset={value['id']}")

    def analysis(self,job):
        summary=next(o for o in job['outputs'] if o['name']=='summary.json')
        return self.add('analysis_result',job['dataset_name']+' · '+job['engine'],page=self.context['page'],rect=None,
            analysis_id=job['id'],dataset_id=job['dataset_id'],dataset_sha256=job['dataset_sha256'],
            result_sha256=summary['sha256'],source_sha256=self.context['document']['sha256'],
            text=json.dumps(job['result'],ensure_ascii=False),url=f"/?document={self.document_id}&analysis={job['id']}")

    def get(self,ref):
        result=next((r for r in self.items if r['ref']==ref),None)
        if result is None or result['document_id']!=self.document_id or not result.get('page'):
            raise WorkspaceError('agent_source_required','请先读取当前论文中的实际出处，再提出笔记。',409)
        return result

    def chart(self,chart):
        return self.add('chart_result',chart['title'],page=self.context['page'],rect=None,
            chart_id=chart['id'],dataset_id=chart['dataset_id'],dataset_sha256=chart['dataset_sha256'],
            result_sha256=chart['data_sha256'],source_sha256=self.context['document']['sha256'],
            text=json.dumps({'spec':chart['spec'],'summary':chart['summary']},ensure_ascii=False),
            url=chart['viewer_url'],notice='Derived visualization, not an original PDF measurement or evidence of significance.')
