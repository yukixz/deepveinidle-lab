# 本地开发

[项目入口](../README.md) · [技术方案与上游更新](technical.md) · [发布流程](release.md)

需要 Node.js 20+。本地运行网页无需安装开发依赖：

```sh
node scripts/serve.mjs
```

打开 [本机页面](http://127.0.0.1:4173)。服务仅监听本机，可通过 `PORT` 环境变量修改端口；支持 `/combat`、`/gather`、`/craft`、`/boss-feed`、`/enhance`、`/mastery`、`/forecast`、`/formulas` 和调试页 `/debug`。调试页仅提供角色配置 JSON 导出、战斗／强化配置文件导入；完整角色快照捕获、导入、导出与模拟已在当前版本移除。

`/usage` 可用静态服务检查页面入口和锁定界面。验证实际查询时用 `wrangler pages dev`、本机 `USAGE_DB` 和测试用 `USAGE_READ_TOKEN`，在本地数据库执行 `migrations/` 内的迁移。发布前浏览器检查会拦截统计查询并返回合成数据。 [使用统计页](modules/usage-statistics.md#使用统计页)

功能修改默认运行相关测试；涉及共用逻辑、影响范围难以界定或专项检查发现问题时扩大范围，发布前按[发布流程](release.md)执行完整检查。专项示例：

```sh
node --test tests/enhancement.test.mjs tests/enhancement-controls.test.mjs
```

需要完整测试时运行：

```sh
node --test tests/*.test.mjs
```

物品价格协议与命令测试为 `tests/price-protocol.test.mjs`、`tests/price-service.test.mjs`，官方接口解析见 `tests/market-import.test.mjs`。运行 `node tests/price-refactor-browser.mjs` 验证八项数据、全市场挂单总量、强化方案覆盖与清空，以及价格消费者页面导航；输出位于 `.test-artifacts/price-refactor/protocol/`。沿用市场价格浏览器专项，需要本机端口和 Chrome 进程权限，不能替代完整发布验收。协议见[物品价格模块](modules/item-prices.md)。

重新提取原始计算代码时，安装开发依赖后执行：

```sh
pnpm install --frozen-lockfile
node scripts/extract.mjs
```

完整公开资源位于 `vendor/game-original.js`，来源、摘要、语义导出及声明摘要记录于 `vendor/manifest.json`；当前快照与提取边界见[原始代码复用](technical.md#62-原始代码复用)。禁止手工修改生成文件 `src/upstream.js`；更新资源前遵循[上游更新流程](technical.md#64-上游更新流程)，完成映射审阅、重新提取及回归验证。

本机服务有意不开放 `docs/`、`reports/` 与 `AGENTS.md`；文档通过仓库或本地编辑器阅读。README 与 DESIGN 仍可直接访问，但其拆分文档链接不属于网页预览服务范围。无需为文档整理扩大服务器访问范围。

## 技能首领专项

运行 `node --test tests/boss-feed.test.mjs tests/routing.test.mjs` 检查计算、行情协议、精通投影和路由。运行 `node tests/boss-feed-browser.mjs` 使用本机 Chrome、合成行情和角色快照检查页面；截图保存于 `.test-artifacts/boss-feed/`。

更新固定版本的 `@dvi-lab/work-time` 后，用 `pnpm vendor:work-time` 同步浏览器模块、许可证及文件摘要。静态检查验证所提交文件与已安装版本一致。首领规则和时间适配使用同一 `node scripts/extract.mjs`，与其他页面共用 `vendor/game-original.js`。

## 强化页专项

运行 `node --test tests/enhancement-distribution.test.mjs tests/enhancement.test.mjs tests/enhancement-controls.test.mjs tests/enhancement-items.test.mjs tests/item-prices.test.mjs`，覆盖原始消耗与解析均值、精确 CDF 参考向量、完整路径分位数上下界及 0.1% 容差、均值量级网格与细化、微调／小数价格、共享运算预算、必成步骤消元、独立路径概率对照、资源限制、价格与利润率、存档迁移及角色导入。

先启动本机服务，再执行 `node scripts/check-enhancement-distribution-browser.mjs [输出目录] [目标网址]`；默认目标为 `http://127.0.0.1:4173`，输出到 `.test-artifacts/enhancement-distribution/`。脚本使用独立无头 Chrome 和人工测试价格，正常路径运行真实 Worker，异常路径注入受控 Worker；验证中英文桌面／390px 的卡片布局、面板顺序、三档成本／收费、利润与整数取整、保存和重置、缺价、超限原因及旧结果隔离。日志、summary.json 和截图需结合审阅，不使用用户已有会话或游戏账号，不代替完整发布验收。

## 公式内容维护

公式页面仅中文；修改 `src/content/formulas/combat.zh.md` 后刷新页面即可读取新内容。只使用标题、列表、表格和文本公式块，不嵌入原始 HTML。二、三级标题自动进入目录；章节链接按标题顺序生成，调整章节顺序时需同步检查旧链接。

markdown-it 在 `package.json` 中以固定版本开发依赖管理，锁文件记录包完整性及依赖。安装后执行 `pnpm vendor:markdown`，从安装包同步浏览器发行文件、源码映射、许可证和来源摘要到 `vendor/markdown-it/`；`pnpm vendor:markdown --check` 检查版本及字节一致性。升级时先更新固定版本与锁文件，再同步发行文件并运行公式专项。网页运行使用本地发行文件，无需访问 CDN 或在运行时安装依赖。

专项单元与发布资源测试：`node --test tests/formulas.test.mjs tests/release-tools.test.mjs`。浏览器专项：`node tests/formulas-browser.mjs`，使用本机 Chrome 和临时回环服务，结果与截图保存在 `.test-artifacts/formulas/`；需要允许本机监听与浏览器进程。其验证公式页面、错误重试、目录、路由、布局和模拟状态保留，不替代完整发布验收。

## 精通最优分配专项

行为与验收以[精通页面](pages/mastery.md)为准。单元回归：

```sh
node --test tests/mastery.test.mjs tests/mastery-controls.test.mjs tests/mastery-result-store.test.mjs tests/mastery-optimizer.test.mjs
```

覆盖成本与规划草稿、导入保留、计算策略与真实模拟对照、预算及搜索下限、新结果严格校验、合法分配恢复、历史指标与存储冲突。修改共用模拟、价格协议或搜索控件时，按影响范围补跑 `tests/simulation.test.mjs`、`tests/price-protocol.test.mjs`、`tests/enhancement-items.test.mjs`。

四套浏览器专项统一使用 `node tests/<脚本> [输出目录] [目标网址]`：

| 脚本 | 默认输出目录 | 主要范围 |
| --- | --- | --- |
| `mastery-optimizer-browser.mjs` | `.test-artifacts/mastery-optimizer/` | 原四目标、三档搜索与两种预算的真实Worker；目标应用、冻结价格、保留旧推荐、运行取消／迟到隔离及保存失败 |
| `mastery-result-slots-browser.mjs` | `.test-artifacts/mastery-result-slots/browser/` | 双栏覆盖／删除／应用、导入刷新保留、超预算和低于当前恢复、旧引擎／异常辅助信息、无效点数草稿、跨标签冲突与卡片布局 |
| `mastery-xp-browser.mjs` | `.test-artifacts/mastery-xp/browser/` | 三个经验目标的真实 Worker、采集／制造快速模式、切换取消、双语窄屏、配方品质、自动应用与双栏恢复 |
| `mastery-search-browser.mjs` | `.test-artifacts/mastery-search/search/` | 三类候选排序与双语搜索、鼠标／键盘、无匹配和取消、仅确认不同选择取消任务、实际Worker请求目标 |

四套共用 `tests/helpers/mastery-browser.mjs` 的临时服务、合成角色、价格隔离和Worker观测；默认关闭市场自动导入，不连接真实账号。真实完成使用实际Worker，取消／迟到／错误场景使用受控替身。包含中英文桌面与390px布局，日志和截图需落盘并人工审阅，不替代发布验收。需要回环监听和本机Chrome；传入目标网址时直接访问该目标，不启动本机服务。

<a id="角色捕获-worker-专项"></a>

## 角色捕获专项

运行 `node --test tests/character-capture.test.mjs tests/character-import.test.mjs tests/market-import.test.mjs` 验证角色捕获、保存协调、市场捕获移除、角色桥接及官方市场价格适配。运行 `node scripts/check-capture-browser.mjs` 后，在 Chrome 打开 `http://127.0.0.1:4186/`，页面自动验证直接捕获（不提供 Worker／Blob API）、完整 you（含未知字段）、慢存储合并、跨连接隔离和失败提示，完成后显示 PASS。此服务只暴露测试页与当前候选脚本，不连接游戏，GM 存储和 WebSocket 使用合成替身；`PORT` 可修改端口。源码变化后刷新重测，结束后停止服务。

本地合成消息验证不代表脚本管理器沙箱兼容或真实账号卡顿改善；安装／更新角色脚本后仍须刷新游戏和实验室（生产基线及本地候选见 [当前状态](status.md)），并单独记录该环境的验收。角色数据不兼容或保存失败时明确提示失败并要求刷新。

## 发布工具开发

发布前检查、打包及目标验收使用 `pnpm release:check`、`pnpm release:package`、`pnpm release:verify`，参数及证据规则见 [发布流程](release.md)。三个入口不自动提交、登录或部署。开发发布工具时先运行 `node --test --test-reporter=tap tests/release-tools.test.mjs`；其中 HTTP 测试只使用临时回环服务器。应用测试按影响范围选择，发布前必须执行完整检查。

完整独立原始计算对照的常规入口为 `node scripts/native-audit.mjs`，复用已核验全部页面审计；日期型报告脚本仅保留历史证据。浏览器依赖为固定版本 playwright-core，需本机 Chrome／Chromium，或通过 RELEASE_BROWSER 指定可执行文件；不下载浏览器，也不使用用户已有会话和游戏账号。

## 官方市场价格与价格弹窗专项

运行 `node --test tests/market-import.test.mjs tests/item-prices.test.mjs tests/item-price-store.test.mjs tests/item-price-status.test.mjs tests/price-protocol.test.mjs tests/price-service.test.mjs tests/price-preferences.test.mjs tests/page-prices.test.mjs`。运行 `node tests/market-prices-browser.mjs` 验证官方 API 真实跨域、双语桌面／390px 弹窗、导入与锁定、错误保留及直接捕获（不提供 Worker／Blob API）；需要网络、本机监听和 Chrome。结果和截图保存在 `.test-artifacts/market-prices/`；接口异常明确失败，不以请求替身通过代替真实跨域验证。功能场景使用可控响应替身，不连接游戏账号。

行情专项可运行 `node tests/market-prices-browser.mjs --toolbar-only`，以请求替身覆盖双语桌面／390px 弹窗、手动刷新、错误重试、锁定保留、自动更新开关、五分钟边界和通知。可用 `--out <目录>` 保存证据，`--base-url <目标网址>` 对指定站点验证。

运行 `node tests/price-refactor-browser.mjs [输出目录]` 验证四页模拟配置、默认来源、持久化、共享弹窗、焦点返回和强化价格覆盖。浏览器专项需本机端口和 Chrome，不替代真实 API 或完整发布验收。

## 上游版本适配专项

`node --test tests/upstream-1214.test.mjs tests/upstream-1212.test.mjs tests/upstream-1208.test.mjs tests/upstream-1205.test.mjs tests/upstream-1204.test.mjs tests/upstream-1203.test.mjs tests/upstream-1199.test.mjs tests/upstream-1196.test.mjs tests/upstream-1194.test.mjs tests/enhancement.test.mjs tests/mastery.test.mjs` 验证 1208 精通 200／家园 50 上限、越界旧配置与导入拒绝／警告、激活精通切页捕获，以及利维坦护符无总等级门槛提示／导入保留、升级容量原子性／批量成本，以及纯净煤矿任务／固定普通主产物／额外奖励品质、书台恢复、1198 缺字段配置迁移、统一碎片／经验、2.4 秒尝试与宠物机会恢复、深渊之眼商人特殊售价及等级缓存边界，以及烟花有效品质／定价／收藏排除、装备升级保留品质与强化编码、预测初始化以及强化目标 +20、既有 +100 编码／导入保留、精通 +50% 封顶及锻造录 +15 计点边界／15,662 总上限。

`node --test tests/upstream-1190.test.mjs` 覆盖迁移战斗区域、自动及两个指定仓库、巨像六件五品质材料与任务自动领奖隔离。独立离线对照使用 `scripts/native-questless.mjs` 按日边界分段保持空任务，以数学日／周编号独立于应用适配函数核验。

`node tests/upstream-browser.mjs --out .test-artifacts/upstream-1214/browser` 检查双语桌面／390px 护符无总等级门槛提示／刷新保留、纯净煤矿任务／计算／刷新保存及战斗完成、来源版本、巨像材料／经验及角色配置刷新保存，书台恢复／保存与缺字段迁移、强化成功率、新旧目标与高强化存档、精通等级及家园控件上限、强化加成封顶、烟花有效品质／已存火药单价展示，以及合成消息下的直接捕获（不提供 Worker／Blob API）；需要本机监听和 Chrome。指定 `--url https://dvi-lab.pages.dev --out <证据目录>` 时检查该实际目标四组页面，不把本地角色捕获专项当作生产测试。截图和机器结果落盘，仍需人工审阅。加 `--combat-only` 仅运行护符提示删除相关的战斗／精通检查，覆盖无其他问题时隐藏提示框、刷新恢复及其他等级不足提示保留。

## 采集与制造表格专项

模拟配置专项：`node --test tests/work-simulation-settings.test.mjs` 验证时长规范化、旧存档、角色导入保留时长及制造实际窗口。`node tests/work-simulation-settings-browser.mjs [输出目录] [目标网址]` 验证双语桌面／390px 的整数小时输入、固定每天展示、热门日程、导入、刷新、重置及旧 Worker 隔离；默认输出 `.test-artifacts/work-settings/settings/`，提供目标网址时不启动本机服务。使用合成角色消息与真实工作 Worker，截图需审阅，不代替完整发布验收。

`node --test tests/crafting-display.test.mjs` 验证配方列序、品质、固定每天折算、额外耗时与排序、制造次数取整、经验明细与异常行。浏览器专项使用 `node tests/gathering-table-browser.mjs [输出目录] [目标网址]`、`node tests/crafting-table-browser.mjs [输出目录] [目标网址]`，需要本机监听和 Chrome；默认分别输出至 `.test-artifacts/gathering-table/`、`.test-artifacts/crafting-table/`，复验时指定独立目录以保留历史证据。覆盖双语桌面／390px、排序、经验展开、采集／制造次数展开的起始耗时与完成概率（升级为固定耗时）、制造名称与品质不折行、固定每天展示及周期选择器移除、等待／失败、配方只读单价和全局价格联动；正常计算使用真实 Worker，异常场景使用受控消息，不替代完整发布验收。

上述表格专项及下述标题栏／按需任务专项传入目标网址时不启动本机服务，直接检查指定目标；本机通过不能代替生产验证。

三页模拟状态标题栏专项：`node tests/simulation-heading-browser.mjs [输出目录] [目标网址]`，默认输出 `.test-artifacts/heading-status/`。覆盖战斗、采集、制造的双语桌面／390px状态位置、右对齐、长文换行、进度及失败显示，以及真实Worker完成后隐藏；错误与进度采用受控消息，不连接游戏账号。截图需审阅，不代替完整发布验收。

制造按需模拟专项：`node tests/crafting-filter-browser.mjs [输出目录] [目标网址]`，默认输出 `.test-artifacts/crafting-filters/demand/`。验证分类与稀有度交集决定速率任务、搜索仅影响显示、缺失补算及同轮缓存、种子／起点保留、与原始模拟结果一致、全不选品质、运行中切换及旧Worker隔离，以及输入法不触发模拟、双语桌面／390px搜索右侧分类布局。需要本机服务和独立Chrome，正常结果使用真实Worker，隔离场景使用受控消息，不连接游戏账号。

制造配置及原始计算：`node --test tests/crafting.test.mjs tests/crafting-upgrades.test.mjs tests/crafting-store.test.mjs` 验证五技能与装备升级、材料映射、原始计算对照、配置迁移和坏存档保护。旧订单／库存／周期字段仅在兼容性测试中构造；普通功能测试使用当前配置与配方Worker协议。

## 共用角色自动更新专项

`node --test tests/character-auto-import.test.mjs tests/character-import.test.mjs tests/character-masteries.test.mjs tests/crafting-store.test.mjs tests/crafting-display.test.mjs` 验证配置导入、精通选页、偏好、坏存档保护及并发。`node tests/character-auto-import-browser.mjs [输出目录]` 验证五页配置开关、独立保存、焦点合并、重绘、制造忽略无效库存、切换技能时立即更新精通、迟到响应、异常绑定回退和双语桌面／390px。默认输出 `.test-artifacts/character-auto-import/browser/`，使用受控桥接验证。

1208 上限与旧存档浏览器专项：`node tests/upstream-browser.mjs --caps-only --out .test-artifacts/upstream-1208/caps-browser`。覆盖中英文桌面／390px 下战斗、采集、制造的家园控件、强化书台及精通等级上限、越界输入提示和恢复合法值、强化／精通越界存档明确提示且原存储保留。此选项仅执行该专项，不代表完整页面或发布验收。

技能装备专项：`node tests/upstream-1212-browser.mjs [输出目录] [目标网址]`，默认输出 `.test-artifacts/upstream-1212/browser/`。覆盖中英文桌面／390px 的 105 级工具、技能副手速度、套装经验、禁用品质／强化、保存恢复及新增升级配方真实 Worker；需要本机回环监听和独立 Chrome，不连接游戏账号。截图须人工审阅，不代替生产验收。独立原始计算入口同时对照无装备与新工具／副手／套装组合的采集点，以及带新装备的制造配方。

上游新装备及价格选项专项提供目标网址时直接检查该网址，不启动本机服务；本机／预览通过不能代替本轮正式生产目标验收。

1.0.1214 专项另覆盖全部升级五品质与 +0／+17／+100 编码、神龛与世界稀有叠加及代币概率封顶、空首领奖励队列／精通备用页及新计算结果的引擎版本校验；`tests/character-import.test.mjs` 和 `tests/character-capture.test.mjs` 覆盖锁定食物与旧捕获提示。独立原始计算对照新增手算代币概率及升级编码检查。

## CI 发布开发

工作流位于 `.github/workflows/`，共用安装及检查位于 `.github/actions/release-check/`；发布约定与远端凭证配置见[发布流程](release.md#github-actions-双通道发布)。`node --test tests/ci-release.test.mjs tests/release-tools.test.mjs` 验证正式标签、版本防倒退及候选证据失效；完整候选使用 `pnpm release:check`。本地不能证明 GitHub 事件、Environment、Linux runner 或 Cloudflare 上传成功，须分别实跑并保留证据。

统计隔离专项：`node tests/release-analytics-browser.mjs .test-artifacts/analytics-isolation/result.json`，使用隔离 Chromium 和受控脚本响应，不访问真实统计服务；覆盖排除／真实模式、精确脚本匹配、版本与查询参数、其他脚本执行及错误保留，结果独立落盘。CI 在完整检查后执行该专项；线上验收边界见[发布流程](release.md#github-actions-双通道发布)。
