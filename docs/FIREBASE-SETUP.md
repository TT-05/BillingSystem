> 最新付款确认版本：须先部署新 Rules，再发布 Hosting，最后让成员刷新旧页面。无需生产数据迁移或新付费服务。移动 Google 回退使用现有已授权的 bill9206.firebaseapp.com 别名，详细边界与命令见 [TWO-PARTY-PAYMENTS.md](TWO-PARTY-PAYMENTS.md)。本轮未部署。

> 最新状态：项目已有线上版本。本轮邀请与双语修复尚未发布；注册 Web App/授权域/有效 API key 已再次只读验证。先部署新邀请规则再发布前端，具体见 [INVITATIONS-I18N.md](INVITATIONS-I18N.md)。以下初始搭建及旧验收记录保留作参考。

# bill9206 配置与部署前交接

本次任务只修改本地代码、配置和文档。没有部署、没有访问线上 Firestore 数据、没有创建真实 Firebase 用户。项目位置是 `/Users/test/billSystem`，旧路径 `/Users/test/cmput328/billSystem` 当前不存在。

## 本地配置（已完成）

在 Firebase Console 打开 **bill9206 → Project settings → General → Your apps → 已注册的 Web App → SDK setup and configuration → Config**。

本轮已根据提供的 Web App 设置创建根目录 `.env.local`，使用下方变量名。只有新检出环境才需要从 `.env.example` 复制；已有配置不要覆盖。

```dotenv
VITE_FIREBASE_API_KEY=从Config的apiKey复制
VITE_FIREBASE_AUTH_DOMAIN=bill9206.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=bill9206
VITE_FIREBASE_APP_ID=从Config的appId复制完整字符串
VITE_USE_EMULATORS=false
```

**apiKey** 已从现有授权的注册 Web App 配置读取并更正，且经 Firebase Auth 只读配置接口实际返回 HTTP 200。原提供字符串与登记值相差一个字符，Vite 加载本身没有错误。**appId**、authDomain、projectId 均与注册配置匹配；storageBucket / messagingSenderId 也已核对，但当前应用不使用它们。所需四项 Vite 配置完整，`VITE_USE_EMULATORS=false`。Project ID 不能推导出它们，不能用 Google OAuth client ID 代替 appId。authDomain 已与提供的配置核对为 `bill9206.firebaseapp.com`。如果不同，CSP 中允许的 auth iframe/connect 来源也必须同步审查。

无需 measurementId、messagingSenderId、storageBucket；项目没有使用 Analytics、Messaging 或 Storage。无需、也不要添加 OAuth client secret 或 service account。Web App 配置不是管理员秘密，但 `.env.local` 已忽略，不应提交凭据。所有 `VITE_*` 值都会编入浏览器产物。

## Firebase Console 检查

所有者已告知：Spark 已启用；Firestore Standard `(default)` 生产模式；Email/Password 和 Google 已启用；Web App 已注册。本次没有登录 Console 验证这些远程状态。

发布前由所有者检查：

1. Authentication → Google provider：启用且项目支持邮箱已保存。
2. 保持同一邮箱关联账户的设置（one account per email / link accounts that use the same email），不要为每个 provider 分别创建重复身份。实际可信邮箱自动关联由 Firebase 管理。
3. Authorized domains 核对 `bill9206.firebaseapp.com`、`bill9206.web.app`；若本地使用真实 OAuth，还需 `localhost` 和 `127.0.0.1`。只填域名，不加协议和端口。
4. 默认 OAuth handler 为 `https://bill9206.firebaseapp.com/__/auth/handler`，由 Firebase 托管。本应用使用 Firebase SDK popup；无需在 React 自建回调接口。
5. 数据库保持生产模式。先检查本地严格规则，不要使用临时 permissive 规则。部署后才能通过这些规则访问私有账本。
6. 检查 Email/Password 验证/重置邮件模板与授权域。Google verified email 可直接满足邀请验证要求，但仍必须匹配受邀邮箱。

## 账号和资料行为

- Continue with Google 和邮箱密码并存。每次显示 Google 账户选择器，不索取额外 Google API 权限，不抓取通讯录，不加载外部头像。
- 新 Google 用户仅在自己的 `users/{uid}` 创建名称和服务器时间。Google 名称最多 80 字符；无名称时使用邮箱前缀或 Member。
- 再次登录保留已有自定义名称。账本内成员名快照、借款、支出、还款和审计全部保持。
- `account-exists-with-different-credential`：先用原方式登录，再打开 Account & profile → Link Google account。此操作需要现有已认证会话和新的 Google 弹窗证明。
- `credential-already-in-use`：Google 凭据已归另一 UID，拒绝关联。不自动合并、不删除账户、不转移账本。需要保留哪份历史，应先登录对应原 UID。
- 不使用 `fetchSignInMethodsForEmail` 枚举账户，也不将 Google pending credential 持久化到 sessionStorage、localStorage 或 Firestore。登录持久化由 Firebase Auth SDK 管理。
- 资料初始化失败会显示重试/退出，不先挂载一个误导性的空账本。被取消/被拦截的弹窗可恢复，不触发自动 redirect。

## 本地配置审查

| 文件                     | 状态                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `.firebaserc`            | default = bill9206，仅本地项目选择，不会触发部署                                                |
| `firebase.json`          | `dist` 静态 Hosting、SPA 回退、缓存与安全响应头；没有 Functions、App Hosting、Storage、扩展配置 |
| `firestore.rules`        | 已收紧自行退出等成员更新校验；原财务审计规则保持；最新 45 项模拟器测试通过                      |
| `firestore.indexes.json` | 原查询使用单字段/等值索引合并，无新增复合索引；Google 资料读取仅按本人 UID                      |
| `.env.example`           | 已填 Project ID / 默认 authDomain，apiKey / appId 在模板留空；本地 `.env.local` 已按提供值填入  |
| 自动化测试               | 显式 `--project demo-settle`，不使用 `.firebaserc` 的生产默认项目                               |
| Playwright               | 显式启用模拟器，并拒绝复用未知的既有开发服务器                                                  |

CSP 允许 `https://apis.google.com` 的 Firebase Auth 脚本，以及 `https://bill9206.firebaseapp.com` / `https://bill9206.web.app` 认证 iframe/connect。没有扩大为任意 iframe 或任意脚本来源；`frame-ancestors 'none'` 和 `X-Frame-Options: DENY` 保留。生产的真实 Google consent/托管认证 handler/CSP 仍需发布后验收，模拟器不等同于真实 OAuth 验证。

## 在决定部署之前

需要 Node.js 22.12+、Java 21+。在实际目录执行：

```sh
cd /Users/test/billSystem
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
```

所有测试都使用本地 demo-settle。不要并发运行会清空同一模拟数据库的规则和 E2E 测试。端口 8080、9099、5173 必须空闲。Google popup 测试操作的是 Firebase Auth 模拟器内置的本地身份页面，不访问真实 Google 账户。

补齐 `.env.local` 后执行 `npm run build`。缺少配置也可以构建出配置引导页面，因此不能仅凭构建成功判定生产已接通。修改配置后必须重启开发服务或重建。

仅在所有者明确决定发布时执行下面命令；**本次没有执行**：

```sh
npx firebase login
npx firebase deploy --project bill9206 --only firestore:rules,firestore:indexes
npx firebase deploy --project bill9206 --only hosting
```

无需再运行 `firebase init`，避免覆盖现有配置和规则。默认预期 URL 为 `https://bill9206.web.app`，本次只读检查了现有静态资源，但未部署新版本。部署后使用两个真实用户验收 Google/密码登录、关联、邀请、跨窗口同步和规则隔离。首次真实登录会写本人资料；本次没有运行真实项目登录。

## Spark 兼容性和限制

架构仅使用 Email/Password、Google Firebase Auth、Firestore Standard 和经典静态 Firebase Hosting。没有 Phone/SMS、Cloud Functions、Cloud Run、App Hosting、Storage、付费扩展或外部支付服务，不要求升级 Blaze。五个低频用户适合使用免费额度，但使用量和认证邮件仍受配额限制；监控 Console Usage。

本次保持已有五个历史 UID 的账本上限、整数金额算法、原子审计、版本冲突保护和结算重检。原有管理员可绕过规则、所有权不能转让等限制不变。

官方依据：[Google 登录](https://firebase.google.com/docs/auth/web/google-signin)、[账户关联](https://firebase.google.com/docs/auth/web/account-linking)、[认证模拟器](https://firebase.google.com/docs/emulator-suite/connect_auth)、[Spark 定价和配额](https://firebase.google.com/pricing)。

## 本次文件变更

新增：

- `.firebaserc`
- `src/services/googleAuth.ts`
- `tests/auth.test.ts`
- `tests/config.test.ts`
- `tests/auth.integration.test.ts`
- `e2e/google.spec.ts`
- `docs/FIREBASE-SETUP.md`

修改：

- `.env.example`
- `firebase.json`
- `package.json`（增加 typecheck 命令，无新依赖）
- `vitest.config.ts`
- `vitest.rules.config.ts`
- `playwright.config.ts`
- `src/App.tsx`
- `src/components/Auth.tsx`
- `src/components/Profile.tsx`
- `src/services/errors.ts`
- `src/styles.css`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/MANUAL-TESTING.md`
- `docs/TEST-RESULTS.md`

未修改安全规则、索引、金额计算、财务数据服务、原有财务/规则测试、原有三个浏览器场景和 package-lock.json。没有新增任何秘密文件或提交凭据。dist 为本地构建产物，已在 gitignore 中忽略。

## Web App 配置验证补充（2026-11-12）

- 已创建 `.env.local`，只使用应用实际读取的 API key、authDomain、projectId、appId 和模拟器开关。Storage/Messaging 字段未加入，因为应用不使用对应服务。
- TypeScript 检查和生产构建均通过。已用 Vite 的 production 环境解析和构建入口静态检查确认 bill9206、提供的 appId/authDomain/API key 已编入产物，且应用入口没有 demo-settle 配置。
- 已通过 Git 的实际忽略匹配验证 `.env.local` 被忽略、`.env.example` 可跟踪。项目当前没有 .git 元数据，本次也未初始化该目录的 Git 或提交文件。
- 37 个原应用源码、测试、安全规则及配置文件的 SHA-256 保持不变；仅新增本地环境、刷新构建产物及更新配置状态文档。
- 没有部署、启动真实项目登录或修改线上 Firestore。剩余前提是核对 Console 的 Google 支持邮箱、授权域、账号关联设置，以及在所有者决定发布后部署并验证真实 OAuth/托管 handler/CSP。

## 两个发布阻塞项的最终状态

- API key：已修复并实际验证。来源是已授权的 Firebase Web App config，不是猜测值；旧 key 返回 400，新登记值返回 200；构建产物含正确值、无旧错误值和 demo-settle 配置。
- 成员规则：已修复。新增 tests/membership.regression.test.ts，并接入原 test:rules 命令；共享成员结构约束覆盖创建、加入和退出，历史五人上限保留。
- 本次 51 项单元、45 项安全/集成、6 项 Playwright 全部通过；lint、strict TypeScript、生产构建通过。先用旧规则在模拟器重现两个恶意列表被接受，再运行新规则完整测试验证拒绝。
- 已满足本地与配置层面的部署前提；默认账本仍限五个历史 UID。真实 OAuth consent、Hosting handler/CSP 和生产协作需部署后做人工 smoke test。
- 没有部署，没有更改生产 Firestore 数据或生产规则。不要把本地规则修复误当作线上规则已生效。

本次新增/变更：忽略的 .env.local、firestore.rules、tests/membership.regression.test.ts、vitest.rules.config.ts 和相关配置/架构/验收文档。没有新增依赖或改变财务计算、财务数据写入服务及原有测试。
