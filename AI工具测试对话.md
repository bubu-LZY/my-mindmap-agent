# AI 工具测试对话（可直接复制）

> 使用方式：先打开一个用于测试的思维导图，然后把下面任一条“测试句”发给 AI。  
> 标注“只读/无副作用”的工具可直接测；标注“会修改”的会改动当前导图，建议新建测试导图。

## 1. 导图与文件

- `generate_mindmap`：请根据以下内容生成一张思维导图：AI 学习分为数据、模型、训练、推理四部分。
- `get_mindmap_content`：读取当前思维导图的完整内容。
- `get_mindmap_info`：当前导图有多少节点、最大深度是多少？
- `save_mindmap`：保存当前导图。
- `new_mindmap`：新建一个空白思维导图。
- `import_file_as_mindmap`：把我桌面的 `笔记.md` 导入成思维导图。
- `merge_mindmap_files`：把 `参考知识.smm` 合并到当前导图的“资料汇总”节点下。
- `rename_mindmap_file`：把当前导图文件改名为 `AI 学习笔记.smm`。
- `list_directory`：列出当前导图所在文件夹的内容。
- `find_local_file`：帮我找到文件名为 `产品规划` 的本地文件。
- `read_mindmap_file`：读取 `C:\我的mindmap\参考知识.smm` 的完整内容。
- `delete_local_file`：删除桌面上的 `旧版本.smm`（删除前向我确认）。

## 2. 节点查询与定位

- `search_nodes`：找出所有包含“模型”两个字的节点。
- `select_node`：选中当前导图的所有终末节点。
- `focus_node`：定位到“机器学习”这个节点。
- `get_node_detail`：查看当前选中节点的 uid、文本、子节点和样式。
- `read_node_subtree`：读取“深度学习”节点的完整子树内容。
- `query_node_styles`：找出当前导图中所有加粗的节点。

## 3. 节点增删改与结构

- `expand_node`：给当前选中节点添加三个子节点：定义、原理、应用。
- `add_child_nodes`：给“机器学习”添加两层子节点，第一层是监督学习和无监督学习。
- `update_node_text`：把 uid 对应的节点文本改成“大语言模型”。
- `delete_node`：删除当前选中节点。
- `insert_parent_node`：在当前选中节点上方插入父节点“AI 基础”。
- `set_node_style`：把当前选中节点设为红色加粗。
- `batch_text_style`：把整张导图中所有【】内容加粗变蓝。
- `batch_node_actions`：把“代表菜品”整支加粗，并把它的终末节点变绿色。
- `find_replace_text`：把导图中所有“AI”替换为“人工智能”，替换前给我预览。
- `summarize_node`：给当前选中节点添加概要“本分支讲模型训练”。
- `move_node`：把“强化学习”移动到“机器学习”下面。
- `batch_move_nodes`：把选中的 5 个节点批量移动到“待整理”节点下。
- `duplicate_nodes`：复制当前选中节点到根节点下方。
- `sort_children`：把当前节点的子节点按文本顺序排序。
- `merge_nodes`：合并当前选中的多个节点。

## 4. 视图与样式

- `change_layout`：把当前导图切换为思维导图布局。
- `set_theme`：把当前导图切换为深色主题。
- `switch_view`：切换到大纲视图。
- `zoom_control`：把画布缩放到 100%。
- `format_painter`：把当前节点的格式刷到其他选中节点。
- `associative_line`：给“机器学习”和“深度学习”之间添加一条关联线。
- `outer_frame`：给当前选中节点及其兄弟节点添加外框。
- `set_node_note`：给当前选中节点添加备注“这是重点，考试常考”。

## 5. 撤销与导出

- `undo`：撤销上一步操作。
- `redo`：重做刚才撤销的操作。
- `export_mindmap`：把当前导图导出为 Markdown 文件。
- `export_subtree`：把当前选中分支导出为 SVG 图片。
- `export_to_markdown`：把整个导图导出为 Markdown。
- `export_mindmap_pdf`：把整个导图导出为 PDF。
- `export_outline_pdf`：把大纲视图导出为 PDF。
- `clear_mindmap`：清空当前导图（执行前要向我确认）。

## 6. 搜索、网页与知识库

- `search_web`：搜索“2026 年大模型最新进展”。
- `read_webpage`：读取 https://example.com/article 的正文。
- `get_location`：我现在大概在哪个城市？
- `search_knowledge_base`：在所有本地导图中搜索“艾宾浩斯遗忘曲线”。
- `semantic_search`：用语义搜索找出和“知识管理”最相关的本地节点。
- `find_related`：找一下和“学习效率”相关的本地内容和关联建议。

## 7. 本地文档与 OCR

- `read_local_file`：读取我拖入的 PDF 文件全文。
- `retrieve_local_file`：只检索我拖入的 Word 文档里和“复习计划”最相关的内容。
- `read_node_image`：识别当前节点图片中的文字内容。

## 8. 复习与挖空

- `add_to_review`：把当前选中节点加入复习计划。
- `get_review_schedule`：查看我未来 7 天的复习安排。
- `get_today_review_status`：我今天有哪些要复习的内容？
- `complete_review_task`：把今天到期的这个复习项标记为记住了。
- `delete_review_plan`：删除当前导图的全部复习计划（先确认）。
- `toggle_cloze_visibility`：隐藏当前导图所有挖空答案。
- `list_cloze_nodes`：列出当前导图所有带挖空的节点。
- `clear_cloze`：清除当前导图全部挖空标记。
- `ai_cloze`：给当前选中节点做智能挖空。
- `ai_cloze_full_map`：对整张导图做全文挖空。

## 9. AI 生成与改写

- `ai_continue_children`：给当前节点续写 3 层子节点，参考资料不需要。
- `ai_recite_rewrite`：对当前节点做背诵改写，简写要短，保留原意，不要生硬谐音。
- `ai_quiz`：根据当前导图生成 10 道自测题，保存为新导图。
- `ai_quiz_append`：给当前选中节点追加 1 道题，答案和解析默认隐藏。
- `parallel_ai_workers`：把“代表菜品”的 6 个子节点分成 6 个并行子任务，每个生成 2 层续写。
- `audit_mindmap`：诊断当前导图结构有什么问题。
- `refactor_mindmap`：先 dry-run 诊断当前导图，不要直接修改。
- `reorganize_mindmap`：一键整理当前导图，并保存为新的导图文件。
- `research_to_mindmap`：研究“番茄工作法”并生成一张带来源的导图。

## 10. 飞书、微信与消息推送

- `upload_to_feishu`：把当前导图上传到飞书。
- `upload_mindmap_to_feishu_doc`：把当前导图转成飞书在线文档。
- `upload_file_to_feishu`：把桌面上的 `笔记.pdf` 上传到飞书。
- `feishu_list_files`：列出飞书云文档根目录的文件。
- `feishu_get_doc_content`：读取飞书文档 `xxxxx` 的正文。
- `feishu_delete_file`：删除飞书云文档里的 `旧文件.docx`。
- `feishu_rename_file`：把飞书云文档里的 `未命名` 改成 `学习笔记`。
- `send_feishu_message`：把“今天任务已完成”发送到飞书。
- `send_wechat_message`：把“测试消息”发送到微信。
- `send_feishu_image`：把桌面 `导图.png` 发送到飞书。
- `send_wechat_image`：把桌面 `导图.png` 发送到微信。
- `send_feishu_file`：把 `复习计划.pdf` 发送到飞书。
- `send_wechat_file`：把 `复习计划.pdf` 发送到微信。

## 11. 元能力与其他

- `activate_tools`：激活和“复习”有关的工具。
- `context_window`：当前模型支持的上下文窗口是多少？
- `memory`：保存一条长期记忆：我喜欢节点文字尽量简短。
- `list_references`：检查当前导图里的 @文件 和 #节点 引用是否有失效。
- `scheduled_task`：创建一个每天晚上 21:00 提醒我复习的定时任务。

---

# 综合复杂任务测试

## 综合任务 A：知识库学习闭环

请执行以下任务并分步完成：

1. 用 `search_web` 搜索“费曼学习法”。
2. 用 `generate_mindmap` 生成一张包含“定义、步骤、适用场景、误区”的导图。
3. 用 `audit_mindmap` 诊断结构问题。
4. 用 `ai_continue_children` 给 4 个主要分支各续写 2 层。
5. 用 `ai_cloze_full_map` 对整张图挖空。
6. 用 `add_to_review` 把全部终末节点加入复习计划。
7. 用 `export_outline_pdf` 导出大纲 PDF。

## 综合任务 B：多文件整理与推送

请执行：

1. 读取桌面上的 `学习资料.pdf` 中和“复习”有关的内容。
2. 把结果整理成一张新导图，命名为“复习方法整理”。
3. 对这张导图执行 `refactor_mindmap` 的 dry-run，然后应用安全修复。
4. 给每个一级节点生成 1 道自测题，追加到节点下。
5. 把整理后的导图上传到飞书，并发送一条文字消息说明已完成。

## 综合任务 C：全图样式与终末节点批量操作

请执行：

1. 一次性选中当前导图的全部终末节点。
2. 把终末节点文字颜色设为绿色。
3. 找到所有包含“模型”的节点，并把“模型”两个字加粗。
4. 给根节点的直接子节点添加外框。
5. 检查整张导图是否有空节点、过长节点和重复兄弟节点，并输出诊断结果。

## 综合任务 D：背诵改写与自测

请执行：

1. 对“记忆方法”分支下的所有节点做背诵改写。
2. 原文字较短的节点必须保留原文字，不要改长。
3. 不要为了谐音而谐音，优先首字串联和语义分组。
4. 改写后给该分支的父节点生成记忆概要。
5. 再根据该分支生成 5 道自测题并追加到对应节点下，答案和解析默认隐藏。
