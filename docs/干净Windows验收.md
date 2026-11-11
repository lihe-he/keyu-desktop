# 网课助手 0.1.5 · 干净 Windows 人工验收

本说明用于专用的 Windows 10 / Windows 11 x64 测试机或虚拟机。验收材料准备成功仅表示安装包已复制且摘要一致，不表示安装、启动或升级通过；不能替代 `install-smoke`、真实课程、真实两小时或账号隔离验收记录。

本轮分别验收 Windows 10 与 Windows 11。Windows Sandbox 使用与宿主对应的系统，不能用一份 Sandbox 结果代替两个系统；启动隔离环境本身也不代表完成验收。

## 准备测试环境

1. 使用独立测试机或干净虚拟机快照，记录 Windows 版本、构建号和 x64 架构。不要在日常电脑或用户正式安装上执行安装、升级、卸载。
2. 环境中没有 Node.js、Java、独立数据库或项目开发工具；确认“已安装应用”以及可用命令，记录实际检查结果。应用应该只依赖安装包自带运行时。命令不在 PATH 中不能单独证明未安装。
3. 确认没有“网课助手 / CampusCourseDesktop”安装项和运行进程。发现已有应用就改用新的干净快照，不卸载来历不明的安装，不结束用户进程。
4. 将验收目录复制到测试环境，例如 `C:\KeyuAcceptance\Materials`。测试机自行操作，宿主的日常安装和 AppData 不参与验收；不要映射宿主账号数据目录。
5. 对当前候选安装包运行以下只读命令，将输出与同目录 `SHA256SUMS.txt` 对照。两者相同只证明拿到了同一文件。

```powershell
Get-FileHash -LiteralPath 'C:\KeyuAcceptance\Materials\CampusCourseDesktop-Setup-0.1.5-x64.exe' -Algorithm SHA256
```

保持正常系统安全配置；若系统阻止运行，记录具体提示和候选摘要，不关闭安全功能来取得“通过”。本说明不要求真实网课账号、密码、扫码或验证码。

## 首次安装与实际启动

1. 双击当前候选 NSIS 安装包，按当前用户安装到测试专用目录，例如 `C:\KeyuAcceptance\Installed`。记录安装过程、最终目录、快捷方式和卸载项。关闭安装向导的立即启动选项，先准备独立测试会话。
2. 在测试环境 PowerShell 中生成一次 UUID，保存到事实表中。后续重装、启动及检查均复用这个 UUID；不要每次生成新的值，否则无法证明数据保留。

```powershell
$testProfileId = [guid]::NewGuid().ToString()
$testProfileRoot = Join-Path -Path $env:TEMP -ChildPath ('CampusCourseDesktop-verification\' + $testProfileId)
$testProfileId
$testProfileRoot
```

3. 使用这个本地启动参数启动已安装程序。不要双击普通快捷方式来进行数据保留测试，普通快捷方式不会携带测试会话标识。

```powershell
Start-Process -FilePath 'C:\KeyuAcceptance\Installed\CampusCourseDesktop.exe' -ArgumentList ('--campus-verification-profile=' + $testProfileId) -WindowStyle Normal
```

4. 确认出现实际应用窗口，版本为 `0.1.5`，六个本地页面可打开，没有缺失 Node、Java、SQLite 原生模块或其他运行时的错误。平台未登录页面的网络错误应单独记录，不当成已通过真实平台验收。
5. 在应用“账号管理”中添加一个仅作本地测试的备注，例如“干净安装临时账号”；即使打开平台登录页，也不要登录。返回设置，改变一个普通偏好，例如“全部静音”，记录改变前后的值。不要创建学习任务、播放课程或提交平台内容。
6. 从应用自己的“完全退出应用 → 保存并退出”正常退出。确认窗口及托盘进程已退出，记录测试会话中的数据库文件存在；只核对文件存在，不导出或读取其内容。

```powershell
Test-Path -LiteralPath (Join-Path -Path $testProfileRoot -ChildPath 'campus.sqlite3')
```

## 同版本重装

1. 确认应用已完整退出后，再运行同一个 `0.1.5` 候选安装包，安装到同一测试目录，不先卸载。
2. 使用前面保存的 UUID 再次启动程序。若重新打开了 PowerShell，请手工恢复事实表中的值，不运行 `NewGuid()`。

```powershell
$testProfileId = '在此填入之前保存的 UUID'
$testProfileRoot = Join-Path -Path $env:TEMP -ChildPath ('CampusCourseDesktop-verification\' + $testProfileId)
Start-Process -FilePath 'C:\KeyuAcceptance\Installed\CampusCourseDesktop.exe' -ArgumentList ('--campus-verification-profile=' + $testProfileId) -WindowStyle Normal
```

3. 核对实际版本、临时账号备注、设置值及卸载项。原备注和设置仍在才记录保留通过；不要以窗口出现或目录存在代替数据核对。
4. 正常保存退出。若安装器或程序出错，记录原样结果，不强制结束进程、不删除数据库来继续测试。

## 0.1.4 → 0.1.5 跨版本升级

这一项在另一个干净快照或专用测试机执行，避免把已装 `0.1.5` 的降级当作升级验收。

1. 从项目的 [v0.1.4 官方 Release](https://github.com/lihe-he/keyu-desktop/releases/tag/v0.1.4) 在测试环境取得 `CampusCourseDesktop-Setup-0.1.4-x64.exe` 及该版本 `SHA256SUMS.txt`，核对其已发布摘要。验收材料准备脚本不会复制、改写或下载旧附件。
2. 安装 `0.1.4` 到测试专用目录，例如 `C:\KeyuAcceptance\UpgradeInstalled`。生成一个新的升级测试 UUID并保存；`0.1.4` 已支持该测试参数，不使用 `0.1.3` 或更早版本作为此流程起点。
3. 使用同样的 `--campus-verification-profile=<UUID>` 参数启动 `0.1.4`，记录实际显示的版本，添加纯测试账号备注“升级临时账号”，改变并记录普通设置，正常保存退出。
4. 确认应用已退出后，运行当前 `0.1.5` 候选安装包，选同一安装目录，不先卸载旧版。
5. 复用升级测试 UUID 启动已安装程序，确认版本从 `0.1.4` 变为 `0.1.5`，临时账号备注和设置仍在。记录旧安装包、新候选各自摘要以及实际起止版本。两个版本号不同且保留检查通过，才认定本项升级通过。
6. 正常保存退出，按下节卸载测试安装。整个流程只使用测试备注及测试临时会话，不复制日常数据库、Cookie、账号或课程。

## 卸载与测试数据保留

首次安装/重装场景与升级场景分别记录，不相互代替。

1. 完整退出测试应用，从测试环境“已安装应用”中卸载本次测试安装。确认选中的是唯一的测试安装，且其目录与事实表一致。
2. 等卸载结束，检查测试安装目录中的 `CampusCourseDesktop.exe` 已不存在，卸载注册项已消失；不能只看卸载窗口关闭。
3. 用前面的 `Test-Path -LiteralPath ...\campus.sqlite3` 核对同一个 UUID 下的测试数据库仍在，记录实际布尔结果。安装目录和测试会话目录是两处路径。
4. 如果数据被删除、卸载项残留或程序仍在，记录失败以及具体文件/窗口现象。不要删除、搬移、清理或伪造文件来让检查变成通过。
5. 保存事实记录后，测试机/虚拟机可按其自身管理流程还原快照。不要把测试数据库或完整 AppData 放进 Git、验收材料或 Release。

## 每个系统单独填写事实记录

复制以下表格，分别保存 Windows 10 与 Windows 11 的记录。空白保持“待测”；每项填写“通过 / 失败 / 未执行”及依据，不填写账号、姓名、学校、真实课名、Cookie 或鉴权 URL。

| 基本事实 | 实际值 |
|---|---|
| 测试日期与测试者 | 待填写 |
| Windows 产品、版本、构建号、x64 | 待填写 |
| 测试机 / VM及干净快照来源 | 待填写 |
| Node / Java / 数据库 / 开发工具检查方式与结果 | 待填写 |
| 测试前无日常安装、无运行进程的确认 | 待填写 |
| 当前候选文件名与 SHA-256 | 待填写 |
| 安装目录 | 待填写 |
| 首次安装测试 UUID 与临时目录 | 待填写 |
| 升级旧包文件名与已发布 SHA-256 | 待填写 |
| 升级实际起止版本、UUID 与目录 | 待填写 |

| 验收项目 | 结果 | 事实依据或错误现象 |
|---|---|---|
| 首次当前用户安装、快捷方式、卸载项 | 待测 | 待填写 |
| 无开发环境下实际窗口启动、显示正确版本 | 待测 | 待填写 |
| 六个本地页面可用，无运行时/原生模块错误 | 待测 | 待填写 |
| 固定 UUID 下创建纯测试备注与改变普通设置 | 待测 | 待填写 |
| 正常保存退出、测试数据库存在 | 待测 | 待填写 |
| 0.1.5 同版本重装保留测试备注与设置 | 待测 | 待填写 |
| 0.1.4 → 0.1.5 升级、版本变化与测试数据保留 | 待测 | 待填写 |
| 首次安装场景卸载后 EXE / 注册项消失 | 待测 | 待填写 |
| 首次安装场景卸载后同 UUID 数据库保留 | 待测 | 待填写 |
| 升级场景卸载后 EXE / 注册项消失 | 待测 | 待填写 |
| 升级场景卸载后同 UUID 数据库保留 | 待测 | 待填写 |
| 测试期间未登录真实账号、未触碰日常安装 | 待测 | 待填写 |

附图只保留纯测试窗口、版本和错误信息。人工记录可以作为所述测试环境的证据，但不能改写为本机 `install-smoke.json` 自动通过结果，也不能证明三平台真实课程或两小时运行已通过。

## 开发者准备验收材料

构建完成后，显式指定本轮候选安装包和 `release` 内尚不存在的绝对目标目录，例如：

```powershell
& 'D:\Projects\web项目\campus-course-desktop\scripts\prepare-acceptance-kit.ps1' -InstallerPath 'D:\Projects\web项目\campus-course-desktop\release\candidate-0.1.5-r5\CampusCourseDesktop-Setup-0.1.5-x64.exe' -OutputDirectory 'D:\Projects\web项目\campus-course-desktop\release\acceptance-0.1.5-r5'
```

准备脚本仅复制明确传入的当前版本 x64 安装包、此说明，并写 SHA-256 清单与材料说明。路径须在本项目 `release` 内，拒绝已有目标、特殊设备名、符号链接和重解析点；不覆盖附件，不安装、卸载、启动 GUI、更改设置、读取账号数据或生成源码 ZIP / 标签 / Release。失败时不删除或搬移任何目录；核对后改用新的输出目录。
