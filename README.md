# tiny-app

一款基于 Electron + React 的桌面无损压缩工具，支持：

- TinyPNG 图片压缩（PNG / JPG / JPEG）
- 音频压缩（MP3 / OGG / WAV，基于 ffmpeg）
- 压缩结果对比、备份还原、目录递归处理

---

## 功能特性

### 1) 图片压缩（TinyPNG）

- 支持多 API Key 管理（本地持久化）
- 支持 API Key 有效性检查与当月已用次数展示
- 单 Key 达到上限（429）后自动切换其他 Key
- 全部 Key 用尽时自动暂停，可补充 Key 后继续
- 保留压缩日志与统计（成功 / 跳过 / 失败 / 节省体积）

### 2) 音频压缩（ffmpeg）

- MP3：`64kbps`、单声道、`44.1kHz`
- OGG：`libvorbis`、`96kbps`、`44.1kHz`
- WAV：`pcm_s16le`、单声道、`22.05kHz`
- 若压缩后体积未减小，会自动跳过，不覆盖原文件

### 3) 对比与还原

- 压缩前自动备份原文件到同目录 `_tiny_backup/`
- 对比面板支持查看压缩前后体积与媒体预览
- 支持一键还原（将备份覆盖回原文件）

### 4) 路径处理

- 支持“添加文件”与“添加目录”
- 支持“递归子目录”开关
- 自动跳过 `_tiny_backup` 目录，避免重复处理备份文件

---

## 技术栈

- Electron 39
- React 19
- electron-vite
- UnoCSS
- ffmpeg-static
- axios

---

## 本地开发

### 环境要求

- Node.js 18+
- pnpm 10+
- macOS / Windows / Linux

### 安装依赖

```bash
pnpm install
```

### 启动开发环境

```bash
pnpm dev
```

### 代码检查与格式化

```bash
pnpm lint
pnpm format
```

---

## 打包构建

> 构建前会先执行 `electron-vite build`，再由 `electron-builder` 生成安装包。

### 通用构建

```bash
pnpm build
```

### 平台构建

```bash
# Windows
pnpm build:win

# macOS（x64 + arm64）
pnpm build:mac

# macOS 单架构
pnpm build:mac:x64
pnpm build:mac:arm64

# Linux
pnpm build:linux
```

### 仅输出解包目录

```bash
pnpm build:unpack
```

构建产物默认在 `dist/`。

---

## 使用说明

### 图片压缩

1. 打开“图片压缩”页签
2. 添加并校验 TinyPNG API Key
3. 添加图片文件或目录
4. 按需开启“递归子目录”
5. 点击“开始压缩”
6. 在“处理日志 / 压缩对比”查看结果，必要时可“还原”

### 音频压缩

1. 打开对应页签（MP3 / OGG / WAV）
2. 添加音频文件或目录
3. 点击“开始压缩”
4. 在“处理日志 / 压缩对比”查看结果，必要时可“还原”

---

## 目录结构（核心）

```text
src/
	main/                 # 主进程（IPC、压缩逻辑、文件处理）
	preload/              # 安全桥接层（window.api）
	renderer/             # 前端界面（React）
```

---

## 常见问题

### 1) TinyPNG Key 显示无效或超时

- 检查网络是否可访问 `api.tinify.com`
- 确认 Key 是否填写正确
- 若提示当月上限，可新增其他 Key 继续

### 2) 为什么有些文件被“跳过”

- 当压缩后体积不小于原文件时，程序会跳过并保留原文件

### 3) 备份文件在哪里

- 位于原文件同目录下的 `_tiny_backup/`

---

## 授权协议

本项目采用 **商业付费授权**：

- 个人用户或非公司主体可免费使用（仅限非公司场景）
- 公司、企业、机构或其他组织使用时，必须购买商业授权
- 未经授权，不得将本项目用于公司/组织的生产、经营或内部业务场景

如需商业授权，请联系 ：`siqijson@gmail.com`
