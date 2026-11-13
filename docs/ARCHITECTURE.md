# 数据模型、安全与并发

## Firestore 模型

| 路径                                      | 内容                                                                                                             | 读取 / 修改权限                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `users/{uid}`                             | `name, updatedAt`                                                                                                | 仅本人读写，没有角色字段                                                              |
| `ledgers/{id}`                            | 名称、币种、ownerId、活跃 `memberIds`、历史 `members[uid].name`、revision、hasRecords、最近 joinToken、createdAt | 活跃成员读；所有者改名称/币种和邀请；本人可退出                                       |
| `invitations/{256bitHex}`                 | ledgerId、账本名称/币种快照、收件邮箱、创建人、过期时间、usedBy、usedAt、revoked                                 | 所有者和匹配邮箱可按 token 读取；只有所有者能查询/创建/撤销，匹配已验证邮箱可原子兑换 |
| `ledgers/{id}/records/{recordId}`         | envelope + FinancialData                                                                                         | 活跃成员读取与带审计的创建/版本更新；禁止硬删除                                       |
| `ledgers/{id}/audit/{recordId}_{version}` | 完整 before/after、操作人、服务器时间、动作、版本、关联记录                                                      | 活跃成员读；规则只允许配套真实记录修改的首次创建；禁止更新/删除                       |

成员关系合并到账本文档，不维护可能分歧的第二套 membership。支出、借款、还款统一为带 `kind` 的记录，避免重复实现审计和订阅。账本最多五个历史 UID；成员退出只从活跃列表移除，名字快照和 UID 保留。没有账本删除，避免孤儿财务数据。

FinancialData 包含：kind、description、整数 amount、currency、date、payerId、receiverId、participants、shares、weights、splitMethod、notes、deleted、settlementKey。日期是用户提供的记账日期；权威创建和修改时刻是服务器 Timestamp。envelope 包含不可变 createdBy/createdAt、version、updatedBy/updatedAt、action、ledgerId。借款、还款不用 participants/shares；payer 与 receiver 必须不同并存在于同一账本的历史成员图中。旧成员仍可被引用来完成债务清算。

`members` 不是公开用户目录；只读自己的 user 文档，无法枚举邮箱。邀请无需提前查询用户列表；收件人必须注册并验证邮箱才能兑换。displayName 从不作为唯一键。

## 原子财务操作

1. 表单打开时生成稳定 recordId；重试保留此 ID。
2. `runTransaction` 读取账本和当前记录。
3. 当前记录 version 必须等于编辑时 expectedVersion；冲突返回可理解错误，不静默覆盖。
4. 记录写入 version + 1；创建信息不变；updatedBy 必须等于当前 Auth UID，updatedAt 必须等于 request.time。
5. 同一事务创建 `{recordId}_{version}` 审计，保存实际旧数据和新数据；at 使用 serverTimestamp。
6. 同一事务递增账本 revision、永久锁定 hasRecords。规则验证匹配的新审计内容；审计规则反向核对 get / getAfter 真实记录，阻止脱离记录的“历史事件”。
7. 完全相同的上一次已成功提交重试被识别，避免重复创建。

规则验证币种、整数范围、成员引用、唯一参与人、各分摊方法的计算、份额合计、删除状态转换、版本及审计。五人最大百分比分摊作为边界集成测试执行，确保在 Firestore Rules 的 1,000 表达式上限内工作。每个操作的关联文档读取数量也控制在 Firebase 的每写入 10 / 原子操作合计 20 次限制内。并发事务共享账本 revision，在此小组频率下可接受。

恢复历史版本是新的 version、新的审计事件，不会覆盖旧审计。还款纠正也走同一有审计的编辑/软删除。action 标签为 `restore` 不提供额外权限；它只能提交同样满足规则的新数据，UI 从历史快照构造恢复内容。规则保证所有状态变化可追溯，不证明恢复内容的商业含义。

## 结算和重复提交

余额只从 records 当前有效版本派生。结算建议本身从不写付款记录。确认已付款会创建 `kind=repayment`、`action=settle` 的记录，ID 绑定当时的账本 revision 与付款/收款 UID。事务检查账本 revision，并从服务器重新读取当前记录、重新计算并匹配建议，防止两个监听快照先后到达产生旧建议/新 revision 的组合。全量查询不属于 Firestore 事务读集，但被事务读取并更新的账本 revision 保护：规则强制每次财务写入都递增同一个 revision，因此查询期间任何普通客户端财务变更都会让提交冲突或重试后报版本过期。若其他人修改了财务记录或设置则要求重新检查计划。每次确认会额外读取当前账本的全部财务记录，仅适合此处的小组低频规模。

客户端生成固定 ID、保存中禁用按钮、相同版本事务检查，防止正常用户双击/重试重复登记。安全规则强制非空 settlementKey 与 recordId 相等且之后不可改变，同一个 key 无法另建记录。规则无法证明哈希/推荐金额对应整个账本历史，也不能证明两个不同 ID 是否代表同一笔线下转账。授权成员仍可登记错误付款，必须通过历史更正；不会声称其等价于支付平台的 exactly-once 付款。

## 邀请

所有者用 `crypto.getRandomValues` 生成 32 字节 token（64 个 hex 字符）。规则限制结构、有效期最多七天、初始未使用状态和创建人。邀请只绑定收件邮箱，不公布成员信息。兑换需要：Firebase token 的 email 匹配，email_verified=true，未撤销/未使用/未到期，当前不在活跃成员中。单个 batch 同时标记邀请 usedBy/usedAt 和加入账本；两边规则交叉验证 getAfter，防止只兑换不加入、只加入不兑换、改写他人成员信息或修改 ownerId。

被邀请者不能提前读账本，所以邀请携带只用于预览的名称和币种快照，加入采用 arrayUnion 和局部成员字段写入而不先读私有账本。邀请 token 的随机性由应用实现；规则可检查长度/格式，无法证明恶意所有者所选 token 的熵。邮箱验证约束仍强制生效。

## 权限和确切的审计限制

- 所有财务修改都由成员授权；本人 actor UID 和请求服务器时间由规则绑定，不能冒名或回填历史时间。
- 历史不能被普通成员或所有者从客户端任意修改/删除，记录不能绕开审计。
- 所有者不具有无审计财务修改特权；仅管理邀请与账本设置。
- 授权成员可以输入不符合线下事实的数据。这是共享账本权限，不是数据真实性证明。谁录入什么内容都有历史。
- Admin SDK、Firebase Console 管理员、修改生产规则的人拥有项目级权力，可绕过规则；本架构不能对其提供密码学防篡改或外部公证。保留项目管理权限最小化，避免把 service account 放进客户端。
- 非财务事件（个人资料、账本名称、邀请撤销和离开）未承诺完整审计；所有财务变化都有。
- 用户删库/禁用账号等管理员行为不由客户端规则保护；应用无删除账号流程。

## 查询与同步

账本列表只查 `memberIds array-contains uid`。当前账本 records 一个监听、audit 一个按 at 倒序且 limit 100 的监听（可扩到更早）。所有者在设置页额外监听属于当前账本且 createdBy=本人 的邀请。切换账本/退出时清理监听，并用查询 key 隔离旧缓存，避免在新账本短暂显示旧数据。

查询只用单字段索引及等值索引合并，因此 `firestore.indexes.json` 的复合索引列表为空。未创建未使用索引。Firestore 新项目须保持默认单字段索引。

Firestore 使用内存缓存，不启用跨会话磁盘缓存。连接提示使用浏览器网络状态和 snapshot.fromCache；服务端事务确认前不提示成功。离线事务失败会显示错误，可能等待连接恢复；没有静默的离线写入成功提示。

## 部署与配置边界

Vite 构建只生成静态文件。Hosting SPA 重写处理邀请链接；Firebase Auth/Firestore SDK 直接访问内置服务。生产构建要求有效环境变量；模拟器显式启用时才用 demo 项目。Web 配置公开，生产安全依靠规则。没有服务端代码、Functions、Storage、秘密环境变量或付费 API。Hosting CSP 允许 Firebase 必须的 Google API 连接，不从外部加载字体或第三方脚本。

## Google 认证扩展（2026-11-12）

Google signInWithPopup 与邮箱密码并存；通过 linkWithPopup 在已认证用户上增加登录方式，继续使用相同 UID。遇到 account-exists-with-different-credential 时引导原方式登录后明确关联，不使用 fetchSignInMethodsForEmail 枚举账户、不按邮箱合并数据，不保存待关联 OAuth 令牌。独立 UID 的凭据冲突不会触发删除或迁移。

App 的 auth-state 回调在 Google 用户资料初始化完成前不挂载账本页面。只读写本人 users 文档；新资料使用 serverTimestamp，已有名字保留且可恢复到 Auth displayName，失败显示重试/退出。Google 资料不会更改账本 members 快照、财务文档或审计。

Google 的真实 OAuth、托管 handler、授权域和 consent 不由模拟器证明。CSP 允许 SDK 使用的 apis.google.com 脚本及 bill9206 的 Firebase auth iframe；frame-ancestors none 和 X-Frame-Options DENY 保留。身份模拟器的本地弹窗与 Google credential 测试全使用 demo-settle；.firebaserc 默认 bill9206 不会改变测试目标。没有引入服务器、支付服务、Phone Auth 或付费扩展。

## 发布阻塞项修复（2026-11-12）

创建、邀请兑换、自行退出统一调用 `membershipValid` 校验：活跃 UID 列表必须是 1–5 个唯一值；历史成员映射不得超过五个 UID；所有活跃 UID 必须有历史资料；所有者必须仍在活跃列表中。自行退出仍只允许当前非所有者移除本人，不能改其他字段、移除历史资料、替换成员或更换所有者。其他只修改名称/币种或财务 revision 的分支无法更改成员字段，因此保留原有授权约束。没有在每次财务修改上重复执行整份 ledgerValid，避免突破 Firestore Rules 求值上限。

修复前，集合比较会忽略列表重复值；现在重复/超长列表直接拒绝。已在本地模拟器用原规则重现两种错误接受，再用新规则验证拒绝。五人满额时正常退出、历史引用和财务/审计文档保持不变，且离开者不再能读取私有记录。

API key 修正只更改忽略的 .env.local。原文件值与 Vite 的有效值一致，排除了加载错误；原先提供的字符串与登记值相差一个字符。通过现有授权读取注册 Web App 配置后原样写入，未猜测新 key。key 在真实 Auth 配置只读接口返回 HTTP 200；该核对不创建登录会话或生产 Firestore 文档。

## 邀请与双语更新

新邀请只保存服务器 createdAt，有效期由规则与界面统一计算为服务器时间加七天，不再让浏览器时钟影响创建授权。旧 expiresAt 按原值保留，禁止修改或延长。创建事务读取最新账本所有者、名称与货币；邮箱规范化并匹配 token.email.lower()。其余成员、财务、版本和审计约束保持不变。线上旧规则与失败重现证据、回归说明见 [INVITATIONS-I18N.md](INVITATIONS-I18N.md)。

界面采用 i18next/react-i18next，翻译资源随静态站点打包，默认 zh-CN，localStorage 保存选择。显示层使用 Intl，不修改整数金额或财务文档；审计枚举/字段与系统结算文案在显示时翻译，用户输入保留。Firebase Auth languageCode 同步当前语言。部署前需先发布新规则，再发布新 Hosting；本轮不执行部署。

## 双方付款确认与移动浏览器（最新）

仪表盘待收/待付款来自当前净额结算建议，不按原始支出计数。新增 payments、paymentSlots 与 paymentAudit 子集合，不迁移既有财务数据。付款人只能为本人发起待确认申请，收款人确认后同一事务原子写入还款、财务审计、状态审计和账本 revision；拒绝/取消不影响余额。新旧已生效还款在新规则下只读，费用和借款仍可通过新的审计版本纠正。状态机、并发锁、过期策略及 Rules 不独立聚合全账本的信任边界见 [TWO-PARTY-PAYMENTS.md](TWO-PARTY-PAYMENTS.md)。

Google 移动登录使用 redirect，桌面保留 popup 并在被拦截时回退。为避免跨源存储限制，生产回退先进入既有授权的 Firebase Hosting firebaseapp.com 别名，并在暴露任何缓存账户 UI 前消费登录意图。模拟器通过仅开发环境启用的 Vite 同源 Auth 代理复现并验证 WebKit 行为。未改变生产 CSP、授权域或项目配置，没有新增付费服务。
