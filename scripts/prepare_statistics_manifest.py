"""Snapshot/verify existing R stats; never alters the R install."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--r-home',type=Path,required=True);p.add_argument('--verify',action='store_true');a=p.parse_args()
root,home=a.root.resolve(),a.r_home.resolve();root.mkdir(parents=True,exist_ok=True)
assert 'Version: 4.6.2' in (home/'library/stats/DESCRIPTION').read_text(encoding='utf-8')
files={x.relative_to(home/'library').as_posix():hashlib.sha256(x.read_bytes()).hexdigest() for x in (home/'library/stats').rglob('*') if x.is_file()}
m={'format':'research-rstats-library/v1','stats_version':'4.6.2','r_home':str(home),'packages':[{'package':'stats','version':'4.6.2','source':'Bundled with existing R4.6.2','license':'Part of R; GNU GPL version 2 or 3'}],'library_files':files}
if a.verify:assert json.loads((root/'manifest.json').read_text(encoding='utf-8'))==m
else:
    assert not (root/'manifest.json').exists(),'Existing manifest must not be replaced silently'
    (root/'manifest.json').write_text(json.dumps(m,sort_keys=True,separators=(',',':')),encoding='utf-8')
print(json.dumps({'verified':a.verify,'packages':1,'files':len(files),'existing_stats_bytes':sum((home/'library'/n).stat().st_size for n in files)}))
