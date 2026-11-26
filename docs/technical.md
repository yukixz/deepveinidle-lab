# 技术方案与上游更新

### 6.1 角色导入组件与 userscript 协议

战斗、采集、制造、强化、精通复用 characterImportPanel：统一 details/summary、import-body、安装链接、按钮与状态节点，参数控制节点标识、按钮及说明；状态为空隐藏，长文本换行。导入区域使用相同高亮容器、金色标题、边框、背景与展开间距，折叠遵循 [语言、布局与持久化](shared.md#22-语言布局与持久化)。

角色自动更新统一使用 `src/character-auto-import.js` 管理各页角色配置选项、进入／焦点调度、忙碌合并、响应代际与按页内存捕获时间去重；`src/import-controls.js` 负责共用开关、页面激活、输入保护及只读桥接。各页面提供角色配置应用适配器并返回保存结果，手动导入也复用同一调度。具体规则见[共用角色自动更新](shared.md#导入游戏角色与自动更新)。快照的 `masteryPage` 标识当前页，`masteries` 保存该页等级，`masteryAway` 按页号保存备用页等级，`masterySkills` 将技能映射到页号。Lab 在导入时解析对应技能，战斗、采集和制造将结果保存在可选的 `masteriesBySkill` 字段，技能首领沿用按技能保存的精通配置。捕获沿用原有字段、桥接、数据协议和存储键。

连接检测共用单次 probe 请求，各页分别保留状态，统一由 importStatusText 生成连接成功、读取中、捕获时间及缺失/旧版本/读取失败等双语提示。较晚 probe 不覆盖读取中或已有结果；读取期间禁用对应按钮，失败保留原配置。战斗额外保留字段警告。

战斗和强化导入区域均不展示刷新读取提示；战斗页不展示配置导入说明段落，对应英文同步移除。安装／更新角色 userscript 链接与导入按钮使用一致的字号、颜色、边框、背景、宽度、高度及交互样式，保持独立一行和新标签打开行为。验收检查两页双语文案移除及链接、导入按钮样式一致。配置导入及导出无需打开游戏战斗预测列表。

- 角色 userscript（生产及待发布版本见 [当前状态](status.md)）提供安装入口、本地化显示名称、document-start、现有游戏／线上／本机地址及共享 document 的 JSON CustomEvent 桥接；游戏捕获仅在 `https://deepveinidle.com/*` 与 `https://cn.deepveinidle.com/*` 启用，两站均只旁听各自同源 `/ws`。`https://*.dvi-lab.pages.dev/*` 匹配该项目的预览分支与部署地址，不扩大到其他 Pages 项目。角色桥接版本仍为 2.4，角色数据协议仍为 2，存储键 `dvi-character-snapshot-v2` 保持兼容；不再提供市场桥接或存储。验收覆盖两游戏域名的脚本匹配、角色捕获保存及非同源连接不捕获。
- 角色脚本旁听 own-role welcome/snapshot、公会与世界窗口，完整保存 `welcome.you`／`snapshot.you` 到 `player`，包括未知及嵌套字段；不做字段过滤；不安装 JSON 解析或预测字段读取钩子，不捕获预测输入。不发送游戏命令、不开额外游戏连接、不捕获 you 以外的认证或聊天消息；you 内所有字段均原样保留。
- 本地化显示名称：中文（zh、zh-CN）为 `Deep Vein Idle · Alice's 实验室助手`，英文为 `Deep Vein Idle · Alice's Lab Assistant`。为保持脚本更新身份连续，默认 `@name` 保留 `Deep Vein Idle · 角色配置导入 / Character import`，`@namespace` 及安装路径不变；语言未匹配或不支持本地化名称时显示默认名称。验收核对默认名称、命名空间、本地化名称和版本元数据；真实管理器覆盖升级及存储继承另行验证。
- 安装／更新脚本后刷新游戏和实验室。配置导入使用最近角色数据，显示其读取时间；跨连接／角色清空本连接状态，串行存储避免旧异步写入覆盖新数据。捕获失败、存储失败、旧协议及缺数据明确提示。
- 不维护调试专用 userscript、`dvi-debug-request/response` 桥接或 `dvi-debug-snapshot-v2` 存储读写。旧脚本管理器数据不自动读取或迁移；原有安装脚本由用户在脚本管理器自行移除。
- 协议验收：配置捕获、普通角色桥接、市场捕获移除、缺失／旧版／读取失败提示、预览路径、跨连接隔离及异步写入顺序继续回归；所有页面无完整快照操作，普通角色请求不接受调试来源，旧快照模拟格式明确拒绝。页面行为分别按 [战斗验收](pages/combat.md#37-验收与已知限制) 与 [强化验收](pages/enhancement.md#46-验收与验证边界)。

所属公会隐藏配置：角色脚本沿用普通角色配置桥接，旁听 `welcome.guild` 与 `guild.info`，只保存名称 `name`、标签 `tag`，不保存成员、聊天、公告或仓库。捕获对象顶层增加 `guild`；无公会为 null，新连接及 welcome 重置，后续角色配置捕获保留本连接最近公会。战斗与强化配置导入将其写入隐藏字段 `guild` 并随各自配置持久化，不新增控件、不参与计算。旧文件缺少该字段时清空所属公会，避免沿用其他角色信息；战斗配置导入时公会字段格式错误清空并提示，强化导入仍明确拒绝并保留已有配置。验收覆盖首次捕获、公会更新/退出、跨连接隔离、两页导入与保存往返、旧文件及异常数据。已实现，角色数据协议仍为 2。


#### 官方市场价格

页面统一使用 `src/price-service.js` 的公开读写协议，纯数据快照由 `src/price-protocol.js` 定义；协议、八项数据及页面选价见[物品价格模块](modules/item-prices.md)。内部存储与行情解析不作为页面访问协议。

`src/market-import.js` 负责官方公开 API 适配与共用错误文案，`src/item-price-store.js` 负责校验、缓存、防倒退、锁定及持久化，`src/price-auto-import.js` 负责自动导入调度与通知；各入口共享网络请求，不发送凭据、不使用代理。接口字段、定价协议见[物品价格模块](modules/item-prices.md)，行情更新及页面入口见[共用价格界面](shared.md#24-页面估值与全局行情)。已移除的游戏侧市场桥接及 GM 缓存不再读写，历史数据不主动删除；更新角色脚本并刷新游戏后移除旧脚本的市场捕获。

#### 角色捕获与保存

- 捕获依赖游戏通过 addEventListener 注册 message 监听及 document-start 及时接入；不补抓已注册的监听或仅使用 onmessage 的连接，更新后须刷新游戏。
- 游戏页优先使用 `unsafeWindow`；仅在该全局未定义时回退到 `window`，保留现有 `@grant`。回退要求脚本的 `window` 能修改游戏页面实际使用的 `WebSocket`，且环境支持 `GM_getValue`／`GM_setValue`；不承诺支持无法访问页面 JavaScript 的隔离环境。验收覆盖无 `unsafeWindow` 时经页面 `window` 捕获并保存角色，以及两者同时存在时仍优先使用 `unsafeWindow`。
- 包装页面 `WebSocket.prototype.addEventListener`，原样调用原始方法成功后，在同源 `/ws` 首次注册 message 监听时附加一次独立监听；不替换构造器、不包装游戏回调。通过 WeakSet 去重，以连接状态对象隔离旧消息及异步保存结果。直接解析字符串消息并维护本连接的角色、公会及世界窗口状态；不使用捕获 Worker、Blob URL、消息 ACK、积压队列或启动超时，不额外下载代码、不发送游戏指令。非法 JSON 和无关消息忽略；you 不是对象时停止捕获并明确提示刷新；具体角色字段由实验室各页导入校验。
- 角色原样保存整个解析后的 you 对象，不重复序列化复制、不合并旧字段；具体字段是否可用由导入消费者校验，未来新增 you 字段无需更新脚本。完整角色数据也进入桥接和调试导出，本地存储量随之增加；世界窗口保留 rarityMult，快照保留 `worldBuffsVersion: 1` 完整捕获能力标记。同帧最多更新一次角色状态。战斗与采集按捕获时点汇总全部有效窗口的经验与稀有度，全程用于模拟，共用世界窗口校验和汇总；旧快照缺能力标记时清零两项并明确提示更新脚本及重新捕获。制造共用完整世界窗口校验与经验汇总，不导入无效的世界稀有度；旧捕获经验清零并明确提示。角色桥接 2.4、数据协议 2 与存储键保持兼容。
- 仅维护一份待保存的最新快照，空闲后合并 100ms 再保存；持续更新不延长已安排的等待。最多一个 GM 写入进行中，慢存储期间替换待保存快照，不排队保存中间状态。新连接清空捕获状态及待保存快照，等待已开始的旧写入完成后再保存新连接数据，旧写入结果不改变新连接提示；当前连接保存失败停止捕获并显示错误。
- 游戏页等待提示持续显示，每连接首次保存成功后显示“角色配置已读取 / Character captured”5 秒；后续更新不重显或延长提示。新连接重置提示，旧连接写入及市场消息不改变新连接提示。不使用 DOM 观察器：根节点存在时直接挂载，否则等待 DOMContentLoaded；节点被外部删除不自动重建；新连接或捕获失败时重新挂载相应提示。页面退出清理计时器及就绪监听并停止捕获，不保证关闭前最后一次异步保存完成。
- 验收覆盖构造器身份不变、原监听参数/返回值/异常保留、重复注册去重、未知嵌套字段完整捕获及替换、延迟 DOM 挂载、节点删除后不重建、全部导入字段、同帧聚合、市场消息不触发保存／提示和市场桥接缺失、持续更新及慢存储合并、跨连接隔离、解析／保存失败与退出清理，以及不提供 Worker 时仍正常捕获。浏览器专项使用合成消息和模拟 GM 存储；实际脚本管理器安装、真实游戏及长时性能需单独验证，不由专项测试推断。

### 6.2 原始代码复用

- 游戏地址：<https://deepveinidle.com/>。
- 共用计算快照使用公开资源 <https://deepveinidle.com/assets/index-szBaIgSm.js>，2026-11-21 获取并核验，SHA-256 `7fdb0dbe3a5aa0bda15768e45c55a5f064508b5259e1b6f44c0cb5e271b3272c`。资源最新更新条目为 1.0.1221（2026-11-20）；文件名和摘要作为快照标识。
- 普通战斗使用 [1.0.1225 公开资源](https://deepveinidle.com/assets/index-BgVKytXH.js) 的独立声明闭包，来源、语义映射与摘要由 `vendor/combat-manifest.json` 记录。采集、制造、技能首领投喂、强化与 `work-time` 使用共用快照 `vendor/manifest.json`。两个模块走同一提取器，校验全部来源后再写入生成文件。此前战斗局部补充保留为历史证据，适配验证与发布状态见[当前状态](status.md)。
- 全局行情筛选的一级分类复用原始 `marketCategories`，剔除宝石快捷分类后将宝石纳入资源；上游同步时核对该导出、细分类归属与价格存档迁移。
- 保存完整公开资源；`.gitattributes` 仅对 `vendor/game-original.js` 关闭行尾空格检查，保留上游模板字符串中的原始空格及完整摘要，其余空白检查保持。原样提取计算函数及数据依赖，不加载整个游戏应用，也不依赖游戏账号。函数体及数据字面量保持原样，每个提取声明可追溯并校验摘要；原始计算模块不依赖 DOM、网络或账号。压缩符号只是当前快照定位信息，不是稳定接口。
- 1.0.1190 引入的物品 397 为满月礼盒（Moon box），定义价值 25，原始商人售价函数返回 10，归贵重物品分类；仅补齐物品定义、翻译、分类与价格导入，不增加现实活动利润模拟。新版活动 `box` 事件已携带实际 `itemId`，统计优先读取该字段，不把其他活动礼盒计成旧礼盒。
- 新版制造任务按初始仓库重选最近制造点；采集任务无输入材料时保留指定点。当前制造适配先从所选仓库初始化，需继续核验每配方／品质及两个仓库的选点一致性。
- 新版制造／强化订单、增强契约、后备任务及农场杂务进入原始依赖闭包，但不新增手动配置功能；手动玩家保持这些状态为空。当前不提供完整角色快照输入。
- 旧局部同步与版本核验见[历史兼容性报告](../reports/upstream-compatibility-audit-2026-10-11.md)，不作为正式版已同步范围的说明。

### 6.3 模块职责

| 文件 | 职责 |
| --- | --- |
| `vendor/game-original.js`、`vendor/game-combat-1225.js` | 共用计算、战斗的完整公开资源快照 |
| `vendor/manifest.json` | 来源、摘要、导出映射、原始声明位置与摘要 |
| `scripts/extract.mjs` | AST 与作用域依赖分析、已审阅摘要及映射校验、生成原始代码子集 |
| `src/upstream.js` | 生成的原始声明与语义导出，禁止手工修改 |
| `src/model.js` | 输入规范化、玩家状态适配、配置过滤、结果组合与排序 |
| `src/simulation.js`、`src/simulation-worker.js` | 原始战斗函数状态适配、可配置时长统计及异步计算 |
| `src/gathering-model.js`、`src/gathering-simulation.js`、`src/gathering-worker.js`、`src/gathering-controls.js` | 独立采集配置与导入、原始工作逐刻适配、最近点选择、异步进度及页面交互 |
| `src/crafting-model.js`、`src/crafting-store.js`、`src/crafting-simulation.js`、`src/crafting-worker.js`、`src/crafting-controls.js` | 制造角色配置及旧存档迁移、配方速率模拟、材料消耗与产物估值及页面交互（Worker只接收配方／品质列表，不区分订单与速率模式） |
| `src/boss-feed-*.js`、`vendor/work-time/` | 技能首领角色配置、投喂及单层制造耗时、路线估值和比较页面。耗时使用固定版本的 work-time 浏览器模块 |
| `src/work-expectation.js` | 采集／制造共用机会期望、品质、烧焦及奖励容量门槛；支持直接写入目标期望账本，使用最小背包状态调用原始容量校验，不改原始过程 |
| `src/world-buffs.js` | 战斗、采集与制造共用世界增益窗口校验、捕获时汇总与旧捕获提示 |
| `src/work-import.js` | 采集与制造共用角色导入校验及字段映射 |
| `tests/crafting.test.mjs` | 有效配方／品质原始离线对照、烧焦／升级／限次、材料预算、窗口速率与导入回归 |
| `tests/gathering.test.mjs` | 最近点及起点一致性、四技能全部任务／点位原始离线对照、配置与导入回归 |
| `src/enhancement.js`、`src/enhancement-controls.js` | 强化专用校验、导入、解析期望与独立页面交互 |
| `src/enhancement-distribution.js`、`src/enhancement-distribution-worker.js` | 成本 CDF 上下界递推、费用网格细化与后台求解；算法、误差及资源预算见[强化计算规则](pages/enhancement.md#成本分布递推) |
| `src/hot-forecast.js`、`src/forecast-filters.js`、`src/forecast-controls.js` | 热门日程计算、多选筛选规范化与独立本地存储、预报页面交互 |
| `src/appreciation-controls.js`、`src/assets/appreciation.jpg` | 共用赞赏弹窗及原始赞赏图片；复用物品价格弹窗样式与交互约定 |
| `src/formulas-controls.js`、`src/formulas-markdown.js`、`src/content/formulas/` | 中文公式正文、按需加载、Markdown 渲染、章节目录与独立阅读布局 |
| `scripts/vendor-markdown.mjs`、`vendor/markdown-it/` | 从固定开发依赖同步浏览器发行文件与许可证，校验版本、内容摘要和来源 |
| `src/combat-hot.js` | 战斗热门加成时钟映射，采集和制造复用带技能参数的日程和窗口换算 |
| `src/search-select.js` | 可搜索选择框与键盘交互 |
| `src/i18n.js` | 上游翻译整合与缺失名称补充 |
| `src/character-import.user.js` | 角色配置读取与脚本管理器本地存储桥接 |
| `src/character-import.js`、`src/import-controls.js`、`src/character-auto-import.js` | 全部支持字段校验与转换、共用角色导入面板、各页独立配置选项、手动／自动读取调度、页面／输入保护及跨页面请求 |
| `tests/character-import.test.mjs`、`tests/character-auto-import.test.mjs`、`tests/character-auto-import-browser.mjs` | 字段映射、角色脚本桥接、共用角色配置自动更新及旧设置兼容、页面生命周期与输入保护回归 |
| `src/debug-controls.js`、`tests/debug-controls.test.mjs` | 隐藏调试页、角色配置 JSON 文件下载与战斗／强化两个共用导入入口、文件往返及失败状态验证 |
| `src/mastery.js`、`src/mastery-controls.js` | 独立精通预算、升级成本、配置校验与双语交互 |
| `src/mastery-optimizer.js`、`src/mastery-optimizer-worker.js`、`src/mastery-optimizer-controls.js` | 目标策略、有界搜索、独立复核与专用 Worker；冻结输入、运行任务输入检查与迟到消息隔离；任务重置与已完成推荐独立，应用只填入本页目标。具体预算、评分和交互见[精通优化设计](pages/mastery.md#计算最优分配方案) |
| `src/mastery-work-estimate.js` | 精通快速模式。使用采集／制造场景的角色、工位、仓库和增益，适配内置 work-time 的单次期望与批次耗时，折算 24 小时指标 |
| `src/mastery-result-store.js`、`src/mastery-result-controls.js`、`src/mastery-plan-view.js` | 精通双栏分配保存、历史指标与共用卡片展示、跨标签冲突检查；新计算严格校验，恢复仅校验分配等级。计算、搜索、估值或上游规则不兼容时更新计算兼容版本，旧分配仍可应用，指标标记历史版本；辅助信息异常明确提示且不丢分配 |
| `tests/mastery-optimizer.test.mjs`、`tests/mastery-optimizer-browser.mjs` | 独立穷举算例、真实模拟对照、预算／缺价／异常与种子隔离，以及真实 Worker、取消、结果保留和双语窄屏验证 |
| `src/price-protocol.js`、`src/price-service.js` | 物品价格八项数据的只读快照、固定公开协议、统一设价命令及分类变更通知 |
| `src/item-prices.js`、`src/item-price-store.js`、`src/market-import.js`、`src/item-price-controls.js`、`src/price-auto-import.js` | 价格模块内部规则、存储、官方价格及挂单总量解析、管理弹窗与自动导入通知 |
| `src/app.js`、`src/style.css` | 双语交互、呈现、本地保存和响应式布局 |
| `scripts/release.mjs`、`scripts/release-*.mjs` | 发布三阶段编排、证据摘要、隔离提取、HTTP／浏览器验收与完整日志 |
| `scripts/native-audit.mjs` | 全部页面独立原始计算对照，常规发布唯一完整对照入口 |
| `scripts/serve.mjs` | 仅监听本机的静态预览服务 |
| `tests/model.test.mjs` | 计算、配置、完整性及源码一致性回归测试 |

运行网页不需要安装开发依赖，启动方式见 [本地开发](../docs/development.md)。原游戏代码和数据归原作者，保存来源不代表获得开源许可。

### 预测与手动角色适配

使用原始有效物品／配方导出 `items`／`recipes`（当前快照 `li`／`Ve`），不导出未开放烹饪总表；烟花品质与产物分别复用 `recipeRarity`／`recipeOutput`；精通收藏计点继续复用原始收藏目录及排除规则。收藏页移除后，不再公开仅该页使用的 `collectionThresholds` 和 `potionDurationTicks` 语义导出；原始计算闭包需要的内部声明继续由提取器保留。具体行为与验收见[制造](pages/crafting.md)和[精通](pages/mastery.md)。

新版预测负责清背包、平移药剂剩余时间并初始化空日／周任务。合成角色每刻同步日／周编号并保持空任务；订单、农场为空。hypothetical 上下文禁用内置热门，实验室用正向窗口表达[三个热门模式](pages/combat.md#336-模拟配置)，工作品质期望传递相同标志，防止重复计入。

战斗使用 1.0.1225 客户端的新角色构造函数生成空白地牢状态、套装和路线字段，再填入实验室配置。精通战斗优化和世界首领静态估算共用新版角色属性，旧精通结果仍可应用分配，指标显示历史。

1.0.1214 合成角色补齐空技能首领奖励队列 `skillbossPending` 和空精通备用页 `masteryAway`，不带入账号状态。适配继续保持手动角色银行锁定为空，不新增锁定食物配置；角色导入按捕获的 `lockedUsable` 决定是否允许选用锁定食物。1.0.1221 合成角色提供空的 `spoilsHeld`、`gearSets` 和 `skillSets`，满足原始预测的复制与路线初始化要求；物品目录识别五种技能首领未开封奖励箱。契约排队、世界首领奖励、精通切页及农作种子选择按上游依赖保留，实验室没有对应的账号操作或首领收益入口。

首领自动参战、有限保护卷库存执行及原生角色文件输入不在当前范围。脚本版本、生产基线与证据见[当前状态](status.md)。

### 当前上游适配边界

完整同步资源及声明不表示开放原游戏的全部功能。技能首领团战、外观工坊、任务计划双页、游戏内精通绑定编辑和切页操作、游戏绘制动画、聊天、邮箱、交易操作及农场自动收获不属于实验室范围；合成角色的任务、原生订单与农场保持为空。等级约束与旧配置处理见[上游等级上限](shared.md#上游等级上限)。

任务缓存、家园升级封顶、农耕与市场等原始依赖按计算闭包保留；宝石包的游戏商人菜单限制不改变实验室的 `canSell`／`vendorPrice` 估值协议。页面特有规则分别由[采集](pages/gathering.md#纯净煤矿)、[制造](pages/crafting.md)、[强化](pages/enhancement.md#45-计算规则)及[商人售价兼容](modules/item-prices.md#上游商人售价兼容)维护。来源核验与历史差异见[1208 适配报告](../reports/upstream-1208-implementation-2026-10-30.md)。

### 强化旧配置兼容

缺书台字段的旧配置迁移、严格校验及导入失败保留规则统一见[强化配置](pages/enhancement.md#42-装备保护与价格设置)，不按历史版本调整当前公式。

### 6.4 上游更新流程

1. 保存新公开资源快照，并更新来源信息。
2. 复核并更新提取器的来源、日期、版本、SHA-256、导出映射、数据和函数签名；快照摘要不匹配、未知依赖或签名不匹配时在生成前停止提取，不能猜测替代公式。
3. 重新生成原始代码子集与摘要清单，审阅差异。仅同步已核验的局部行为时，可保留基础快照并保存补充版本完整资源，按声明原样提取、显式绑定已审阅的原依赖；manifest 分别记录两份来源、摘要、声明范围和绑定关系，不把混合提取标记为全量升级。
4. 同步 [设计索引](../DESIGN.md) 所指向的受影响规则、清单和边界，再调整适配层。
5. 核验角色消息格式、全部导入消费者与角色捕获逻辑，保持桥接和数据协议兼容；协议变化时明确迁移或拒绝规则。通过源码一致性、计算回归、数据完整性和浏览器检查后，更新来源、版本与验证状态。角色脚本只旁听同源 WebSocket，不维护已移除的预测字段钩子或资源源码位置表。

### 构建功能开关与合成角色边界

共用计算快照 1.0.1221 的强化重制、炼金和配置方案开关为关闭。战斗快照 1.0.1225 的强化重制和炼金开关已开启，战斗页采用新版装备属性及物品强化上限。强化成本新增的 essence 字段在关闭分支为 0，适配层按实际原始返回值校验。合成角色不启用技能首领、任务计划与精通自动切页，不带入实际账号行为；普通角色捕获继续原样保存完整角色字段；读取精通来源遵循[导入精通页](shared.md#导入精通页)。新增物品、工具、套装、副手与升级配方从原始有效目录派生。
