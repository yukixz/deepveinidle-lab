# 部署与发布

[本地开发](development.md) · [当前状态](status.md)

## GitHub Actions 双通道发布

日常 `pull_request` 执行完整 `release:check`，不接收部署凭证；`main` push 完成完整检查与打包后通过 Wrangler `--branch preview` 发布至 `https://preview.dvi-lab.pages.dev`。正式 GitHub Release 的 `published` 事件发布生产，排除预发布版本，标签须为 `v${package.json.version}` 且为正式三段版本，提交须属于 `main` 历史。草稿、标签 push 和普通 main push 不发布生产。两个工作流均只部署检出的确定提交，不自动修改版本或回写源码。

Preview 与生产 CI 的两次线上浏览器验收均显式传入 `--analytics exclude`，仅在隔离测试浏览器中用空脚本替代 `https://static.cloudflareinsights.com/beacon.min.js`（含版本路径及查询参数），不执行或验证其上报。线上 HTML、统计设置与应用代码不变；HTTP 资源／HTML 一致性检查照常执行，其他浏览器警告、异常及资源错误仍严格失败。JSON、报告和 Actions 摘要标明统计模式及实际替代次数；CI 成功不证明访问统计正常。手工 `release:verify` 默认 `--analytics live`，可显式选择模式，无效值拒绝执行。CI 另用受控浏览器专项验证：排除模式不执行统计脚本、正常模式仍执行、其他脚本及其错误不被吞掉。

每个部署在同一 job、同一 runner 内依次执行检查、打包、上传、精确部署地址验收及通道固定域名验收；线上全部通过才表示发布成功，Preview 不代替生产证据。环境固定为 Ubuntu 24.04、Node 24.13.0、pnpm 10.11.0、Wrangler 4.162.0，Chromium 使用项目固定的 playwright-core 安装。操作系统镜像仍可能更新，实际环境及浏览器摘要以本轮证据为准。候选输入包含 `.github/` 及 CI 配置。

Preview 和生产使用独立并发组，运行中的部署不自动取消。Preview 上传前核对远端 main，过时任务跳过部署并明确输出；生产上传前读取 Pages 当前生产提交，拒绝版本倒退及相同版本不同提交，允许相同版本相同提交重跑；当前生产来源无法核验时明确失败，不推定可覆盖。并发等待可能合并待运行事件，不保证每个中间提交都上线。

仓库管理员须创建 `preview`、`production` Environments，各配置 Secret `CLOUDFLARE_API_TOKEN` 和 Variable `CLOUDFLARE_ACCOUNT_ID`。在 Cloudflare API Tokens 创建 Custom Token，权限为 `Account → Cloudflare Pages → Edit`，Account Resources 选择 `Include → Specific account → Dazzy Ding`，Client IP 过滤留空；如设置到期日须到期前轮换 GitHub Secret。Token 限定目标 Cloudflare 账户，仅上传步骤接收；GitHub Environment 不提供 Cloudflare 通道级权限隔离。工作流 GitHub 权限为 `contents: read`，不自动改写 Release 或发布附件。Environment 分别限制 main 分支和 `v*` 标签；私有仓库的 Environment 功能受 GitHub 套餐限制，若账户不支持须先解决配置，不静默退回仓库级密钥。

每轮日志、JSON、截图、包清单和报告通过 Actions artifact 保存 30 天，使用 `include-hidden-files` 收录 `.test-artifacts`；产物不含凭证或 node_modules。摘要记录候选、部署结果及证据入口。检查／打包失败不上传；上传后验收失败时站点可能已经更新，失败不等于自动回退。首期由管理员在 Cloudflare 回退上一成功部署，再对回退目标重新验收；常规 Release 工作流禁止作为降级入口。重跑重新检查，不复用过期证据。

页面改动相关专项及必要人工截图审阅仍须在发布决策前完成并记录；基础自动检查不能代替。GitHub Release 发布代表启动生产发布，Actions 成功才表示生产验收通过。CI 不自动提交状态文档，本轮证据在 Actions 中保留，入库报告另行整理。

本地命令仍可用于开发和故障处理；常规发布入口为上述工作流，手工部署须具有明确发布授权。

## 使用前准备

先读当前状态及本次变更涉及的页面设计，完成版本号与发布范围调整，再对最终候选执行完整检查。安装固定开发依赖：`pnpm install --frozen-lockfile`；网页运行不需要这些依赖。

发布工具使用 playwright-core 控制本机 Chrome／Chromium，默认查找系统安装路径，其他位置通过 `RELEASE_BROWSER` 指定。缺失依赖或浏览器明确失败，不跳过验收，不依赖个人缓存。

## 三阶段操作

三个工具入口负责检查、打包和目标验收，不自动提交、登录或部署。检查、打包与验收输出均使用全新目录：

```sh
pnpm release:check --out .test-artifacts/release/candidate-check
pnpm release:package --evidence .test-artifacts/release/candidate-check --out /private/tmp/dvi-candidate-package
```

仅在已有用户发布授权范围内，由发布者执行 Wrangler Direct Upload。Cloudflare Pages 项目为 `dvi-lab`，生产分支为 `main`：

```sh
npx wrangler pages deploy /private/tmp/dvi-candidate-package --project-name dvi-lab --branch main
pnpm release:verify --evidence .test-artifacts/release/candidate-check --package /private/tmp/dvi-candidate-package --url https://dvi-lab.pages.dev --out .test-artifacts/release/production-verify
```

`release:verify` 必须显式指定 URL，无默认生产目标；成功只表示该目标通过，不能用本机／预览结果代替生产验收。预览发布使用 `--branch preview`，并单独验收 `https://preview.dvi-lab.pages.dev`；也可先验收精确部署地址，再验收生产别名，分别保存证据。

首次发布使用统计前，在 Cloudflare 分别创建预览和生产 D1 数据库，在各自的 D1 Console 执行[建表迁移](../migrations/0001_usage_sessions.sql)，再在 `dvi-lab` Pages 项目的 Preview 和 Production 环境各绑定对应数据库，绑定名均为 `USAGE_DB`。从仓库根目录运行 Wrangler Direct Upload，Wrangler 从该目录编译 `functions/`，并从发布包读取 `_routes.json`。线上 `release:verify` 用无写入的 GET 检查 `/api/usage` 返回 `405` 和 `Allow: POST`；浏览器验收拦截该上报。D1 写入专项使用本机或预览的测试库。 [使用统计](modules/usage-statistics.md) · [Pages D1 绑定](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases)

首次发布 `/usage` 页面前，在两套 D1 库执行[角色名索引迁移](../migrations/0002_usage_sessions_by_name.sql)，并在 Pages 各环境通过 **Settings → Variables and Secrets** 设置加密 Secret `USAGE_READ_TOKEN`。可用 `openssl rand -hex 32` 分别生成密钥。线上 `release:verify` 检查 `/api/usage-stats` 无密钥时返回空 `401`，浏览器验收使用合成数据。上线后可用相应环境的密钥打开 `/usage` 验证实际查询。 [Pages Secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets)

认证有效时无需每次登录；Wrangler 明确报告认证失效后，才用 `npx wrangler login --scopes account:read user:read pages:write` 重新授权。既有部署及历史证据保留，旧项目不自动删除或重定向，不同域名配置不自动迁移。

角色脚本版本见[当前状态](status.md#已发布基线)；升级与重新捕获要求、桥接、旧格式处理及捕获失败规则见[导入协议](technical.md#61-角色导入组件与-userscript-协议)，价格存储迁移见[全局物品价格](modules/item-prices.md#价格快照与更新)。

## 发布验证

| 阶段 | 检查范围与结果 |
| --- | --- |
| `release:check` | 完整测试、独立原始计算对照、隔离重复提取与未知摘要拒绝、源码语法／文档引用／版本／路由定义，以及本机 21 路由、全部公开资源和十页双语两视口的 40 组浏览器验收。保存 `check.json`、五阶段完整日志、HTTP／浏览器结果、截图与 `report.md`。 |
| `release:package` | 核对同轮通过证据与完整候选输入，按下节白名单创建全新包目录，包清单保存在检查证据目录。 |
| `release:verify` | 重新核对候选输入与包摘要，独立检查实际目标的 21 路由、路径保留、全部资源与来源清单、逐文件一致性、HTML 入口与双语版本，以及 40 组布局、独立滚动／键盘／滚轮／页脚与普通战斗完成。保存带目标 URL 的 `verify.json`、截图与报告。 |

独立计算验证须包含人工算例，不能再次调用同一函数生成预期值；完整对照已包含战斗子集，常规发布不叠加重跑。日期型原始对照文件继续作为历史证据保留。

视觉或功能变更仍须执行相关页面专项与人工截图审阅，并在本轮发布报告单独记录；基础矩阵不能证明全部交互或视觉正确，工具保存截图不等于人工审阅完成。

基础浏览器矩阵使用隔离的默认价格存档，关闭自动导价，避免外部市场响应触发重绘而干扰键盘、滚动和布局断言；自动导价及价格变化由对应专项验证。

桌面 PageDown、End 及切页／语言重绘验收按步骤等待原生 scrollend，再确认已请求位置实际到达、记录基线并严格验证保持；浏览器输入动画未结束时不能执行下一输入或提前读取位置，不添加固定延时、扩大容差或跳过断言。桌面键盘 End 验收保留严格的列底部及页脚可达断言；若异步状态使列高度在按键后变化，最多按新尺寸重试三次。尺寸未变时仍必须由键盘滚到底部，不能直接设置滚动位置绕过检查；持续变化或未到底部明确失败。

本机预览将 `/`、`/combat`、`/gather`、`/craft`、`/enhance`、`/mastery`、`/forecast`、`/formulas`、`/debug` 及各页面尾斜线形式映射到同一 `index.html`。未知路径通过 302 重定向到 `/combat`（托管规则放在已知路由、首页与静态资源保留规则之后；Cloudflare 重定向优先于静态文件）；HTTP 验收检查单层、多层及带查询参数的未知路径，浏览器验收检查最终地址及历史导航兜底。Cloudflare Pages 的 `_redirects` 对已知路由使用 200 代理到 `/`；不能代理到 `/index.html`，否则规范化跳转可能丢失页面路径。

HTML 一致性检查仅允许已知 analytics loader、Cloudflare Web／Pages Analytics 边界注释及标签间空白。除显式选择的第三方统计脚本替代外，HTTP 与浏览器错误不得忽略；线上失败不改写发布前已通过的结果，正式版准备也不等于部署成功。

## 发布工具与证据设计

### 候选与证据有效性

完整候选输入包含 `.gitattributes`、应用、上游资源、Pages Functions、D1 迁移、测试、发布脚本、文档／报告和依赖清单，证据同时记录运行环境。任一输入或记录环境变化后重新检查；提交号不能替代完整输入摘要。同轮证据完整且输入未变时，不重复完整验证，历史或专项结果不能代替本轮检查。

终端仅输出步骤、计数、耗时、异常与证据路径，完整日志落盘；通常只读取 `report.md` 与目标字段。非测试阶段显式写入独立 JSON 结果，父进程不依赖 stdout 最后一行。缺结果、失败、取消、跳过、超时或缺失环境均明确失败，返回非零退出码、有限诊断及完整日志路径，不能标记通过。

### 发布包白名单

静态发布包含 `index.html`、`_redirects`、`_routes.json`、`src/` 和 `vendor/`，保持模块 Worker 与资源路径。`_routes.json` 只把 `/api/usage` 和 `/api/usage-stats` 交给 Functions。其中允许 js、css、svg、json，以及指定赞赏图片 `src/assets/appreciation.jpg`、公式专用目录 Markdown 和指定 markdown-it ESM／源码映射／许可证文件。`package.json` 包清单保存在证据目录，不放进发布包。

拒绝已存在的包目录、符号链接、隐藏文件、非白名单内容、缺失文件及过时证据。项目文档和验证证据不随生产或预览发布，页面不提供内部文档或报告链接。

工具开发验收覆盖成功摘要与完整日志、失败退出与诊断、输入变化使证据失效、白名单／符号链接／现有目录保护、路径保留，以及资源摘要不一致和目标版本错误拒绝。开发测试入口见 [本地开发](development.md#发布工具开发)，实际发布结果见 [当前状态](status.md)。
