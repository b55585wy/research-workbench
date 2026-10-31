"""Small allowlisted document boundary around the original Quill editor."""
from html import escape
import json
from urllib.parse import urlsplit

MAX_RICH_BYTES=65536
MAX_RICH_OPS=512


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)


def valid_link(value):
    if not isinstance(value,str) or not value or len(value)>2048 or any(c.isspace() or ord(c)<32 for c in value):return False
    try:
        parsed=urlsplit(value)
        return parsed.scheme.lower() in ('http','https') and bool(parsed.hostname) and parsed.username is None and parsed.password is None
    except ValueError:return False


def attributes(value,insert):
    if type(value) is not dict or set(value)-{'bold','italic','underline','header','list','link'}:raise ValueError('Unsupported formatting')
    result=dict(value)
    for key in ('bold','italic','underline'):
        if key in result and result[key] is not True:raise ValueError('Formatting flags must be true')
    if 'link' in result and not valid_link(result['link']):raise ValueError('Only absolute HTTP(S) links without credentials are supported')
    if 'header' in result and (type(result['header']) is not int or result['header'] not in (1,2)):raise ValueError('Unsupported heading')
    if 'list' in result and result['list'] not in ('bullet','ordered'):raise ValueError('Unsupported list')
    if 'header' in result and 'list' in result:raise ValueError('A line cannot be a heading and a list')
    if ('header' in result or 'list' in result) and insert.strip('\n'):raise ValueError('Line formatting requires newline-only inserts')
    return result


def validate_content(value):
    if type(value) is not dict or set(value)!={'version','ops'} or type(value['version']) is not int or value['version']!=1:raise ValueError('Unsupported rich document')
    ops=value['ops']
    if type(ops) is not list or not 1<=len(ops)<=MAX_RICH_OPS:raise ValueError('Too many or missing rich operations')
    clean=[];length=0
    for op in ops:
        if type(op) is not dict or 'insert' not in op or set(op)-{'insert','attributes'}:raise ValueError('Only text insert operations are supported')
        insert=op['insert']
        if not isinstance(insert,str) or not insert or any(ord(c)<32 and c not in '\n\t' for c in insert):raise ValueError('Invalid rich text')
        length+=len(insert)
        if length>10001:raise ValueError('Rich text exceeds the note limit')
        attrs=attributes(op.get('attributes',{}),insert)
        item={'insert':insert}
        if attrs:item['attributes']=attrs
        if clean and clean[-1].get('attributes')==item.get('attributes'):clean[-1]['insert']+=insert
        else:clean.append(item)
    if not clean[-1]['insert'].endswith('\n'):raise ValueError('Rich documents must end in a newline')
    result={'version':1,'ops':clean}
    if not plaintext(result):raise ValueError('Rich text must not be empty')
    try:size=len(canonical(result).encode('utf-8'))
    except (ValueError,UnicodeError):raise ValueError('Invalid rich encoding') from None
    if size>MAX_RICH_BYTES:raise ValueError('Rich document exceeds64KiB')
    return result


def plaintext(value):return ''.join(op['insert'] for op in value['ops']).strip()


def inline(text,attrs):
    result=escape(text)
    for key,tag in (('bold','strong'),('italic','em'),('underline','u')):
        if attrs.get(key):result=f'<{tag}>'+result+f'</{tag}>'
    if attrs.get('link'):result='<a href="'+escape(attrs['link'],quote=True)+'" rel="noopener noreferrer">'+result+'</a>'
    return result


def render_html(value):
    lines=[];pieces=[]
    for op in value['ops']:
        attrs=op.get('attributes',{});parts=op['insert'].split('\n')
        for index,part in enumerate(parts):
            if part:pieces.append(inline(part,attrs))
            if index<len(parts)-1:lines.append((attrs,''.join(pieces)));pieces=[]
    result=[];listing=None
    for attrs,body in lines:
        kind={'bullet':'ul','ordered':'ol'}.get(attrs.get('list'))
        if kind!=listing:
            if listing:result.append(f'</{listing}>')
            if kind:result.append(f'<{kind}>')
            listing=kind
        tag='li' if kind else 'h'+str(attrs['header']) if attrs.get('header') else 'p'
        result.append(f'<{tag}>'+(body or '<br>')+f'</{tag}>')
    if listing:result.append(f'</{listing}>')
    return ''.join(result)


def add_to_state(result,content):
    result.pop('rich_content',None);result.pop('rich_html',None)
    if content is not None:
        result['rich_content']=content;result['rich_html']=render_html(content)
    return result
