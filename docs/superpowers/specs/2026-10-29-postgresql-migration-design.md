# 云端 API PostgreSQL 迁移设计

状态：用户已要求立即迁移云端数据库；后端语言保持 Node.js。Python 与 Node.js 的三端适配比较在本轮结论中说明，不包含 Python 重写。

## 目标与边界

- 将 `apps/api` 的权威数据从 `API_DATA_DIR/studio.sqlite` 迁至 PostgreSQL；桌面端未关联云端的 `project.json` 不变，媒体文件继续由 API 数据目录管理。
- 保持桌面、网页、移动端现有 HTTP 路径、Cookie、JSON/SSE/二进制响应、请求 ID、资源修订与任务身份不变。
- 旧 SQLite 数据可在停写窗口导入 PostgreSQL；验证表行数、关键关联和任务状态后才切换 API。导入失败不修改原 SQLite 文件。
- 费用和存储额度、项目命令、事件顺序、渲染租约在多连接事务下仍须正确，未知付费提交不再次 POST。
- 本轮不切换线上服务，除非用户明确确认包含线上；提供上线前演练和切换说明。

## 实现方式

使用 `pg` 连接池和参数化 SQL。数据库访问统一为异步 `get/all/run` 与 `transaction`；事务中的所有语句绑定同一连接。PostgreSQL 建立当前 schema 的最终表形态，独立记录迁移版本。现有 SQLite 的 `PRAGMA`、`INSERT OR IGNORE`、`BEGIN IMMEDIATE` 和标量 `MAX(a,b)` 不直接照搬。使用数据库行锁或事务级锁保护跨行总额度，按行领取任务并以状态条件提交。

迁移脚本只读打开 SQLite，要求目标 PostgreSQL 为空，在单个 PostgreSQL 事务中按外键顺序复制数据；保持所有原 ID、时间戳、哈希、JSON 文本和本地对象路径。导入后检查表行数、外键及代表性任务/项目，输出不含密钥的报告。切换期间停止旧 API 写入；保留 SQLite 备份，回滚时不得覆盖切换后新增的 PostgreSQL 用户数据。

## 验收

1. 空 PostgreSQL 库可启动 API，注册登录、项目、上传、灵感、生成任务、SSE 与渲染行为通过现有测试。
2. 两个数据库连接同时审批/上传/领取任务，不突破总额度、不重复执行供应商 POST、不丢事件。
3. 使用有旧项目和未完成任务的 SQLite fixture 导入后，ID、状态、资源修订和对象引用一致；重复导入拒绝，失败可回滚。
4. API 类型检查、边界检查、桌面/网页/移动端协议检查通过；真实供应商付费调用不作为自动测试。
