# 翻译解析运行环境（Linux / CentOS 7）

`prepare_translation_runtime.py` 只做一件事：在当前 CentOS 7 主机上新建一个
隔离的 MinerU 解析运行环境，并把 `runtime.json` 作为“就绪”凭据写入其中。
它不修改系统 Python、libc、`ld.so.conf`、SSH、防火墙，也不改动应用自己的
运行环境、服务单元或 `/var/lib` 数据目录。

## 产物

```
<root>/                       默认 /opt/research-workspace/runtimes/mineru-flash-v415-linux
  env/                        conda-forge Python 3.12 + 全量锁文件依赖
    bin/python3.12            复制成新 inode 后再改写的解释器
    lib/python3.12/site-packages/   应用信任检查读取的元数据目录
  libc/                       从 sysroot 复制并拍平的私有 glibc 2.28（ELF 实体，无指向宿主 /lib64 的链接）
  logs/                       conda-create / patchelf / pip-install / interpreter / imports / metadata-audit
  pip-freeze.txt              实际安装的 pip 版本清单（原始输出，仅作溯源）
  conda-explicit.txt          conda 显式包清单（含构建号与来源，仅作溯源）
  translation-requirements.lock.txt   本次实际使用的锁文件副本
  runtime.json                仅在全部检查通过后原子写入
```

`runtime.json` 保留应用读取的契约字段（`schema_version:1`、`engine`、
`mineru_version:4.1.5`、`docvortex_version:0.6.11`、`python`），另附解释器、
加载器、libc、锁文件的 SHA256 与创建时间，便于后续复核。

## 前提

- 以 root 运行；`/opt/research-workspace/runtimes` 已存在（脚本不会递归创建它）。
- `--root` 必须是该目录下全新的绝对路径：已存在（文件、目录、符号链接或空目录）
  就直接拒绝，不做续建或覆盖（`--finalize-existing` 是唯一的显式例外，见下）。
- 磁盘余量至少 4608 MiB；当前主机约 22 GiB 可用（收尾模式不做安装，只需少量空间）。
- 默认使用 `/opt/research-workspace/miniforge/bin/conda`（可用 `--conda` 指定）。
- 安装阶段的 pip 需要访问 PyPI；不读取用户 pip 配置、不复用用户缓存、不改 HOME。
- 用现有应用运行时的 Python（3.12，只执行本脚本、不写入其目录）或 Miniforge base
  Python 启动；CentOS 自带的 Python 2.7 不适用。脚本本身要求 Python 3.8+。

## 运行

```bash
/opt/research-workspace/runtimes/app-0.50.0/bin/python \
  /opt/research-workspace/current/deploy/server/prepare_translation_runtime.py \
  --root /opt/research-workspace/runtimes/mineru-flash-v415-linux
# 可选：--conda /path/to/conda  --lock /path/to/translation-requirements.lock.txt
# 可选：--import-memory-mib 3072  --import-timeout 240
```

若一次安装已经装完全部依赖但在后续检查阶段失败，可在该进程确认退出后，对**同一个**
已存在的目录执行显式收尾（不重新下载、不重装、不再用 patchelf 改写 Python）：

```bash
/opt/research-workspace/runtimes/app-0.50.0/bin/python \
  /opt/research-workspace/current/deploy/server/prepare_translation_runtime.py \
  --finalize-existing \
  --root /opt/research-workspace/runtimes/mineru-flash-v415-linux \
  --lock /opt/research-workspace/current/deploy/server/translation-requirements.lock.txt
```

`--finalize-existing` 是操作者对失败安装的显式收尾，不是静默续建：默认模式仍拒绝任何
已存在的根目录。收尾模式要求根目录严格位于 `/opt/research-workspace/runtimes` 之下、
路径中（含根目录本身）没有符号链接、根目录属主为 uid 0；`env/bin/python3.12`、私有
`libc/ld-linux-x86-64.so.2` 与 `libc/libc.so.6` 必须已在该根内；根内不得已有
`runtime.json`；`--lock` 的内容必须与根内副本逐字节一致（SHA256 相同）。它只做只读
复核与就绪检查，不做 conda/pip 安装、不改写解释器，全部通过后才原子写入清单。
前置条件是发起首次安装的进程已经结束；收尾模式不会等待或接管其他进程。

过程按步输出短 JSON 行（`preflight`、`conda_create`、`libc`、`patched`、
`interpreter`、`pip_install`、`dependencies`、`imports`、`ready`，或 `failed`；
收尾模式另有 `finalize`），不输出凭据。

## 关键不变量

1. 宿主 glibc 2.17 不被替换，`LD_LIBRARY_PATH` 不被导出；只有子进程环境里的
   继承项被清掉（`PYTHON*`、`PIP_*`、`LD_*`、`CONDA*` 等）。
2. conda 包缓存可能与 `env/` 硬链接共享 inode。因此先 `env/bin/python3.12`
   复制成新 inode，再用 `os.replace` 原子替换该文件，然后才用 `patchelf`
   设置解释器与 RPATH；共享 inode 永不被改写。
3. ELF 解释器指向 `<root>/libc/ld-linux-x86-64.so.2`，RPATH 为
   `$ORIGIN/../../libc:$ORIGIN/../lib`（外加原有的、且仍落在运行环境内的条目）。
   以 DT_RPATH（`--force-rpath`）写入，使后续由轮子 dlopen 的库也按同一顺序
   找到私有 libc 与 `env/lib`。任何指向运行环境之外的既有 RPATH 条目会让脚本
   中止，而不是被静默丢弃。
4. sysroot 里的加载器、libc、libm、libpthread 等按 sysroot 语境解析符号链接，
   只复制 ELF 实体并拍平到 `libc/`；绝对链接目标按 sysroot 重新解释，绝不回落到宿主文件。
   必需项额外包含 `libnss_files.so.2`、`libnss_dns.so.2`、`libresolv.so.2`：DNS 由私有
   glibc 解析，若缺少它们就会与宿主 2.17 的 NSS 混用不同 ABI。缺失必需项即失败；
   可选库（libanl/libnsl/libmvec/libcrypt）缺失只记录。
5. 锁文件只允许 `name==version` 形式，且必须包含 MinerU 4.1.5、DocVortex 0.6.11、
   Linux 版 `onnxruntime==1.24.4`、`onnxruntime-ep-webgpu==0.4.0`、`resvg_py==0.5.0`，
   不含 Windows 专用包或 torch/CUDA。
6. 安装只用二进制轮子；仅 `jieba`、`pylatexenc` 允许源码包。其他任何源码包都会
   中止并指明包名，不会静默开始编译。
7. 版本审计以私有 Python 的 `importlib.metadata` 为准：用 `-I -c` 子进程逐个读取
   全部已安装分发的 Name/Version，再与锁文件逐项比对。缺失、版本不符、或出现未固定的
   额外分发（仅允许 `pip`、`wheel`）都失败。`pip freeze` 与 `conda list --explicit`
   的原始输出仍写入根目录作溯源，但其中的 `name @ file:///home/conda/...` 是 conda
   安装包携带的 direct_url 记录，不是版本依据，脚本不会据此拒绝版本正确的已锁定包。
8. 只有全部通过后才写 `runtime.json`（临时文件 + `os.replace`）；失败时清单不存在，
   该目录保留日志与半成品供人工审查。

## 就绪判定

在 `HF_HUB_OFFLINE` / `TRANSFORMERS_OFFLINE` / `MODELSCOPE_OFFLINE=1` 下，用受限
内存与超时的 `-I` 子进程执行下列检查（`/proc/self/maps` 证明实际映射）：

- `os.confstr('CS_GNU_LIBC_VERSION') == 'glibc 2.28'`，Python 3.12，`sys.executable`
  与 `sys._base_executable`、`sys.prefix` 都解析在运行环境根内；
- `runtime.json` 记录的 python 是运行环境内的绝对路径，`site-packages` 下
  `mineru-4.1.5.dist-info` 与 `docvortex-0.6.11.dist-info` 的 `METADATA`
  声明了对应版本（与应用的信任检查一致）；
- 已安装版本审计通过（见不变量 7），日志在 `logs/metadata-audit.log`；
- 可 `import ssl`、`import ctypes`、`import pypdfium2`、`from mineru.parser import parse`；
  只导入，不调用 `parse`、不读文档、不下载模型、不发请求。

内核 3.10 与 glibc 2.28 组合的兼容性只由这次受控检查证明；检查失败即不写清单。

## 失败与再次运行

脚本不递归删除任何目录。失败后目录保留（含 `logs/`），请人工确认后用**新的**
`--root` 重跑；需要清理旧目录时由操作者自行决定，脚本不代劳。
若依赖已经全部安装、失败只发生在后续检查（例如旧版把 conda 的 direct_url 行误判为
版本问题），可先确认发起安装的进程已经退出，再用与首次相同的锁文件内容执行
`--finalize-existing`：它不安装、不下载、不改写 Python，只重新读取 ELF 解释器与
RPATH、跑受限 PROBE 与离线导入检查、按 `importlib.metadata` 审计全部已安装分发，
全部通过才写 `runtime.json`。它不会启用运行环境、不重启应用，也不替代后续集成验收。
若 conda 解析不出 `python=3.12` 与 `sysroot_linux-64=2.28` 的组合，会在
`conda_create` 阶段失败并保留求解日志，不会带着错误版本继续。

## 不在本次范围

本脚本不设置 `RESEARCH_TRANSLATION_RUNTIME`、不编辑 `runtime.env`、不重启应用，
也不做功能/解析验收；这些步骤由部署者负责。

2026-11-04 已在目标 CentOS 7 上执行：私有解释器为 Python 3.12.16 / glibc 2.28，
118 项锁定依赖均匹配，120 个已安装分发中仅额外包含安装工具 pip 与 wheel。
离线导入与服务账号导入检查通过，`runtime.json` 已生成；随后已接入应用，
`parser_ready=true`。核心应用仍使用宿主 glibc 2.17。本轮没有执行 PDF、模型或统计任务。

本机使用 systemd 219 的一次性服务运行安装任务，设置内存 1024M、CPUQuota 100%
和外层超时。219 的瞬态属性接口不接受 PrivateTmp，因此使用经过校验的单位文件，
没有依赖较新版 systemd 选项。确认退出状态为 0 后，已停止并移除一次性单位文件。

已知取舍：conda 的包缓存（`<miniforge>/pkgs`，脚本通过 `CONDA_PKGS_DIRS` 显式指向它）
是运行环境根之外唯一可能的写入；环境登记已关闭，pip 的临时文件被限制在 `<root>/tmp`。
