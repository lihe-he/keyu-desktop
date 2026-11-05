# 课屿 · Keyu Desktop

工作区版本 0.1.5（开发中，尚未发布）；最近已发布的 Windows 开发预览版为 0.1.4。当前应用窗口、安装包与本地数据标识仍沿用“网课助手 / CampusCourseDesktop”，以保持升级兼容。

原仓库规划完整保留在 [PRODUCT_PLAN.md](PRODUCT_PLAN.md)；它是历史规划，不是已实现功能清单。实际范围以本 README、使用说明及真实平台兼容性报告为准。

面向大学生的本地学习桌面应用。Electron + Vue 3 + TypeScript + Pinia + SQLite。

> **重要：这是可运行的开发预览版，不是已经通过三平台真实课程验收的正式版。**
> 三个平台的候选适配器已经接入同一任务引擎，但真实账号、课程目录、播放器、切章和完成状态仍需要本机逐项验证。模拟测试不代表真实平台兼容。不要用于无人值守的重要课程任务。

## 0.1.5 个人课程读取修复（尚未发布）

0.1.4 扫码登录已获用户确认，但个人空间首先显示的是周课表，并非网课目录。进入平台自己的“课程 → 我学的课”后，复现了助手读取不到课程的问题。0.1.5 补充嵌套课程页的标题链接识别，避免把封面、教师或“课程已结束”状态当作课程名；小房子按钮改名为“打开学习通个人空间”，补充明确操作提示。

修复以脱敏结构和跨域 iframe 夹具回归验证；2026-11-05 第二候选在本机已导入 20 门真实课程，**课程打开与章节读取仍失败，真实播放尚未验证**。本机已有用户正式安装，不能为了安装测试卸载它或覆盖会话。0.1.5 完成安装校验前不创建版本标签、源码交付 ZIP 或 Release；0.1.4 的已发布附件保持不变。详情见 `docs/学习通课程读取修复.md`。

2026-11-05 第一候选复测仍无法导入另一套 v24 目录，且用户反馈扫码两次才进入。第二候选补充 `#stuCourseList` 识别及不保存签名的课程定位，打开时从当前账号可见目录取得临时入口；增加“手机已确认，核对登录”及更明确的跳转失败提示。用户确认一次扫码后点击该按钮可进入，随后已成功导入课程。课程打开时仍见加载失败和 HTTP 跳转拦截；自动登录跳转、重启登录保持、章节及播放未通过，不宣称问题全部解决。

第三候选已定位一处真实课程跳转：v24 入口返回 `mooc1.chaoxing.com/visit/stucoursemiddle` 的旧 HTTP 地址。第四候选对这一条主页面服务端重定向尝试一次同站点 HTTPS 访问；只有刚从当前目录取得的签名入口可触发，其他 HTTP 地址仍阻止，再次失败即停止。签名地址仅在内存中使用。HTTPS 公开端点能响应不等于已通过认证课程验收，真实章节与播放仍待核对。

## 0.1.4 扫码登录修复

学习通默认登录返回 HTTP 地址，被应用的 HTTPS 限制拦截；现在明确传入官方 HTTPS 个人空间入口。没有放开 HTTP 或修改登录凭据。官方公开页和受控导航测试通过；2026-11-04 用户已确认本次账号扫码登录成功，登录持久化与真实课程仍待验证。详情见 `docs/学习通扫码登录修复.md`。此为发布后验收记录，不改写既有 v0.1.4 标签或附件。

## 已实现

- 六个页面：学习首页、账号管理、我的课程、学习工作台、任务中心、记录与设置。
- 学习通 / 中国大学 MOOC / 智慧树三个候选页面适配器；无可靠结构时停止并提示。
- 同平台多账号独立持久化会话；每个平台一个执行通道，最多三个任务同时运行。
- 可见网页课程 / 章节读取、真实 HTML 媒体播放、章节身份核对、允许时顺序切章。
- 暂停 / 恢复 / 取消 / 排序、重启与休眠检查点、有限失败重试、单平台音频选择。
- 本地 SQLite、学习与休息提醒、托盘、脱敏诊断导出；无遥测、云端服务或自动更新。
- 严格分离本地播放结束与平台确认完成；累计播放时间和重叠去重时间分开展示。

## 已发布 0.1.4 的交付位置（不是 0.1.5）

项目根目录：D:/Projects/web项目/campus-course-desktop

- 安装包：D:/Projects/web项目/campus-course-desktop/release/CampusCourseDesktop-Setup-0.1.4-x64.exe
- 源码压缩包：D:/Projects/web项目/campus-course-desktop/release/CampusCourseDesktop-Source-0.1.4.zip
- 文件校验值：D:/Projects/web项目/campus-course-desktop/release/SHA256SUMS.txt
- 免安装目录：D:/Projects/web项目/campus-course-desktop/release/build-0.1.4/win-unpacked（整个目录一起保留）
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
pnpm exec playwright test --project=desktop '--reporter=list,json'
# 短时合成检查；如需两小时合成检查，先移除 CAMPUS_SOAK_MS
$env:CAMPUS_SOAK_MS='120000'
pnpm exec playwright test --project=soak --reporter=list
pnpm exec electron-builder --win nsis --x64 --config.directories.output=release/build-0.1.5
# 只复制新候选包；已有发布文件时禁止覆盖
if (Test-Path release/CampusCourseDesktop-Setup-0.1.5-x64.exe) { throw '目标安装包已存在，请核对，不要覆盖已发布文件。' }
Copy-Item release/build-0.1.5/CampusCourseDesktop-Setup-0.1.5-x64.exe release/
node scripts/packaged-smoke.cjs release/build-0.1.5/win-unpacked/CampusCourseDesktop.exe
# 访问官方未登录入口，不自动登录；打包校验使用独立临时目录
node scripts/public-entry-smoke.cjs release/build-0.1.5/win-unpacked/CampusCourseDesktop.exe
node scripts/install-smoke.cjs
# 任意校验失败时停止，不执行源码打包与发布
if ($LASTEXITCODE -ne 0) { throw '安装校验未通过，停止发布。' }
node scripts/verify-release.cjs release/build-0.1.5/win-unpacked
if ($LASTEXITCODE -ne 0) { throw '交付一致性校验未通过，停止发布。' }
python scripts/source-bundle.py
```

打包和安装校验使用专用临时账号目录，先核对隔离路径再操作，绝不使用日常登录会话。安装校验仍会创建并卸载临时安装，发现已有正式安装会拒绝运行。0.1.5 安装预检已拒绝运行，不可绕过保护或自动卸载用户正式安装。历史上仅验证 0.1.4 安装、同版本重装与卸载；0.1.3 → 0.1.4 跨版本升级未验收。0.1.3 的历史报告验证了 0.1.2 → 0.1.3，不可替代新版结果。0.1.3 及更早版本不识别隔离校验参数，不可传给当前安装脚本作旧版升级起点。

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
