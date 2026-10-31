import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sveltePlugin from 'esbuild-svelte';
import sveltePreprocess from 'svelte-preprocess';

const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(base,'../..');
const out=path.join(root,'frontend/vendor/image-annotations');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function supplement(pkg,target,notices){
  if(notices.length)return;
  if(['is-reference','locate-character'].includes(pkg.name)){
    // Svelte compiler-only inputs; upstream publishes no standalone license.
    fs.copyFileSync(path.join(base,'node_modules',pkg.name,'README.md'),path.join(target,'README.md'));
    fs.writeFileSync(path.join(target,'NOTICE.txt'),'Build-only dependency: upstream package.json declares MIT but distribution and repository omit a standalone license file. README and package metadata retained. No compiler code is included in the application runtime.\n');
    notices.push('README.md','NOTICE.txt');return;
  }
  const notice=pkg.name.startsWith('@annotorious/')?'ANNOTORIOUS-LICENSE.txt':pkg.name==='@pixi/colord'?'COLORD-LICENSE.txt':pkg.name.startsWith('@pixi/')?'PIXI-LICENSE.txt':['is-reference','locate-character'].includes(pkg.name)?pkg.name+'-LICENSE.txt':null;
  if(!notice)throw new Error('Missing dependency notice: '+pkg.name);
  fs.copyFileSync(path.join(base,'upstream-notices',notice),path.join(target,'LICENSE.txt'));
  fs.copyFileSync(path.join(base,'upstream-notices',notice==='ANNOTORIOUS-LICENSE.txt'?'source.json':notice+'.source.json'),path.join(target,'source.json'));
  notices.push('LICENSE.txt','source.json');
}
if(!path.resolve(out).startsWith(path.resolve(root)+path.sep))throw new Error('Asset output escaped the workspace');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
const result=await build({absWorkingDir:base,entryPoints:['entry.mjs'],bundle:true,
  alias:{'@annotorious/openseadragon/annotorious-openseadragon.css':path.join(base,'node_modules/@annotorious/openseadragon/dist/annotorious-openseadragon.css'),'@annotorious/annotorious/annotorious.css':path.join(base,'node_modules/@annotorious/annotorious/dist/annotorious.css'),'@annotorious/annotorious/src':path.join(base,'upstream-source/packages/annotorious/src/index.ts'),'@annotorious/openseadragon':path.join(base,'upstream-source/packages/annotorious-openseadragon/src/index.ts'),'@annotorious/annotorious':path.join(base,'upstream-source/packages/annotorious/src/index.ts'),'@annotorious/core':path.join(base,'upstream-source/packages/annotorious-core/src/index.ts')},
  plugins:[sveltePlugin({preprocess:sveltePreprocess({typescript:{tsconfigFile:false,compilerOptions:{verbatimModuleSyntax:true}}})})],
  format:'esm',platform:'browser',target:'es2022',outfile:path.join(out,'viewer.js'),
  minify:true,legalComments:'linked',metafile:true});
const dependencies=new Map();
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.includes('node_modules/'))continue;
  let directory=path.dirname(path.resolve(base,input));
  let pkg;
  while(directory.startsWith(base)){
    const manifest=path.join(directory,'package.json');
    if(fs.existsSync(manifest)){
      const candidate=JSON.parse(fs.readFileSync(manifest,'utf8'));
      if(candidate.name){pkg=candidate;break;}
    }
    directory=path.dirname(directory);
  }
  if(!pkg)throw new Error('Dependency has no named package inside the pinned build directory');
  if(pkg.name==='research-workbench-image-annotation-assets')continue;
  const key=`${pkg.name.replaceAll('/','__')}@${pkg.version}`;
  if(dependencies.has(key))continue;
  const target=path.join(out,'licenses',key);fs.mkdirSync(target,{recursive:true});
  fs.copyFileSync(path.join(directory,'package.json'),path.join(target,'package.json'));
  const notices=fs.readdirSync(directory).filter(n=>/^(licen[sc]e|copying|copyright|notice)([._-].*)?$/i.test(n)&&fs.statSync(path.join(directory,n)).isFile());
  for(const name of notices)fs.copyFileSync(path.join(directory,name),path.join(target,name));
  supplement(pkg,target,notices);
  dependencies.set(key,{name:pkg.name,version:pkg.version,license:pkg.license??null,notices});
}
fs.copyFileSync(path.join(base,'package-lock.json'),path.join(out,'package-lock.json'));
// Annotorious publishes a prebundled runtime; the metafile cannot identify its
// embedded versions. Preserve the pinned installation notices separately.
const installation=[];
function collect(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    const absolute=path.join(directory,entry.name);
    if(entry.name.startsWith('@')){collect(absolute);continue;}
    const manifest=path.join(absolute,'package.json');
    if(!fs.existsSync(manifest))continue;
    const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(pkg.name==='esbuild'||pkg.name.startsWith('@esbuild/'))continue;
    const key=`${pkg.name.replaceAll('/','__')}@${pkg.version}`;
    const target=path.join(out,'installation-notices',key);fs.mkdirSync(target,{recursive:true});
    fs.copyFileSync(manifest,path.join(target,'package.json'));
    const notices=fs.readdirSync(absolute).filter(n=>/^(licen[sc]e|copying|copyright|notice)([._-].*)?$/i.test(n)&&fs.statSync(path.join(absolute,n)).isFile());
    for(const name of notices)fs.copyFileSync(path.join(absolute,name),path.join(target,name));
    supplement(pkg,target,notices);
    installation.push({name:pkg.name,version:pkg.version,license:pkg.license??null,notices});
    if(fs.existsSync(path.join(absolute,'node_modules')))collect(path.join(absolute,'node_modules'));
  }
}
collect(path.join(base,'node_modules'));
const files={};
function inventory(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const absolute=path.join(directory,entry.name);
  if(entry.isDirectory())inventory(absolute);
  else if(entry.name!=='manifest.json'){
    const data=fs.readFileSync(absolute);files[path.relative(out,absolute).replaceAll('\\','/')]={sha256:sha(data),byte_size:data.length};
  }
}}
inventory(out);
const manifest={component:'Original OpenSeadragon + Annotorious',packages:[...dependencies.values()],viewer_version:'6.1.1',annotator_version:'3.9.5',application_framework:false,executors:false,upstream:['https://github.com/openseadragon/openseadragon','https://github.com/annotorious/annotorious'],lock_sha256:sha(fs.readFileSync(path.join(base,'package-lock.json'))),entry_sha256:sha(fs.readFileSync(path.join(base,'entry.mjs'))),files};
manifest.installation_notices=installation;
manifest.notice_scope='Original Annotorious source compiled from the npm gitHead; Pixi official unsafe-eval compatibility installer preserves strict CSP. Upstream prebundled CSS only. Compiled packages are inventoried separately from installation/type/build dependency notices. No application framework migration; the runtime contains compiled Svelte and Pixi internals.';
manifest.upstream_source=JSON.parse(fs.readFileSync(path.join(base,'upstream-source/source.json'),'utf8'));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:Object.keys(files).length,packages:dependencies.size,js_bytes:files['viewer.js'].byte_size}));
