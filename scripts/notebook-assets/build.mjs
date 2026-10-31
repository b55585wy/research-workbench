import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(base,'../..');
const out=path.join(root,'frontend/vendor/notebook');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
fs.mkdirSync(out,{recursive:true});
const result=await build({absWorkingDir:base,entryPoints:['entry.mjs'],bundle:true,
  format:'esm',platform:'browser',target:'es2022',outfile:path.join(out,'renderer.js'),
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
  const key=`${pkg.name.replaceAll('/','__')}@${pkg.version}`;
  if(dependencies.has(key))continue;
  const target=path.join(out,'licenses',key);fs.mkdirSync(target,{recursive:true});
  fs.copyFileSync(path.join(directory,'package.json'),path.join(target,'package.json'));
  const notices=fs.readdirSync(directory).filter(n=>/^(licen[sc]e|copying|copyright|notice)([._-].*)?$/i.test(n)&&fs.statSync(path.join(directory,n)).isFile());
  for(const name of notices)fs.copyFileSync(path.join(directory,name),path.join(target,name));
  dependencies.set(key,{name:pkg.name,version:pkg.version,license:pkg.license??null,notices});
}
fs.copyFileSync(path.join(base,'package-lock.json'),path.join(out,'package-lock.json'));
const files={};
function inventory(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const absolute=path.join(directory,entry.name);
  if(entry.isDirectory())inventory(absolute);
  else if(entry.name!=='manifest.json'){
    const data=fs.readFileSync(absolute);files[path.relative(out,absolute).replaceAll('\\','/')]={sha256:sha(data),byte_size:data.length};
  }
}}
inventory(out);
const manifest={component:'JupyterKit saved-notebook renderer',packages:[...dependencies.values()],
  rspace_reference:{commit:'a0d333ea0652bbeee0bcd90f92684554bd69ce03',
    path:'src/main/webapp/ui/src/eln/jupyter-notebooks/index.tsx',kind:'upstream_dependency_reference_only'},
  upstream:'https://github.com/walkframe/jupyter-kit',renderer_version:'3.0.0',
  executors:false,editors:false,frameworks:false,lock_sha256:sha(fs.readFileSync(path.join(base,'package-lock.json'))),
  entry_sha256:sha(fs.readFileSync(path.join(base,'entry.mjs'))),files};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({files:Object.keys(files).length,packages:dependencies.size,js_bytes:files['renderer.js'].byte_size}));
