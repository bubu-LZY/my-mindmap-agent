---
name: desk-calendar-manual-sync
description: 手动把 my-mindmap agent 的复习计划同步到 desktop_todo_Calendar，并带回勾选状态。当用户说“手动同步复习计划到桌面日历 / 同步到 desktop_todo_Calendar / 刷新日历复习任务”时使用。
---

# 手动同步复习计划到 desktop_todo_Calendar

## 目标

把 my-mindmap agent 中的复习计划（未来待复习任务）写入 desktop_todo_Calendar，同时：

- 不重复添加同一天、同一标题的任务。
- 只同步由 my-mindmap agent 创建的任务，标题统一使用 `[MM复习]` 前缀。
- 删除 desktop_todo_Calendar 里的任务时，不删除 my-mindmap agent 的复习计划。

## 前置条件

1. my-mindmap agent 已配置 desktop_todo_Calendar 的 MCP 服务。
2. desktop_todo_Calendar 正在运行，MCP 服务已开启。
3. 用户已在 my-mindmap agent 设置里填写 desktop_todo_Calendar 的 Token。

## 执行步骤

1. 获取复习计划：

   调用内置工具：

   - `get_review_schedule`，参数建议：

     ```json
     {
       "start_date": "<今天 YYYY-MM-DD>",
       "end_date": "<未来 31 天的日期 YYYY-MM-DD>"
     }
     ```

   它会返回待复习条目，每条含 `title` 和 `date`。

2. 确认桌面日历 MCP：

   调用 `list_mcp_servers`，找到名为 `desktop_todo_Calendar` 的 MCP 服务。

3. 查询已有任务去重：

   调用 MCP 工具：

   - server：`desktop_todo_Calendar`
   - tool：`query_tasks`
   - arguments：`{ "range": "all" }`

   得到已有任务后，建立 `日期::标题` 集合。

4. 只添加缺失任务：

   对每条复习计划：

   - 标题：`[MM复习]{title}`
   - 日期：复习日期
   - 如果 `日期::标题` 已存在，跳过。
   - 否则调用 MCP 工具 `add_task`：

     ```json
     {
       "title": "[MM复习]导论",
       "date": "2026-09-03",
       "isImportant": false
     }
     ```

5. 汇报结果：

   - 已同步多少条。
   - 跳过多少条重复项。
   - 提醒用户打开 desktop_todo_Calendar 查看。

## 关键约束

- 不要删除 desktop_todo_Calendar 中已有的 `[MM复习]` 任务，除非用户明确要求清理重复。
- 不要使用旧的自定义工具 `micaagenda`；它已被移除。
- 不要重复调用 `query_tasks` 多次；先一次 `range=all` 拉全量再判断。
- 日期格式必须为 `YYYY-MM-DD`。
