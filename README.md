# 四野 AI 研究助手

四野的可选官方扩展。用户在「设置 → 扩展管理」下载、开启或卸载。基础四野不包含模型 SDK 或 Claude 运行程序。

运行程序只接收当前任务的资料、模型配置和最近问答，不读取四野数据库、平台登录资料或笔记编辑器。JSON 行协议版本为 1；资料抓取、任务取消、历史持久化、密钥加密和笔记写入由四野提供。界面使用四野提供的 React 实例、查询和翻译环境及笔记桥接接口。

## 安装和使用

需要支持扩展管理的四野主程序（版本 1.2.0 及以上，2.0.0 之前），目前支持 Windows x64。在四野中进入「设置 → 扩展管理」，下载 AI 研究助手并开启，然后配置自己的模型服务。首次安装默认关闭。

正式安装包见 [GitHub Releases](https://github.com/KellenGO/SiYe-AI/releases/latest)，用户通过四野的扩展管理安装。关闭扩展结束正在运行的 AI 任务；卸载默认保留配置和聊天记录，空间资料及笔记保留。

## 开发和验证

Python 3.11+，按 pyproject.toml 安装依赖；webui 内运行 npm ci。Python 测试用 python -m pytest tests；界面用 npm run build。模型测试只用模拟服务，不调用真实付费模型。

## Windows 发布

运行 python scripts/build.py，输出 dist/SiYe-AI-Windows-x64.zip 及 SHA256 文件。用户无需安装 Python 或 Node。包内 extension.json 声明插件版本及四野版本范围。GitHub Release 标签必须与扩展版本一致，正式下载来源固定为 KellenGO/SiYe-AI。

首次安装默认关闭；开启后在空间显示 AI 入口。停用结束正在进行的任务，保留配置和历史；卸载可以单独选择清除 AI 数据。可选视频转写由四野的资料获取能力提供，仍按需安装。

## 许可

保留继承代码的项目许可证与第三方运行程序许可说明，见 LICENSE 及构建产物中的 agent_runtime。
