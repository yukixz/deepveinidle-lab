# Alice’s 实验室 · 设计索引

当前功能、交互、计算规则与验收从下表查阅；每项规则只在所属文件完整维护。项目简介与启动见 [README](README.md)，协作流程见 [AGENTS](AGENTS.md)。

## 产品目标与范围

项目中文名称为“Alice’s 实验室”，英文为“Alice’s Lab”，简称 DVI Lab；页头副标题统一为“Deep Vein Idle”，品牌图标使用金色线条烧瓶。浏览器标题、启动提示及用户文档遵循[共用命名规则](docs/shared.md#项目命名)。产品通过战斗、采集与制造模拟、强化成本测算、精通规划及热门加成预报，辅助选择目标和角色配置。各页面的输入、计算边界和验收标准由下表中的设计文件维护；发布状态见[当前状态](docs/status.md)。

计算优先复用已核验的原始实现，在访问者浏览器本地执行，静态网页部署到 Cloudflare Pages。模拟普通怪物及支持的采集／制造任务；世界首领仅作静态估算，实际团战模拟未实现。

手动配置为主要路径，另支持角色 userscript 导入配置及隐藏调试页的配置文件操作；不提供完整角色快照模拟、粘贴导入、账号登录、角色操作或私有接口调用。userscript 仅负责角色配置读取与本地传递；市场报价由实验室直接读取官方公开 API，利润由实验室计算。

## 当前规则与维护入口

| 主题 | 文档 |
| --- | --- |
| 物品价格数据、访问协议及页面定价 | [物品价格模块](docs/modules/item-prices.md) |
| 导航、语言、布局、保存、角色自动更新、页脚、赞赏及全局物品价格 | [共用页面框架](docs/shared.md) |
| 数值、次数、百分比和掉落期望数量 | [数字格式化](docs/number-format.md) |
| 使用次数、活跃角色和上报协议 | [使用统计](docs/modules/usage-statistics.md) |
| 战斗配置、模拟、利润与世界首领估算 | [战斗页面](docs/pages/combat.md) |
| 采集配置、最近点与统计 | [采集页面](docs/pages/gathering.md) |
| 制造配置、配方速率与利润 | [制造页面](docs/pages/crafting.md) |
| 技能首领的投喂成本、耗时与经验 | [投喂性价比页面](docs/pages/boss-feed.md) |
| 强化概率、投入与收费测算 | [强化页面](docs/pages/enhancement.md) |
| 精通点数、升级成本与最优分配搜索 | [精通页面](docs/pages/mastery.md) |
| 热门日程与筛选 | [预报页面](docs/pages/forecast.md) |
| 中文公式内容与阅读交互 | [公式页面](docs/pages/formulas.md) |
| 角色配置文件导入与导出 | [调试页面](docs/pages/debug.md) |
| 导入协议、模块职责、原始代码与上游更新 | [技术方案](docs/technical.md) |
| 运行、测试与内容维护 | [本地开发](docs/development.md) |
| 打包、部署与发布验收 | [发布流程](docs/release.md) |
| 生产基线、本地变更、限制与证据入口 | [当前状态](docs/status.md) |
| 尚未实现的方向 | [后续范围](docs/roadmap.md) |

历史证据从 [报告索引](reports/README.md) 查阅，[验证归档](reports/validation-history.md)保留迁出的旧记录；历史结论不作为当前规则或本次重跑结果。以下兼容入口保留旧章节链接。

<details>
<summary>旧章节链接兼容入口</summary>

- <a id="1-产品目标与范围"></a> [产品目标与范围](#产品目标与范围)
- <a id="2-共用页面框架"></a> [共用页面框架](docs/shared.md)
- <a id="3-战斗页面"></a> [战斗页面](docs/pages/combat.md)
- <a id="4-强化页面"></a> [强化页面](docs/pages/enhancement.md)
- <a id="精通页面"></a> [精通页面](docs/pages/mastery.md)
- <a id="5-预报页面"></a> [预报页面](docs/pages/forecast.md)
- <a id="调试页面"></a> [调试页面](docs/pages/debug.md)
- <a id="公式页面"></a> [公式页面](docs/pages/formulas.md)
- <a id="采集页面"></a> [采集页面](docs/pages/gathering.md)
- <a id="制造页面"></a> [制造页面](docs/pages/crafting.md)
- <a id="6-共用技术与发布"></a> [共用技术与发布](docs/technical.md)
- <a id="64-上游更新流程"></a> [上游更新流程](docs/technical.md#64-上游更新流程)
- <a id="65-静态托管与发布"></a> [静态托管与发布](docs/release.md)
- <a id="7-验证状态"></a> [验证状态](docs/status.md)
- <a id="8-后续范围与文档维护"></a> [后续范围与文档维护](docs/roadmap.md)
- <a id="21-导航与网址"></a> [2.1 导航与网址](docs/shared.md#21-导航与网址)
- <a id="22-语言布局与持久化"></a> [2.2 语言、布局与持久化](docs/shared.md#22-语言布局与持久化)
- <a id="23-项目页脚"></a> [2.3 项目页脚](docs/shared.md#23-项目页脚)
- <a id="24-全局物品价格"></a> [2.4 全局物品价格](docs/shared.md#24-页面估值与全局行情)
- <a id="25-共用验收"></a> [2.5 共用验收](docs/shared.md#25-共用验收)
- <a id="31-页面结构"></a> [3.1 页面结构](docs/pages/combat.md#31-页面结构)
- <a id="32-导入配置"></a> [3.2 导入配置](docs/pages/combat.md#32-导入配置)
- <a id="33-角色与模拟配置"></a> [3.3 角色与模拟配置](docs/pages/combat.md#33-角色与模拟配置)
- <a id="331-战斗风格与技能"></a> [3.3.1 战斗风格与技能](docs/pages/combat.md#331-战斗风格与技能)
- <a id="332-装备"></a> [3.3.2 装备](docs/pages/combat.md#332-装备)
- <a id="333-食物与药水"></a> [3.3.3 食物与药水](docs/pages/combat.md#333-食物与药水)
- <a id="334-家园与精通"></a> [3.3.4 家园与精通](docs/pages/combat.md#334-家园与精通)
- <a id="335-完整手动模拟条件"></a> [3.3.5 完整手动模拟条件](docs/pages/combat.md#335-完整手动模拟条件)
- <a id="336-模拟配置"></a> [3.3.6 模拟配置](docs/pages/combat.md#336-模拟配置)
- <a id="34-属性利润与列表交互"></a> [3.4 属性、利润与列表交互](docs/pages/combat.md#34-属性利润与列表交互)
- <a id="35-静态计算规则"></a> [3.5 静态计算规则](docs/pages/combat.md#35-静态计算规则)
- <a id="36-连续模拟与结果统计"></a> [3.6 连续模拟与结果统计](docs/pages/combat.md#36-连续模拟与结果统计)
- <a id="37-验收与已知限制"></a> [3.7 验收与已知限制](docs/pages/combat.md#37-验收与已知限制)
- <a id="41-页面布局与角色配置"></a> [4.1 页面布局与角色配置](docs/pages/enhancement.md#41-页面布局与角色配置)
- <a id="42-装备保护与价格设置"></a> [4.2 装备、保护与价格设置](docs/pages/enhancement.md#42-装备保护与价格设置)
- <a id="43-角色配置导入"></a> [4.3 角色配置导入](docs/pages/enhancement.md#43-角色配置导入)
- <a id="44-结果展示与范围边界"></a> [4.4 结果展示与范围边界](docs/pages/enhancement.md#44-结果展示与范围边界)
- <a id="45-计算规则"></a> [4.5 计算规则](docs/pages/enhancement.md#45-计算规则)
- <a id="46-验收与验证边界"></a> [4.6 验收与验证边界](docs/pages/enhancement.md#46-验收与验证边界)
- <a id="页面与配置"></a> [页面与配置](docs/pages/mastery.md#页面与配置)
- <a id="计算规则与实现"></a> [计算规则与实现](docs/pages/mastery.md#计算规则与实现)
- <a id="验收"></a> [验收](docs/pages/mastery.md#验收)
- <a id="51-当前热门筛选与日程"></a> [5.1 当前热门、筛选与日程](docs/pages/forecast.md#51-当前热门筛选与日程)
- <a id="52-验收与已知限制"></a> [5.2 验收与已知限制](docs/pages/forecast.md#52-验收与已知限制)
- <a id="61-角色导入组件与-userscript-协议"></a> [6.1 角色导入组件与 userscript 协议](docs/technical.md#61-角色导入组件与-userscript-协议)
- <a id="62-原始代码复用"></a> [6.2 原始代码复用](docs/technical.md#62-原始代码复用)
- <a id="63-模块职责"></a> [6.3 模块职责](docs/technical.md#63-模块职责)

- <a id="71-页面专项历史验证"></a> [页面专项历史验证](reports/validation-history.md#71-页面专项历史验证)
- <a id="81-后续范围"></a> [后续范围](docs/roadmap.md)
- <a id="82-维护约定"></a> [维护约定](AGENTS.md)

</details>
