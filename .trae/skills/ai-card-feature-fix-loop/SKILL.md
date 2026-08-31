---
name: "ai-card-feature-fix-loop"
description: "When the user reports that an AI/Agent action shows a transient toast popup instead of an in-message-list status (e.g. \"Skill added/copied/saved\" via ElMessage that disappears in 3 seconds), diagnose the underlying cause and rebuild the action to surface the result inside the chat history with a clickable, inspectable, and trial-able card. Invoke when the user complains \"点击按钮之后只在悬浮弹窗告诉我结果\" / \"我不清楚添加得怎么样\" / \"要不要改我也不知道\" / \"要不要试一下也没有提示\" for any AI-driven action (create / save / copy / distill / convert)."
---

# AI Card Feature Fix Loop

When the user reports that an AI-driven action only surfaces a transient toast and they want richer feedback inside the message list, follow this loop.

## Symptoms

- Action triggers an `ElMessage.success/info/error` toast that auto-dismisses
- User reports "添加得怎么样我也不知道" / "要不要改我也不知道" / "要不要试一下也没有"
- User expects the action's outcome (artifact + status) to live inside the chat, not vanish in a toast
- User wants to inspect, edit, retry, or discard the artifact without starting a new conversation

## Root Cause Pattern

In Vue/React codebases, the typical culprit is:

```js
const onAction = async () => {
  try {
    const result = await api.doSomething()
    ElMessage.success(`已创建 ${result.name}`)   // ← only feedback
  } catch (e) {
    ElMessage.error('失败: ' + e.message)
  }
}
```

The result of `api.doSomething()` (or an AI-parsed JSON containing the artifact) is thrown away after the toast. The user never sees the artifact in the chat history.

## Fix Recipe (5 steps)

### 1. Push a status message into the message list first

Before kicking off the async work, push a placeholder message into the chat with a state field:

```js
const card = {
  id: genMsgId(),
  role: 'assistant',  // or 'user' depending on the action
  content: '正在分析 ...',          // visible text while loading
  actionCard: { status: 'loading', artifact: null, error: '' }
}
messages.value.push(card)
```

### 2. Update the same message's state across the lifecycle

Reuse the SAME message object through the lifecycle (`loading → ready → saving → saved | failed | discarded`). Avoid creating new messages per state — that clutters the chat.

```js
card.actionCard.status = 'ready'
card.actionCard.artifact = parsed
card.content = ''   // the card UI takes over once it's ready
```

### 3. Make fields editable so the user can revise

For any artifact with name / description / steps, expose them as `v-model` on the message:

```js
card.actionCardName = artifact.name
card.actionCardInstructions = artifact.instructions
```

User edits flow back into the same message; on save, send the latest values.

### 4. Provide 4 standard action buttons (not just 1)

| Button       | Purpose                                                         |
|--------------|-----------------------------------------------------------------|
| 💾 Save       | Persist artifact using current values (user may have edited)    |
| ▶ Try        | One-click trial: copy artifact into the input box for AI to execute |
| ✕ Discard    | Mark message as discarded (still in chat history but dimmed)     |
| (auto) Retry | If failed: show error + click-to-retry                           |

For "Try": push the artifact's instructions into `inputText.value` and focus the textarea, so the user presses Enter to execute.

### 5. CSS: scope card to the message, never break layout

```css
.action-card {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  max-width: 100%;          /* ← critical: don't overflow message column */
  box-sizing: border-box;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.action-card input,
.action-card textarea {
  width: 100%;
  box-sizing: border-box;
}
```

Add status variants via `:class` (`.action-card-ready`, `.action-card-saved`, `.action-card-failed`).

## Verification

After implementing:
1. Vite/esbuild compile must succeed (run `npm run build` if applicable)
2. The action button click MUST push a visible message in the chat, not just a toast
3. The card MUST be editable (try changing name and saving — new value persists)
4. The "Try" button MUST pre-fill the input box
5. The card MUST NOT overflow the message column even with very long artifact text

## Don't Do

- Do not put result info only in `ElMessage` / `Notification`
- Do not create new messages per state — mutate the same placeholder
- Do not skip the discard / cancel option
- Do not assume the user trusts the AI's first draft — always allow edit before save

## Related Anti-Patterns to Watch

| Symptom                                                | Likely Cause                              |
|--------------------------------------------------------|------------------------------------------|
| AI response brief, but user wanted to reference it later | `shouldKeepContext` filters out content under a length threshold |
| "深度思考" toggles itself back on after user disables  | Toggle handler forces `setEnabled(true)` when currently off   |
| Export tool runs when user just wanted inline markdown  | Tool description lacks "ONLY when user explicitly asks to save" guard   |

## Sanity Check: Why a Card > a Toast

| Toast                                              | In-Message Card                                        |
|----------------------------------------------------|--------------------------------------------------------|
| Disappears in 3 seconds                            | Persists in conversation history                      |
| Cannot inspect / edit / retry                      | Editable, retryable, discardable                       |
| Lost when conversation scrolls                     | Searchable / scrollable / referenceable                |
| Cannot show multi-step workflow status             | Shows `loading → ready → saved` lifecycle inline       |
| Forces user to remember the outcome                | Outcome is auditable later                              |

When in doubt, always default to the card.