# 实测结果

## 双方付款确认与移动浏览器（最新验收）

本节取代下方旧版单方还款流程和旧测试数量。本轮未部署、未写入生产财务数据、未迁移历史记录；所有自动化财务写入均针对 demo-settle。

| 检查                       | 结果                                                   |
| -------------------------- | ------------------------------------------------------ |
| `npm run lint`             | PASS，无错误/警告                                      |
| `npm run typecheck`        | PASS，严格 TypeScript                                  |
| `npm run test`             | PASS，6 文件、85 项；包含原 30 项财务测试              |
| `npm run test:integration` | PASS，6 文件、126 项安全/集成测试                      |
| `npm run test:e2e`         | PASS，19 场景：桌面 15、移动 Chromium 2、移动 WebKit 2 |
| `npm run build`            | PASS，静态 Vite production 构建                        |
| 财务算法及原财务单元测试   | 与修改前逐字节一致                                     |
| 发布目标                   | bill9206；Hosting dist；生产模拟器关闭，无 demo 凭据   |

新增测试覆盖净额抵消后待收/待付金额和不同转账笔数、零余额、多成员守恒；待确认不影响财务、部分确认、拒绝、取消、全部终态、请求幂等、不同 ID 重复申请、同时确认、取消/确认和拒绝/确认竞争、与费用编辑并发、版本过期、无权确认、完整伪造五文档确认包、金额/身份替换、审计遗漏、直接旧版单方还款绕过、重放，以及历史还款只读。

中英文原完整财务场景已改用付款人申请/收款人确认，费用编辑、分摊、借款、软删除/恢复、历史版本恢复、实时余额、邀请与私有访问仍通过。新 UI 场景覆盖收款确认、拒绝、取消、状态历史、过期请求和只读还款。桌面弹窗实际被拦截时成功转为 redirect，且刷新保持会话。

Chromium 与 WebKit 均真实运行手机视口、触摸/移动 UA 的 Google redirect、邮箱密码注册/退出/登录、刷新、语言切换、表单草稿保留和双方付款流程。先复现 WebKit 中跨端口 Auth 辅助 iframe 返回后丢失重定向结果，再用仅开发环境同源代理修复并通过。另补上手机头像控件的中英文无障碍名称与 44px 触摸区域。截图已目视检查，没有页面横向溢出。

真实 iOS/Android 设备和线上 Google consent/存储策略仍需发布后人工验收。Rules 不独立汇总全账本；完整方案重算在读取服务器数据的客户端事务中进行，Rules 强制双方身份、金额一致、版本、原子性与历史保护。任一账本 revision 改变会使待确认申请过期，须取消/拒绝后重新申请。

完整实现、信任边界、变更文件与发布命令见 [TWO-PARTY-PAYMENTS.md](TWO-PARTY-PAYMENTS.md)。**必须先部署 Rules/indexes，再发布 Hosting，并让旧页面刷新。** 以下验收结果保留为历史。

## 2026-11-12：邀请修复与中英文支持（最新结果）

此节取代下面的历史验收状态。项目已有生产版本；本轮只读检查部署规则、静态资源和配置元数据，没有部署，也没有写入生产 Firestore。

| 检查                       | 最终结果                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run lint`             | PASS，无错误/警告                                                |
| `npm run typecheck`        | PASS，strict TypeScript                                          |
| `npm run test`             | PASS，4 文件、61 项（含原 30 项财务测试）                        |
| `npm run test:integration` | PASS，5 文件、72 项安全/集成测试                                 |
| `npm run test:e2e`         | PASS，13 场景，中英文完整财务流程、Google 邀请与账户流程         |
| `npm run build`            | PASS，Vite production，2.48 秒，无体积警告                       |
| `npm audit --omit=dev`     | PASS，生产依赖 0 漏洞                                            |
| 注册 Web App 与 Auth       | 配置匹配；真实 Auth 只读接口 HTTP 200；Hosting 域名已授权        |
| 构建目标                   | `bill9206`，Hosting `dist`，模拟器关闭，无 demo 凭据             |
| 财务计算                   | `src/domain/finance.ts` 与修改前逐字节相同                       |
| Spark                      | Cloud Billing `billingEnabled: false`；无新增付费服务或 TTL 策略 |

安全回归使用冻结的线上规则快照重现“客户端时钟快一分钟时拒绝邀请”及过期账本快照的拒绝路径；新规则/服务验证服务器有效期、最新所有者信息、大小写邮箱匹配、旧邀请兼容、过期/撤销/重复使用拒绝、越权/匿名读取与创建拒绝、邀请字段不可篡改，以及历史五人上限和已有财务审计约束。实际 Auth + Firestore 模拟器还验证先注册的 Google 受邀账户，以原 UID 加入另一个 Google 所有者的账本。

Playwright 在两种语言下运行同一套完整财务场景，覆盖平均/指定金额/百分比分摊、排除付款人、借款/部分还款、结算确认、软删除与版本恢复、实时余额、跨账本隔离、离线状态、资料、重置密码和第三人拒绝访问。另有默认中文（浏览器 en-US）、即时切换、刷新及重新打开后保持语言、表单输入切换不丢失、动态通知切换、中文验证提示、翻译后的结算描述搜索、两个已注册 Google 用户创建/接受/撤销/拒绝重用邀请。中英文桌面与 390px 截图已目视检查，窄屏无页面横向溢出。

缺少原失败请求和设备时间，不能事后证明其唯一触发原因。真实 Hosting 的 Google consent/redirect 和全流程邀请需在所有者手动发布后验收。新前端依赖新邀请规则，**必须先部署 Rules/indexes，成功后再发布 Hosting**。没有缺失的 Firebase 配置值，没有执行发布。

完整证据、实现、文件清单与命令：[INVITATIONS-I18N.md](INVITATIONS-I18N.md)。以下各节保留作为旧版本历史。

## 2026-11-12：发布阻塞项已修复并复验

本节取代此前 API key 仅作静态匹配验证及规则未修改的历史状态。没有部署，没有修改生产 Firestore 文档或生产规则；真实接口只读取 Web App / Auth 配置元数据。

### API key 的诊断与实际验证

- 原 .env.local 文件值 = Vite production 有效值 = 原先提供的 key，因此不是 Vite 没有正确加载。该值与注册 Web App 的登记值相差一个字符，并被 Auth 配置接口返回 HTTP 400 / API key not valid。
- 从已授权的 Firebase CLI 会话读取注册 Web App config，使用返回的确切 apiKey，未猜测、生成或创建 key。
- projectId、appId、authDomain、storageBucket、messagingSenderId 均与注册 Web App 匹配；后两项不由当前应用使用。
- 登记值在只读 Auth 项目配置接口实际返回 HTTP 200，并确认 bill9206.web.app 已授权。验证通过后仅更新本地忽略的 .env.local，不在文档/模板中打印 key。
- 构建后再次用产物对应的 key 获取 Auth 配置，仍为 HTTP 200。产物包含四项有效配置，无旧无效 key、无 demo-settle 配置；模拟器关闭。

### 规则漏洞重现与回归

临时的本地模拟器证明脚本先加载备份的旧规则：

```text
LEGACY RULES: accepted duplicate UID
LEGACY RULES: accepted over-five duplicate list
```

随后测试程序加载项目的新严格规则。新 tests/membership.regression.test.ts 有 11 个回归用例，覆盖重复/超限、删所有者、移除他人、未邀请 UID、替换为非活跃历史 UID、空/非列表、删除历史/新增第六人/更改所有者，以及五人满额正常退出。合法退出时财务记录和审计不变、成员历史不变，离开者读取被拒绝。原有六人限制与重新加入测试也全部通过。

| 检查                                                         | 本次结果                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| npm run lint                                                 | 通过，无错误/警告                                        |
| npm run typecheck                                            | strict TypeScript 通过                                   |
| npm run test                                                 | 3 文件、51 项单元测试通过                                |
| demo-settle emulators:exec + 旧漏洞重现 + npm run test:rules | 旧漏洞真实重现；3 文件、45 项安全/集成测试通过，退出码 0 |
| npm run test:e2e                                             | 6 场景通过，38.0 秒，退出码 0                            |
| npm run build                                                | 成功，3.53 秒，无体积警告                                |
| 构建目标与 key                                               | bill9206、模拟器关闭、Auth HTTP 200                      |

45 项安全/集成包含原 31 项财务与安全用例、3 项 Google 集成和新增 11 项成员回归。所有会写测试数据或加载测试规则的操作均限定在本地 demo-settle 模拟器。此次没有重新执行依赖审计；旧审计属于后方历史记录。

财务计算、金融数据服务、Auth 源码、Hosting/索引配置、依赖 lockfile 和原测试文件逐字节未改；新规则中邀请/金额/审计部分也与修复前逐字节相同。修改仅增加共享成员校验并应用于自行退出，创建和加入沿用等价约束。

新 firestore.rules SHA-256：`553b038355210f56bf0715bd20f189a17be9172237c5bbc359f6111212431a67`。

已解决本次两项部署阻塞，可由所有者执行部署；本次没有执行 firebase deploy。真实 Google consent、托管 handler/CSP 和两名真实用户的生产协作仍须在部署后进行 smoke test，不能由模拟器验证替代。

## 2026-11-12：Web App 本地配置完成

本节取代下方历史记录中关于 apiKey / appId 尚缺、`.env.local` 尚未创建的状态说明。已将所有者提供的 bill9206 Web App 配置写入忽略的 `.env.local`，未将值写入文档或模板。当前项目使用 Auth/Firestore，只需四项 Vite Firebase 配置；不使用 Storage/Messaging 字段。

- `npm run typecheck`：通过（`tsc --noEmit`）。
- `npm run build`：通过，Vite 构建 2.56 秒，无体积警告。入口 JS 63.26 kB（gzip 19.91 kB）。
- Vite production 环境解析：projectId = bill9206、authDomain 和 appId 与提供值一致、API key 已加载、模拟器开关 false。
- 静态检查当前 HTML 指向的构建入口，确认四项配置均已编入且没有 demo-settle 配置。未执行 Firebase SDK 或访问线上服务来完成这项检查。
- 使用相同 `.gitignore` 在临时空 Git 仓库运行实际 Git 忽略检查：`.env.local` 被忽略，`.env.example` 可跟踪。原项目无 `.git` 元数据；未在项目中创建 Git 仓库。
- 37 个既有源码、测试、安全规则和配置文件 SHA-256 未变。没有新增或运行功能测试，因为本轮只改变环境配置及相关文档；此前测试结果保留在下方，不计作本轮重跑。
- 未部署、未进行真实 Google/邮箱登录、未修改线上 Firestore。剩余生产前提是 Console 的支持邮箱/授权域/账号关联设置核对、由所有者决定发布后部署，以及真实 OAuth、托管 handler 和 CSP 验收。

## 2026-11-12：Google 登录与 bill9206 本地准备

实际项目目录：`/Users/test/billSystem`。用户原先给出的 `/Users/test/cmput328/billSystem` 已不存在，确认是移动后的同一份实现；没有创建另一份项目副本。本次未连接线上项目、未创建真实用户、未修改线上数据库、未执行部署。

| 命令                       | 本次结果                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run lint`             | 通过，0 错误/警告                                                         |
| `npm run typecheck`        | `tsc --noEmit` 通过                                                       |
| `npm run test`             | 3 个文件，51 项通过（原 30 项财务 + 17 项认证 + 4 项配置）                |
| `npm run test:integration` | 2 个文件，34 项通过（原 31 项规则/事务 + 3 项 Google 身份集成），退出码 0 |
| `npm run test:e2e`         | 6 个场景通过（原 3 个 + 3 个真实模拟器 Google 弹窗），33.3 秒，退出码 0   |
| `npm run build`            | strict TypeScript + Vite 成功，无体积警告，2.41 秒                        |

生产构建输出：

```text
dist/index.html                          0.78 kB | gzip:   0.42 kB
dist/assets/index-*.css                  25.85 kB | gzip:   6.53 kB
dist/assets/index-*.js                   63.17 kB | gzip:  19.82 kB
dist/assets/firebase-auth-*.js          108.41 kB | gzip:  32.53 kB
dist/assets/react-*.js                  221.27 kB | gzip:  68.83 kB
dist/assets/firestore-*.js              456.43 kB | gzip: 136.06 kB
✓ built in 2.41s
```

Google 新覆盖：

- 单元验证账户选择器、直接 popup 调用、已登录用户明确关联、意外 UID 变化拒绝、凭据冲突不合并；只初始化本人 Google 资料、已有名字保留、缺失/超长名称处理、初始化失败传播；取消/阻止/未授权域等可操作错误提示。
- 集成通过真实 Firebase Auth/Firestore 模拟器 SDK 验证：Google 身份与本人资料创建；自定义名字保留；密码和 Google 关联后 UID、原账本归属不变，两个方式都可登录；凭据已属于另一 UID 时被拒绝。
- 浏览器实际打开 `127.0.0.1:9099/emulator/auth/handler` 的官方本地身份页面，填写 Google 身份、退出再登录、确认原账本保留；显式关联后原密码仍可登录；取消 Google 弹窗后邮箱密码仍可用。
- 原三组财务/邀请/实时同步/历史/窄屏/密码重置场景未改且全部通过。
- 本次没有新增依赖或改变 lockfile；没有重新运行在线依赖审计，旧审计结果仅属于下面的历史验证。

保护检查：修改前后 SHA-256 比对确认 `firestore.rules`、`src/domain/finance.ts`、`src/services/ledger.ts`、原财务和规则测试逐字节不变。

```text
firestore.rules SHA-256:
180a8a0723e778aafa21e01699c4af9e084a291565b8b3dc82e34cd07716f8f0
```

配置准备已验证：`.firebaserc` default 为 bill9206；所有模拟器命令仍明确 `--project demo-settle`；Playwright 不复用未知端口服务器；Hosting CSP 支持 Firebase Google iframe 和 gapi 脚本；经典静态 Hosting，无 Functions、App Hosting 或付费服务。现有查询不需要新增索引。

**外部验证边界**：只有项目 ID 和默认 authDomain 已知，尚无 Web App 的 apiKey/appId，也未创建 `.env.local`。当前默认构建会显示缺少配置的引导，不可当作已连通生产。Google 的真实 consent、支持邮箱、授权域、托管认证 handler、生产 CSP 和项目实际用量均未在线验证。补齐配置、重新构建并由所有者决定部署后再验收。配置步骤见 [FIREBASE-SETUP.md](FIREBASE-SETUP.md)。

## 2026-11-11：初始实现的历史验证

验证日期：2026-11-11（用户所在时区 America/Edmonton）。项目路径：`/Users/test/cmput328/billSystem`。

## 环境

- Node.js 22.23.5、Java 21.0.13；开发运行时在本次任务中临时下载到 `/tmp`，未更改系统安装。
- React 19.3.1、Firebase JS SDK 12.19.0、TypeScript 5.9.3、Vite 7.3.8。
- Vitest 5.1.0、Firebase CLI 15.36.0、Playwright 1.65.0。
- Firebase 官方 Auth / Firestore 本地模拟器，项目 `demo-settle`，无需生产凭据。
- 浏览器为本机 Google Chrome。桌面 1440px 和窄屏 390px 已实际检查。

## 最终运行

| 命令                                          | 实测结果                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run lint`                                | 成功，0 错误、0 警告                                                         |
| `npm run test`                                | 1 个文件、30 项财务单元测试通过                                              |
| `npm run test:integration`                    | 自动启动/停止模拟器，1 个文件、31 项安全规则及 SDK 集成测试通过，退出码 0    |
| `npm run test:e2e`                            | 自动启动/停止模拟器及 Vite，3 个浏览器场景全部通过，最终约 12.2 秒，退出码 0 |
| `npm run build`                               | strict TypeScript 和 Vite 构建成功，约 1.48 秒，无体积警告                   |
| `npm audit --omit=dev --audit-level=moderate` | `found 0 vulnerabilities`                                                    |
| `npm audit`                                   | 20 个 moderate 受影响包条目，0 high、0 critical；均属于开发工具依赖树        |

最终 Vitest 摘要：

```text
Test Files  1 passed (1)
     Tests  30 passed (30)

Test Files  1 passed (1)
     Tests  31 passed (31)
```

最终 Playwright 摘要：

```text
✓ two friends share, edit, repay, restore and see real-time audited balances
✓ exact and percentage forms, excluded payer, loans, ledger isolation and offline state
✓ profile, persistent login and password-reset flow with emulator email
3 passed (12.2s)
✔ Script exited successfully (code 0)
```

最终生产构建：

```text
dist/index.html                          0.78 kB | gzip:   0.42 kB
dist/assets/index-*.css                  25.39 kB | gzip:   6.43 kB
dist/assets/index-*.js                   58.69 kB | gzip:  18.55 kB
dist/assets/firebase-auth-*.js          107.80 kB | gzip:  32.34 kB
dist/assets/react-*.js                  221.27 kB | gzip:  68.83 kB
dist/assets/firestore-*.js              456.43 kB | gzip: 136.05 kB
✓ built in 1.48s
```

构建时未提供个人 Firebase 配置，所以默认构建会显示配置引导。连接生产项目后必须重新构建。E2E 显式使用模拟器环境，测试真实 Firebase SDK 流程，没有 mock 财务数据服务。

## 覆盖与修复

- 单元：等额、精确、百分比、舍入余数、五人极小额、付款人不参与、直接借款、部分/多次还款、债务环、结算建议、零余额、编辑、删除恢复、还款纠正、非法金额、币种精度、安全整数和零和守恒；对象字段顺序不会影响重试识别或差异高亮。
- 规则与集成：未认证/非成员拒绝、跨账本与错误成员引用、错误金额/币种/份额/比例、actor/服务器时间伪造、缺失或单独伪造审计、审计改删、记录硬删除、过期/错误邮箱/未验证/撤销/已使用邀请、原子兑换、旧版本和并发编辑、还款重复提交与纠正、旧结算建议拒绝、五人满额与同 UID 重新加入。
- 额外并发回归：即使 UI 已收到新的 ledger revision，但交易监听还显示旧建议，也必须从服务器重算并拒绝旧金额。
- 浏览器第一场景：两个独立会话注册、验证邮箱、建账、邀请加入、创建/编辑支出、跨窗口实时余额、部分还款、结算确认、软删除与恢复、历史版本恢复、第三账号 REST 访问被拒、退出、390px 无页面横向溢出。
- 浏览器第二场景：实际填写精确/百分比分摊、取消付款人参与、借款/还款、CAD/USD 账本切换隔离、刷新保持会话、离线提示与禁止新建财务交易。
- 浏览器第三场景：改名、刷新后保持资料和登录、请求密码重置、通过模拟器邮件操作码完成重置、使用新密码登录。
- UI 复核修复：忽略未得到服务器确认的本地乐观成员快照，避免新账本订阅过早被拒绝；读取失败不显示虚假的零余额；表格的辅助标签保持在滚动容器内；对话框标题 ID 唯一；保存中禁用财务表单。

截图来自真实 E2E 模拟器运行（不是生产演示数据）：[桌面](screenshots/overview.png)、[390px 窄屏](screenshots/mobile.png)。生产没有测试账号或预置交易。

## 依赖审计的边界

关键/高风险告警已处理：升级 Vitest，并通过 `package.json` 的 override 将 Firebase Node 侧 `@grpc/grpc-js` 更新到修复版本。生产依赖审计为零告警。

完整开发依赖树仍报告 20 个中等风险受影响包条目，涉及 Firebase CLI/ESLint 的传递依赖（OpenTelemetry Core、glob/minimatch、uuid 等）。这些是多个依赖链的包条目，不等于 20 个独立漏洞；未打包进网页。自动修复建议含降级 Firebase 等不安全或破坏性变更，因此未盲目运行 `npm audit fix --force`。本地工具仅绑定 loopback。开发工具上游发布兼容修复后应更新 lockfile 并重跑测试。

## 已实现但未在外部验证

Firebase Spark 部署配置、生产安全规则与索引文件、真实 Auth/Firestore 配置入口、Hosting 安全响应头均已准备。以下需要项目所有者提供自己的 Firebase 项目并执行 README：

- 生产 Email/Password 开启、授权域、真实邮箱验证与密码重置送达。
- 生产 Firestore 区域、实际项目配额/用量和多设备公网同步。
- 项目 CLI 登录、规则/Hosting 发布和公开 Hosting URL。

**没有连接或部署到个人 Firebase 账号，没有声明网站已发布。** 本地模拟器测试不能替代项目所有者的生产验收。
