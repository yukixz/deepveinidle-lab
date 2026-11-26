# Alice’s 实验室 / Alice’s Lab

Alice 制作的非官方 Deep Vein Idle 辅助工具，简称 DVI Lab，提供战斗利润比较、采集与制造模拟、技能首领投喂性价比、强化成本测算、精通点数规划、热门加成预报及战斗公式查阅。支持简体中文和英文（公式页面仅中文），计算在浏览器本地执行，无需登录游戏。公式页隐藏导航入口，可通过 `/formulas` 直接访问。

可手动配置，也可通过角色 userscript 导入配置；市场报价直接从官方公开 API 导入，无需安装脚本或在游戏中浏览市场。行情默认在打开或聚焦网站时按间隔自动更新，可在模拟配置的“物品价格 → 全局行情与锁定”中关闭“自动更新价格”；详细规则见[全局物品价格](docs/shared.md#24-页面估值与全局行情)。

[打开线上实验室](https://dvi-lab.pages.dev/) · [功能与设计](DESIGN.md) · [变更日志](docs/changelog.md)

管理员可通过 `/usage` 查看按 UTC 汇总的使用统计。 [访问与查询规则](docs/modules/usage-statistics.md#使用统计页)

## 快速启动

需要 Node.js 20+。运行网页无需安装开发依赖：

```sh
node scripts/serve.mjs
```

打开 [本机页面](http://127.0.0.1:4173)。安装依赖、测试、原始代码提取与本机服务边界见 [本地开发](docs/development.md)；生产版本、部署与验证证据见[当前状态](docs/status.md)。

日常 `main` 提交通过 GitHub Actions 发布至 [Preview](https://preview.dvi-lab.pages.dev/)；发布正式 GitHub Release 后自动检查并部署生产。凭证配置、验证及回退见[部署与发布](docs/release.md)。远端启用与实跑状态见[当前状态](docs/status.md)。

## 文档入口

| 用途 | 文件 |
| --- | --- |
| 功能、交互、计算规则与验收 | [设计索引](DESIGN.md)，按页面及共用能力查阅 |
| 本地运行、测试、重新提取 | [本地开发](docs/development.md) |
| 模块职责、导入协议、原始代码与上游更新 | [技术方案](docs/technical.md) |
| 发布包、Cloudflare 部署与发布验收 | [部署与发布](docs/release.md) |
| 生产基线、待发布验证状态 | [当前状态](docs/status.md) |
| 尚未实现的功能方向 | [后续范围](docs/roadmap.md) |
| 历史调研、实施和发布证据 | [报告索引](reports/README.md)，含验证归档、专题与逐版发布报告 |
| 协作流程及文档维护 | [AGENTS.md](AGENTS.md) |

项目作者（游戏昵称）：Alice；交流 QQ 群：897891232。原游戏代码、素材及相关资源归原作者或相应权利人所有，本项目独立维护，不代表官方授权或认可。
