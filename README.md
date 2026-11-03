# 课屿 · Keyu Desktop

Windows 开发预览版 0.1.2。当前应用窗口、安装包与本地数据标识仍沿用“网课助手 / CampusCourseDesktop”，以保持升级兼容。

原仓库规划完整保留在 [PRODUCT_PLAN.md](PRODUCT_PLAN.md)；它是历史规划，不是已实现功能清单。实际范围以本 README、使用说明及真实平台兼容性报告为准。

面向大学生的本地学习桌面应用。Electron + Vue 3 + TypeScript + Pinia + SQLite。

> **重要：这是可运行的开发预览版，不是已经通过三平台真实课程验收的正式版。**
> 三个平台的候选适配器已经接入同一任务引擎，但真实账号、课程目录、播放器、切章和完成状态仍需要本机逐项验证。模拟测试不代表真实平台兼容。不要用于无人值守的重要课程任务。

## 已实现

- 六个页面：学习首页、账号管理、我的课程、学习工作台、任务中心、记录与设置。
- 学习通 / 中国大学 MOOC / 智慧树三个候选页面适配器；无可靠结构时停止并提示。
- 同平台多账号独立持久化会话；每个平台一个执行通道，最多三个任务同时运行。
- 可见网页课程 / 章节读取、真实 HTML 媒体播放、章节身份核对、允许时顺序切章。
- 暂停 / 恢复 / 取消 / 排序、重启与休眠检查点、有限失败重试、单平台音频选择。
- 本地 SQLite、学习与休息提醒、托盘、脱敏诊断导出；无遥测、云端服务或自动更新。
- 严格分离本地播放结束与平台确认完成；累计播放时间和重叠去重时间分开展示。

## 交付位置

项目根目录：D:/Projects/web项目/campus-course-desktop

- 安装包：D:/Projects/web项目/campus-course-desktop/release/CampusCourseDesktop-Setup-0.1.2-x64.exe
- 源码压缩包：D:/Projects/web项目/campus-course-desktop/release/CampusCourseDesktop-Source-0.1.2.zip
- 文件校验值：D:/Projects/web项目/campus-course-desktop/release/SHA256SUMS.txt
- 免安装目录：D:/Projects/web项目/campus-course-desktop/release/win-unpacked（整个目录一起保留）
- 用户说明：D:/Projects/web项目/campus-course-desktop/docs/使用说明.md
- 兼容性报告：D:/Projects/web项目/campus-course-desktop/docs/真实平台兼容性报告.md
- 测试报告：D:/Projects/web项目/campus-course-desktop/docs/测试报告.md
- 开发说明：D:/Projects/web项目/campus-course-desktop/docs/开发与架构.md

## 开发

以下命令仅供源码开发；使用安装包不需要先配置开发环境。本机开发验证使用 Node 24.18 与 pnpm 12.4.1。

在项目根目录运行。依赖版本已固定，提交的 pnpm-lock.yaml 不应丢弃。该文件包含两个 YAML 文档：工具链锁定与应用依赖锁定；不要只保留第一段。

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm dist
```

如 Electron 下载受网络影响，可使用项目中的 scripts/ensure-electron.cjs。它仅从 Electron 官方 GitHub 发布下载固定版本，并按安装的 electron 包内 SHA-256 校验，再解压；不关闭 TLS 校验。

## 重建交付证据（开发者）

先完成构建，再运行各项检查；源码打包脚本会检查当前版本、安装包摘要、完整依赖锁文件和编译文件的一致性，拒绝拿旧版安装校验结果为新版打包。

```powershell
pnpm typecheck
pnpm exec vitest run --reporter=default --reporter=json --outputFile=reports/unit-results.json
pnpm build
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='reports/e2e-results.json'
pnpm exec playwright test --project=desktop --reporter=list,json
# 短时合成检查；如需两小时合成检查，先移除 CAMPUS_SOAK_MS
$env:CAMPUS_SOAK_MS='120000'
pnpm exec playwright test --project=soak --reporter=list
pnpm dist
node scripts/packaged-smoke.cjs
node scripts/install-smoke.cjs
node scripts/verify-release.cjs
python scripts/source-bundle.py
```

安装校验会创建专用临时安装目录，临时添加并删除测试账号备注、还原设置，然后卸载该测试安装并保留数据目录；发现已有安装会拒绝运行。升级校验可给 `install-smoke.cjs` 传入旧版安装包路径。0.1.1 已验证 0.1.0 → 0.1.1；本次验证 0.1.1 → 0.1.2；旧版安装包不嵌入新版源码 ZIP。不要对日常使用中的账号环境运行这些开发校验。

`reports/release-integrity.json` 记录依赖锁及程序文件摘要；它只证明构建文件一致，不证明真实平台或干净系统兼容。真实课程仍按兼容性报告人工验收。

## 明确不做

不自动答题、提交作业、代操作考试、伪造进度、绕过验证码 / 人脸验证 / 付费 / 平台限制。不支持学校云 / SPOC、智慧树特殊校内课、资料下载、云同步、会员支付、远程适配器更新。

## 数据与账号

正式版数据位于当前 Windows 用户的 AppData/Roaming/CampusCourseDesktop。SQLite 不保存密码、完整 Cookie 或访问令牌；网页登录由 Electron 的本地会话管理。课程地址中的明显凭据参数会被拒绝保存。数据目录仍属于敏感本机数据，不应打包上传。

请先阅读兼容性报告；只有完成真实课程验收并记录证据后，才能更改平台“待实测”标识。

## Git 版本交付

后续版本保留版本记录、测试证据和完整锁文件，以普通提交和版本标签推送到本仓库；不强制推送、不覆盖已有版本附件。Windows 安装包与源码 ZIP 作为 GitHub Release 附件，不进入 Git 源码历史。预览版使用 prerelease 标识，不自动安装更新。

发布前按开发说明完成校验，并执行 `python -B -m unittest discover -s tests/release -v` 检查上传文件与远端摘要校验边界。提交并推送后创建匹配 package.json 的 `v<版本号>` 标签。`python scripts/github-release.py --check` 只检查访问权限；`--publish` 要求干净工作区、远端标签对应当前提交、所有交付文件摘要匹配，先上传草稿并核验附件摘要，再发布预览版。凭据由 Git 凭据管理器提供，不写入源码、日志或发布文件。

## 许可证

沿用仓库既有 MIT License，完整条款见 [LICENSE](LICENSE)。第三方依赖与平台内容仍适用各自条款。
