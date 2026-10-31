# Third-party components

| Component | Version / license | Reuse |
|---|---|---|
| Mozilla PDF.js (`pdfjs-dist`) | 6.4.299 / Apache-2.0 | Browser library and worker; CMaps, standard fonts, WASM |
| JupyterKit core and default theme | 3.0.0 / Apache-2.0 | Local saved-Notebook renderer; no editor, executor or kernel |
| Quill | 2.0.3 / BSD-3-Clause | Original local rich-text editor; limited text formats |
| DOMPurify (rich notes) | 3.4.17 / Apache-2.0 OR MPL-2.0 | Sanitize derived rich note/proposal markup |
| pypdf | 6.21.4 / BSD-3-Clause | PDF validation in a separate process; synthetic fixture generation |
| pypdfium2 | 5.14.0 / Apache-2.0 or BSD-3-Clause | PDFium binding, image excerpt rendering in a separate process |
| PDFium | Bundled with the pinned pypdfium2 wheel / BSD-style and dependency licenses | PDF rendering engine |
| Pillow | 13.0.0 / HPND | PNG encoding in the rendering subprocess |
| FastAPI | 0.162.0 / MIT | Our API application |
| Starlette | See requirements.lock.txt / BSD-3-Clause | ASGI HTTP/static-file support |
| Uvicorn | 0.54.0 / BSD-3-Clause | Local ASGI server |
| python-multipart | 0.0.32 / Apache-2.0 | File upload parsing |
| SQLite / Python standard library | Runtime distributions | Our local persistence |

PDF.js is fetched by scripts/prepare_assets.py from the official npm package;
its exact SHA-512 is pinned and checked before selecting library assets. Its
LICENSE and upstream manifest are retained under frontend/vendor/pdfjs/.
Bundled fonts/WASM retain their upstream license files. Do not remove notices
when packaging. Python packages retain their distribution license metadata.
PDFium binary redistributions must also retain the dependency licenses shipped
with the installed wheel. See the [pypdfium2 licensing documentation](https://pypdfium2.readthedocs.io/en/stable/readme.html#licensing).

frontend/theme-tokens.css is an unchanged first-party snapshot of the current
tFUS neutral/blue-gray color definitions, copied to keep the applications
independently runnable. This is not a new shared-core package or a live dependency
on workbench-web; changes require deliberate synchronization.

No eLabFTW or RSpace application code is included in this slice.

v0.10 embeds the unchanged original plotly.js-strict-dist-min4.2.0 distribution
(MIT). scripts/prepare_plotly_assets.py pins the npm tarball SHA-512 and records
SHA-256/size of JS, package metadata, README and complete LICENSE under
frontend/vendor/plotly/4.2.0/. Existing bundled notices in the original minified
file are retained. No Plotly server, Dash framework, Galaxy or openBIS business
code is deployed. Chart ZIPs retain the original runtime and LICENSE.

v0.6 descriptive recipes use Python's statistics/csv standard-library modules and
an optional separately installed official R runtime (base stats), invoked by
command line. R runtime binaries are not vendored in this source tree. The local
R 4.6.2 installer came from CRAN, with its official published fingerprint checked;
installation/source provenance is recorded in the task evidence. Preserve the
runtime's own COPYING/COPYING3/COPYRIGHTS notices if redistributing it.

Notebook assets are built by `scripts/prepare_notebook_assets.py` from
`scripts/notebook-assets/package-lock.json`, with npm lifecycle scripts disabled.
`frontend/vendor/notebook/manifest.json` records dependency versions, retained
licenses, and asset sizes/hashes. License collection resolves the nearest named
package, skipping nested module-format-only `package.json` files.
Run `scripts/prepare_notebook_assets.py --verify` to check the inventory.
This dependency reuse does not include RSpace application code.

Rich-text assets use scripts/rich-text-assets/package-lock.json and
scripts/prepare_rich_text_assets.py with npm lifecycle scripts disabled. Original
compiled packages and notices remain under frontend/vendor/rich-text/manifest.json
and licenses/. Quill's deprecated lodash.isequal stays its pinned upstream
transitive dependency; the original editor is unmodified. No RSpace TinyMCE
plugins or business code is included. Preserve all third-party notices.

v0.9 uses original OpenSeadragon 6.1.1 and @annotorious/openseadragon 3.9.5
(BSD-3-Clause). scripts/image-annotation-assets/package-lock.json pins the build;
scripts/prepare_image_annotation_assets.py rebuilds without npm lifecycle scripts
or verifies the local assets. frontend/vendor/image-annotations/manifest.json
records compiled package notices, hashes and a separate installation dependency
notice snapshot. The npm JavaScript distribution is prebundled and its Pixi
runtime conflicts with strict CSP. Our build compiles unchanged Annotorious
source from that release's gitHead with pinned Svelte4 and the original official
@pixi/unsafe-eval7.4.3 installer. It supports CSP without permitting unsafe-eval.
Compiled dependency versions/hashes are inventoried; npm distribution CSS is
retained. No application framework migration or RSpace business code is involved.

Some npm packages omit their license text. upstream-notices/ retains source URL,
commit/blob and SHA-256 provenance for supplied notices. Annotorious's license is
from the npm version's gitHead. @pixi/colord's declared gitHead is unresolved in
its declared repository and fork, so its upstream MIT notice is separately
labelled as a notice source, without claiming source-version identity.
Preserve licenses/ and installation-notices/ when distributing the viewer.
is-reference/locate-character are compiler-only dependencies with MIT declared
in metadata but no standalone upstream license file. Their README/metadata and
an explicit omission notice are retained; their compiler code is not shipped in
the runtime. Source provenance and hashes live in upstream-source/source.json.
# v0.12 SPSS file component

pyreadstat1.3.7 is Apache-2.0 and bundles MIT-licensed ReadStat. Its original
combined notice is retained in scripts/import-runtime/licenses/pyreadstat-1.3.7/.
The isolated reader also pins numpy2.5.4 and narwhals2.28.0; their full upstream
license directories and package metadata are retained alongside it, including
NumPy's bundled compiled-component notices. Preserve these notices and the
runtime wheel metadata when distributing the file-reader component.
scripts/import-runtime/requirements.lock.txt records the verified Windows/cp312
wheel hashes; scripts/prepare_import_runtime.py installs it in a separate venv.
No application venv, global R installation or complete statistical application
is replaced. Source: https://github.com/Roche/pyreadstat .

# v0.11 R stats computation

The independent-samples t-test directly calls the existing R4.6.2 stats::t.test
component through a first-party fixed adapter. The upstream algorithm is not
rewritten or copied into Python. R as a whole is GPL-2 | GPL-3; original runtime
COPYING/COPYRIGHTS and package notices are retained. See
[R licensing](https://www.r-project.org/Licenses/) and STATISTICAL-TESTS.md.

jmv2.8.0 and159 dependencies were installed only in an isolated evaluation
directory. They failed clean-exit verification and are not product dependencies.
Their archive hashes/licenses and diagnostic evidence remain in reader-v11 and
research-workbench-runtime/research-stats-v1. No jmv business module or standalone
jamovi/JASP/PSPP application is deployed by this release.

