# 界面与流式：改动说明

## 一、这个仓库现在自带哪些东西

- `webui/src/styles.css`：面板完整样式，构建时以 `?inline` 打进 `ui.js`，扩展加载时注入 `<style id="siye-research-styles">`。
  颜色全部取主程序的 `--siye-*` 主题变量（`--siye-ink`、`--siye-line`、`--siye-brand-ink` 等），带同色系兜底值；暗色主题会跟着主程序自动切换，不需要另写一套。
- `webui/dev/`：不依赖主程序的预览台，三种取数方式：
  - `npm run preview:panel`：Vite 开发服务器（默认 5288），mock API 走中间件；
  - `npm run preview:static`：构建成 `.preview/site` 的静态页面，用 `file://` 打开（端口被占用或被系统拒绝时用这个）；
  - `npm run shot`：无头 Edge 截图，支持 `?empty=1`、`?running=1`、`?stream=1`，`#dark` 切暗色。
- 面板结构变化：用户问题显示在回答上方；回答顶部是「本轮依据」证据条（资料数、正文/评论/字幕读完比例、未读完提示）；正文引用变成可点的角标，底部是按正文出现顺序编号的来源列表（平台、标题、读取进度）；会话历史停靠在面板右侧、与对话同层并挤压对话（窄屏才改为浮层），分「最近 / 已归档」两组，可搜索、可归档；输入框左下角把模型和推理等级合成一个控件（`deepseek-flash · 高`），点开是模型列表、自定义模型和推理等级分段选择；输入框右下角用半圆环显示上下文占用百分比，悬停查看绝对 token；等待阶段有实时步骤、计时和骨架屏；输入框按内容自动增高。

## 二、流式的宿主契约（主程序已接入）

主程序提交 `2ab995a`（`AI-STREAM-20261018`）已实现下面三条，扩展不需要再判断宿主版本：

| 约定 | 宿主行为 |
| --- | --- |
| 任务 payload 带 `stream: true` | 分析阶段启用流式；旧宿主不发这个字段时扩展自动退回整段返回 |
| 收到 `{"type":"delta","text":"..."}` 追加到任务 `partial`，`{"type":"delta_reset"}` 清空 | 定稿、失败、取消时清空；`partial` 只留在内存，不写会话历史，最多保留前 4 万字 |
| `GET /api/research/jobs/{id}` 返回 `partial` | 扩展按它渲染实时正文，`document` 一到就换成校验过的版本 |

面板轮询间隔是 500ms，因此不需要额外的推送通道；以后要换成 SSE，只需把 `useQuery` 的轮询换成事件源，`partial` 字段可以保留。

会话归档走主程序 `POST /api/research/spaces/{space_id}/conversations/{conversation_id}/archive`（body `{"archived": true|false}`），标记存在历史目录的 `conversations.json`，只影响列表分组，不删记录。模型切换复用已有的 `PUT /api/research/config`：同服务改模型不需要重新填 Key。

## 三、验证方式

```powershell
python -m pytest tests -q                 # 84 passed
cd webui; npm run build                   # tsc + vite，产物 dist/ui.js
cd webui; npm run preview:static          # 端口不可用时构建静态预览
cd webui; npm run shot -- --url "file:///.../.preview/site/dev/index.html#dark" --out ../.preview/dark.png
```

`tests/test_streaming.py` 覆盖 SSE 拼装、工具调用增量合并、`stream_options` 被拒后的回退、增量事件与 `delta_reset` 的顺序，以及「未开启流式时不产生任何 delta 事件」的兼容性。主程序侧的事件落库、清空与历史不落盘由 `tests/test_research.py` 覆盖。

## 四、上下文预算与自动压缩

- 窗口按模型名取：DeepSeek／Gemini 1M、GPT 400k、Claude 200k，其它 128k（`siye_ai/context_window.py`）。
- 软阈值是窗口的 55%、硬阈值 85%。超过软阈值时把已读证据分批交回同一模型压成事实笔记，再继续研究。
- 单段超长证据按批大小切片，不再因为一段读不完就整轮失败。
- 压缩调用本身被服务拒绝时先减半重试，仍不行就保留原文截断继续，步骤摘要会写「有证据按原文截断」。
- 界面右下角的半圆环用同一张窗口表估算百分比，悬停可看绝对 token。

## 五、这一轮没做的事

- Anthropic（`claude_agent_sdk`）路径仍是非流式，只在每条 AssistantMessage 完整到达后更新。
- 主程序 `webui/src/index.css` 里仍有旧的 `.space-research-*` 面板规则（约 35 处）。扩展样式优先级更高，已在 `styles.css` 顶部显式复位会叠加的 `display`／`gap`／`margin`；这些旧规则可以下一步整体退休，但需要主程序侧做视觉回归。
- 图片理解：小红书图文笔记的封面和配图还没进资料清单，`research_documents.py` 只处理文本、评论和字幕。
- `@` 指定作用域：目前一次只能对整个空间提问，不能只挑几条链接。
- 会话标签页、斜杠指令：属于交互形态升级，等流式和证据面板稳定后再做。
