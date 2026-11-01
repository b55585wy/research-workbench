# 阅读摘录与资料管理

v0.21 补齐阅读和资料管理的基础路径。参考 Zotero 的[阅读与笔记流程](https://www.zotero.org/support/pdf_reader)
及[回收站流程](https://www.zotero.org/support/collections_and_tags#trash)，不是宣称与其全部功能对等。

## 实际复用

直接使用已安装的 PDF.js6.4.299 TextLayer 实现文字选择，沿用 PDF.js 页面渲染、
已有笔记编辑器、来源页码/归一化矩形、PNG摘录和版本化元数据接口。
Zotero Reader 源码单独开放且可构建网页版本；其依赖包括 React 和自己的 PDF.js
构建。本轮没有复制 Zotero 源码，也没有部署完整 Zotero、RSpace 或其他ELN。
来源核对记录：E:/research-workbench-pilot-20261030/reader-library-v1/REUSE-REVIEW.md。

## 阅读流程

划选 PDF 文字后点击“选中文字加入笔记”，文字和当前来源进入可见草稿，明确保存
后才持久化。框选图片后立即显示笔记栏和未保存预览，点击“保存图片摘录”才生成
实际笔记与PNG，保存结果可在笔记中找到。重新打开笔记可回到来源页和区域。
更换选区不会静默覆盖已有草稿。扫描页没有文字层时仍可框选图片；本轮不提供OCR。
文字使用原有单一外接矩形锚点，不声称逐字符、多栏或跨页精确高亮。

## 笔记删除

普通删除仍可恢复。已删除列表增加“彻底删除”，需单独确认，移除当前工作区的
原始/现行正文、富文本、该笔记的图片摘录和摘录标注；独立上传图片及其他笔记保留。
保留不含正文的不可恢复标记和引用ID，使已完成任务的引用继续成立，同时阻止旧
保存/恢复请求复活笔记。历史对话中的引用副本、用户导出和备份不连带清理；这不是
磁盘安全擦除功能。文件清理失败会明确报告待重试，原请求可继续清理，启动时亦
恢复待完成清理；不会将未完成的图片清理报告为成功。

## 论文管理

论文行的可见操作按钮和右键菜单提供重命名、移入回收站。重命名只改变显示名称，
不修改原PDF字节或文件名。回收站恢复同一ID、笔记及附件。有关联研究时先解除关联，
有活动任务时先完成或停止，避免删除破坏正在使用的来源。本轮不提供论文物理清空。

## 接口与存储

- GET /api/v1/documents/trash：items 为原七字段文献 + revision/deleted_at。
- DELETE /api/v1/documents/{id}、POST .../{id}/restore：request_id + expected_revision；
  返回同一回收站条目，恢复后的 deleted_at 为 null。
- POST /api/v1/documents/{doc}/notes/{note}/purge：同一版本化请求；返回
  {id,document_id,purged:true,files_removed:true}，旧笔记来源返回 note_purged410。
- 请求重用不同内容、旧版本、活动笔记、错误归属均拒绝。文件清理失败503允许原样重试。
- schema13→14只新增 document_trash 和 purged_notes；未执行用户动作时，原28张表
  及原始文件保持不变。旧接口和统计配方保留，未来schema版本拒绝打开。

具体行为和失败场景以验收记录为准，不以页面出现了按钮作为完成标准。
