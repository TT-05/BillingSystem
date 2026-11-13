# Settle — Shared Expense & Debt Settlement

一个给朋友、室友使用的私人共享账本。React + TypeScript strict + Vite，使用 Firebase Authentication、Cloud Firestore、安全规则和 Firebase Hosting。没有付款处理、自动汇率转换、Cloud Functions 或付费扩展。

最新邀请修复、双语使用说明与部署顺序：[INVITATIONS-I18N.md](docs/INVITATIONS-I18N.md)。最终测试：[TEST-RESULTS.md](docs/TEST-RESULTS.md)。本轮未部署。

## 已实现

- 简体中文（默认）/ English 即时切换，选择本地保存；日期、金额、错误与财务历史随语言显示，用户输入原样保留。

- 邮箱密码与 Google 登录、退出、持久登录、密码重置、邮箱验证、显示名资料；可在已登录账户中明确关联 Google。
- 多账本、CAD / USD / CNY（默认 CAD）、所有者设置、成员自行退出。
- 绑定收件邮箱的一次性 256 位邀请链接：7 天有效、要求已验证邮箱、支持撤销。链接需要自行分享，应用不会自动发送邀请邮件。
- 支出：付款人可不参加分摊，支持等额、精确金额、百分比分摊；日期、备注、搜索、排序、类型筛选、详情。
- 直接借款、部分或多次还款、结算建议、实际付款确认；纠正还款使用有审计记录的编辑或软删除。
- 每次财务修改都有不可由客户端改写的版本历史、服务器时间、操作人 UID、完整前后快照和字段差异；软删除、恢复、恢复历史版本。
- 实时更新、并发版本检查、稳定提交 ID、离线与错误提示、可访问对话框、桌面与窄屏布局。

**范围：每账本最多 5 个历史成员 UID（包括离开者）。** 为在 Firestore Rules 的表达式上限内验证每种分摊，明确限制为原需求的五人规模。离开者不占活跃名额，但其历史 UID 仍占历史名额；离开者可用同一 UID 通过新邀请重新加入，即使历史名额已满。所有者不能退出，暂不支持所有权转让、移除别人、永久删除账本或删除账号。

## 快速开始：完全本地、无需 Firebase 账号

前提：Node.js 22.12+（推荐最新 22 LTS）、npm、Java 21+。macOS 可通过 Homebrew 安装：

```sh
brew install node@22 openjdk@21
export PATH="$(brew --prefix node@22)/bin:$PATH"
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```

```sh
cd /Users/test/billSystem
npm ci
# 第一个终端：Auth :9099、Firestore :8080
npm run emulators
```

第二个终端：

```sh
VITE_USE_EMULATORS=true npm run dev
```

打开终端显示的本地地址，默认 http://127.0.0.1:5173。本地注册真实测试账号；模拟器会把验证邮箱和密码重置链接打印到第一个终端。打开链接完成验证，然后在应用中点击 **刷新验证状态 / Refresh verification**。此 demo 项目无法访问生产数据。模拟器默认不保存重启前数据，如需持久本地测试数据：

```sh
npx firebase emulators:start --project demo-settle --only auth,firestore --import .firebase/local-data --export-on-exit .firebase/local-data
```

首次没有导出目录时先去掉 `--import .firebase/local-data`。模拟器仅绑定 loopback，不要将其暴露到公网。生产代码没有演示账号或假数据分支。未设置配置且未启用模拟器时会显示明确的配置引导。

## 连接 Firebase 项目 bill9206

项目已有生产版本：Spark、Firestore Standard `(default)`、Email/Password 与 Google、已注册 Web App。本轮仅只读检查云配置、已部署规则和静态资源，没有创建生产账户、写入生产数据库或执行部署。部署新版本前请按上方文档先更新邀请规则。

`.firebaserc` 已将默认项目设为 `bill9206`。模拟器和自动化测试仍显式指定 `--project demo-settle`，不使用生产项目。项目实际目录已从旧路径移动至 `/Users/test/billSystem`。

1. 在 [Firebase Console 项目设置](https://console.firebase.google.com/project/bill9206/settings/general) → **Your apps** → 选择已注册的 **Web App** → **SDK setup and configuration → Config**，复制相应值。
2. 根目录 `.env.local` 已配置；发布前审计发现原提供的 API key 存在一个字符偏差，现已从授权的注册 Web App 配置取得正确值并验证。只有新检出环境才需创建本地配置；已有文件不要覆盖：

```sh
cp .env.example .env.local
```

| SDK 配置字段 | `.env.local` 变量           | 当前需填写的内容                                                              |
| ------------ | --------------------------- | ----------------------------------------------------------------------------- |
| `apiKey`     | `VITE_FIREBASE_API_KEY`     | 本地 `.env.local` 已填入授权取得并经 Auth HTTP 200 验证的登记值，模板保持空值 |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` | 默认已填 `bill9206.firebaseapp.com`；核对与实际 Web App 配置一致              |
| `projectId`  | `VITE_FIREBASE_PROJECT_ID`  | 已填 `bill9206`                                                               |
| `appId`      | `VITE_FIREBASE_APP_ID`      | 本地 `.env.local` 已填入提供的完整 appId，模板保持空值                        |

保持 `VITE_USE_EMULATORS=false` 才会使用真实项目。无需 `storageBucket`、`messagingSenderId`、`measurementId`、Google OAuth client secret 或 service account。不要把任何秘密放进 `VITE_*`；这类变量会出现在浏览器构建中。Firebase Web 配置本身公开，安全性依赖 Auth 和 Firestore Rules。`.env.local` 已被忽略。

3. Authentication → Sign-in method → 确认 Email/Password 和 Google 均启用；Google provider 需要已保存的项目支持邮箱。保持 **one account per email / link accounts that use the same email**，避免为同一邮箱分别创建独立 Firebase 身份。
4. Authentication → Settings → Authorized domains：核对 `bill9206.firebaseapp.com`、`bill9206.web.app`；本地使用真实 Google OAuth 时还需授权 `localhost`、`127.0.0.1`。填写主机名，不含协议或端口。检查验证/重置邮件模板和发送限制。
5. 若 Console 的 Web OAuth 客户端需要核对 redirect URI，默认 Firebase handler 为 `https://bill9206.firebaseapp.com/__/auth/handler`。当前使用 Firebase SDK 的弹窗流程，不手工创建 OAuth 客户端、不传 client secret。
6. 保持 Firestore 为已创建的 Standard `(default)` 生产数据库。规则文件、索引文件已在本地准备，不要改用测试模式或允许所有 authenticated 访问。

详细配置、冲突处理、部署前步骤见 [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md)。

## Google 登录和账户关联

登录/注册界面可选 **Continue with Google**，原邮箱密码入口保持。Google 弹窗取消、被拦截、未授权域名和账户冲突都有明确提示；没有自动 redirect 回退。允许本站弹窗后可重试。

新 Google 账户先以 Firebase UID 创建 `users/{uid}` 资料，使用合法长度的 Google 显示名（无名称时使用邮箱前缀或 Member）。已有自定义资料名会保留；现有账本成员快照和财务历史不修改。资料初始化失败会显示重试/退出入口，不假装已同步。

若报告 **account-exists-with-different-credential**：用原登录方式进入原账户，打开 **Account & profile → Link Google account**，在新弹窗中明确选择 Google 账户。只有 Firebase 成功关联后显示成功；不会按邮箱搬迁账本、删除旧用户、缓存 pending OAuth credential 或绕过 Firebase 的凭据冲突检查。Google 凭据已属于另一个 UID 时，应用拒绝合并并保留两边数据。Firebase 自身对可信邮箱提供商的自动关联行为仍由 Firebase 的账户设置控制。

## 生产构建和 Firebase Hosting 部署

**本次任务没有执行以下部署命令，也未测试真实 OAuth 或线上数据库。** 补齐 Web App 配置、准备好发布后，项目所有者执行：

```sh
cd /Users/test/billSystem
# 核对 .env.local 的四项值和 VITE_USE_EMULATORS=false
npx firebase login
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
# 仅在你决定部署时执行：
npx firebase deploy --project bill9206 --only firestore:rules,firestore:indexes
npx firebase deploy --project bill9206 --only hosting
```

`firebase.json` 使用经典静态 Hosting（`dist`），不是需要付费后端的 App Hosting。SPA 回退、安全响应头和静态缓存已配置；CSP 仅额外允许 Google 登录必需的 `apis.google.com` 脚本和 `bill9206` Firebase auth iframe，继续禁止第三方嵌入应用。如果使用自定义 authDomain，需要同步审查 CSP 的 script/connect/frame 来源。认证 handler 由 Firebase 保留的 `/__/auth/*` 路由提供，不在 React 中实现。

`.firebaserc` 已配置默认项目，但发布时仍明确使用 `--project bill9206`。预期默认地址为 `https://bill9206.web.app`；本次仅只读检查了现有站点资源，未执行部署。无自定义域名费用，无 Cloud Functions、Cloud Run、Storage 或扩展。该架构可在 Spark 内使用，仍需遵守 Auth、Firestore、Hosting 免费额度。[官方定价](https://firebase.google.com/pricing)

Vite 会将环境变量编译到静态产物中，填完配置必须重新构建。本地缺少配置时构建可以成功，但页面会显示配置引导；**这不代表可以直接发布成可用生产站点**。真实 Google consent、支持邮箱、授权域、邮件送达及生产同步仍需项目所有者发布后验收。首次真实登录会写入本人资料；本次全部测试只使用本地模拟器。

## 自动化测试

```sh
npm run lint               # ESLint + hooks 检查
npm run typecheck          # 独立 strict TypeScript 检查
npm run test               # 财务、Google 认证和配置单元测试
npm run test:integration   # 自动启动、停止 Auth/Firestore，执行规则、Google 身份及真实 SDK 事务测试
npm run test:e2e           # 自动启动、停止模拟器与 Vite，执行 Playwright
npm run build             # strict TypeScript + Vite 生产构建
```

规则测试会清空 `demo-settle` 的本地 Firestore。**集成测试和 E2E 必须顺序运行，不要共用运行中的模拟器并发测试。** 以上 `emulators:exec` 命令需要端口空闲；如果已经手动运行模拟器，可以改用 `npm run test:rules` 或 `npx playwright test`。

macOS E2E 使用已安装的 Google Chrome；其他系统使用 Playwright Chromium，先运行 `npx playwright install chromium`（Linux 缺系统库时按 Playwright 的安装提示操作）。测试通过 UI 创建账号和账本，通过 Auth 模拟器的验证邮件完成验证，用两个独立浏览器会话验证实时更新；Google 弹窗使用 Auth 模拟器的本地身份页面，不要求 Google 账号或生产凭据。Playwright 不复用已有开发服务，避免误连接带生产配置的端口。失败时 trace / screenshot 位于忽略的 `test-results/`。

详细实测结果见 [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md)。手动验收见 [docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md)。

## 使用流程

1. 注册、设置显示名并验证邮箱。使用相同邮箱登录可接受邀请。
2. Create a ledger：输入名称，选择单一币种。
3. Group settings：所有者输入朋友邮箱，创建邀请，复制链接私下分享。收件人登录正确账号、验证邮箱并 Accept invitation。非所有者无邀请权限。
4. Add expense：输入总额和付款人，选择参与人；取消付款人勾选即可替别人付款。等额自动计算；精确金额必须合计总额；百分比最多两位小数并合计 100%。
5. Expenses：搜索、筛选，点击交易详情编辑或删除。Deleted transactions 筛选能找到删除记录并恢复。
6. Balances & settlement：正数为应收，负数为应付；建议只是建议。只有真实转账后才按 Confirm paid。Record repayment 可登记部分还款；Record loan 登记直接借款。
7. Activity history：查看服务器时间、操作人、前后值；Restore this version 生成新的恢复操作。恢复支出不会撤销后来发生的还款，余额可能因此反向，这是保留真实转账的预期结果。

## 财务模型

`src/domain/finance.ts` 完全独立于 UI/Firebase，可单独测试。

- CAD/USD/CNY 都使用两位小数，以整数 minor units（分）保存金额、分摊和余额；不使用浮点数做余额运算。输入通过十进制字符串解析。
- 单条金额范围 `1..1,000,000,000` 分，即最大 10,000,000.00。百分比存整数基点（100% = 10,000）。乘法最大 `10^13`，在 JS 安全整数范围内。
- 等额：参与人按 UID 排序，先整除，余下的每一分依次给最前面的 UID。
- 精确：非负整数份额必须严格合计总额；允许某人份额为零。
- 百分比：每人先向下取整，所有余分给排序最后的 UID。因此始终与原总额严格相等；小额时最后一人的舍入差可能大于一分（最多四分）。这不是浮点误差。
- 支出：付款人余额加总额，各参与人减其份额。
- 借款：出借者加总额，借入者减总额。
- 还款：实际付款者余额增加，收款者减少；减少已有债务。允许实际超额还款或后续支出改动导致余额反向，不声称规则能扫描全部历史禁止超额还款。
- 删除记录不计入；编辑/恢复直接从当前有效版本重算；每次核对总和为零。没有冗余余额文档。
- 结算按金额从大到小匹配应付与应收，同额使用 UID 确定顺序。最多 `nonzero members - 1` 次转账，**贪心不保证全局最少转账次数**。
- 总账余额使用安全整数检查，若超出 JS 安全范围明确报错，不显示不可靠的数值。

## 架构与目录

```text
src/
  App.tsx                 页面、实时订阅、账本与记录交互
  components/             认证、对话框、财务表单、资料、邀请与设置
  hooks/useLive.ts        服务器确认后的实时快照与监听清理
  domain/types.ts         账本、财务记录、邀请与审计类型
  domain/finance.ts       金额解析、分摊、余额、结算、差异
  services/firebase.ts    环境配置、Auth 和模拟器连接
  services/ledger.ts      创建账本、邀请、原子财务事务
  services/googleAuth.ts  Google 弹窗、明确关联、保留用户资料
  services/errors.ts      面向用户的错误信息
  strings.ts              主要导航/标题，中文本地化起点
  styles.css              统一视觉样式与响应式布局
firestore.rules           生产安全规则
firestore.indexes.json    无复合索引需求
firebase.json             模拟器、Hosting、安全响应头
.env.example              环境配置模板
vitest*.config.ts         单元/规则测试配置
playwright.config.ts      浏览器测试配置
tests/                    财务单元测试、安全规则与 SDK 集成测试
e2e/                      多用户浏览器验收
docs/                     架构、安全、测试、验收文档
```

主要数据结构与安全边界见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。没有其他后端或付费服务。

## 已知限制与免费额度

- 每账本最多五个历史 UID，适合固定五人小组。无跨币种、文件附件、周期支出、支付网关、所有权转让或管理员成员移除。
- 所有成员对财务记录拥有相同编辑权限，不能伪造别人的 actor，但可以记录自己的错误或虚假财务事实；系统提供可追溯纠正，不证明线下付款发生。
- 正常客户端无法改写或删除审计、无法遗漏配套审计写入。**Firebase 项目管理员、Admin SDK、规则部署者可绕过规则**；无付费可信后端时，这不是对管理员也防篡改的系统。详见架构说明。
- 结算确认使用固定 ID、版本和账本 revision 防重复及过期建议。恶意成员或手工创建不同 ID 的相似还款无法自动判定是否为同一次线下付款；请根据历史纠正。
- 离线只展示已收到的数据和连接状态。财务事务需要服务器确认，失败不会当作成功；不支持离线队列。连接中断时服务可能等待网络恢复，保存按钮显示等待服务器，不会提前宣布同步完成。页面刷新会丢失未提交表单。
- 资料名称保存在加入时的账本成员快照中，不因修改 Auth 显示名而失去可读性；UID 是唯一身份。再次加入可刷新该 UID 的名称。离开/账号被 Firebase 管理员禁用不移除历史，禁用令牌撤销存在 Firebase 正常传播延迟。
- 当前选中账本仅有记录与历史监听，账本列表一个监听。历史默认最近 100 条，可加载更早；余额需要当前账本的全部财务记录。适合小组低频使用，数万条记录需分页/聚合架构升级。历史每次加载会替换查询、可能重新计费。
- Spark 的 Firestore 免费额度当前包括每天 50,000 文档读、20,000 写、20,000 删、1 GiB 存储；Hosting 有独立免费额度与配额行为。五个低频用户通常很轻量，但这不是使用量保证。每次确认结算会额外从服务器读取当前账本的全部财务记录；每次财务修改至少三次文档写入（记录、审计、账本），事务重试、安全规则关联读取和监听重连都可能增加用量。监控 Console 的 Usage；规则不提供按用户的可靠读频限制。
- 邮件验证/重置受 Firebase 的发送额度和反滥用限制；实际邮件送达未在本机验证。
- npm 间接开发工具依赖的审计状态见测试报告。不要为消除提示盲目执行 `npm audit fix --force` 降级 Firebase。

官方依据：[原子事务与 getAfter](https://firebase.google.com/docs/firestore/manage-data/transactions)、[规则限制](https://firebase.google.com/docs/rules/rules-behavior)、[Firestore 免费额度](https://firebase.google.com/docs/firestore/quotas)、[Firebase 定价](https://firebase.google.com/pricing)、[模拟器配置](https://firebase.google.com/docs/emulator-suite/install_and_configure)。
