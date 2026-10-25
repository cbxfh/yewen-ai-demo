# 业问部署与回滚记录

## 当前免费 Demo

- 网址：https://yewen-demo.onrender.com
- 管理员后台：https://yewen-demo.onrender.com/admin
- Render 服务 ID：`srv-dbf0qqoae00c73ecsnc0`
- Render 服务计划：Free
- 部署区域：Oregon
- 健康检查：`/api/health`
- 源码公开镜像：https://github.com/cbxfh/yewen-ai-demo
- 私有版本仓库：https://github.com/cbxfh/yewen-ai

免费 Demo 没有持久化磁盘。Render 重新部署、服务重建或部分休眠恢复行为可能导致账号、知识库和对话数据重置。它只用于体验和验收，不用于保存正式数据。

## 环境变量

Render 中配置以下变量：

```text
TRUST_PROXY=1
AI_API_KEY=<服务端密钥>
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
AI_MAX_TOKENS=1200
USER_DAILY_REQUEST_LIMIT=30
PUBLIC_DAILY_REQUEST_LIMIT=100
```

密钥只保存在 Render 环境变量和本机 `.runtime` 中，不进入 Git。

## 代码回滚

当前部署版本使用 Git 标签 `v0.6.0-demo`。回滚代码：

```powershell
git checkout v0.6.0-demo
npm test
git push demo v0.6.0-demo^{commit}:main
```

推送后 Render 会自动部署。不要使用强制推送覆盖历史。

## 本地用户数据备份

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup-local-data.ps1
```

备份默认保存到项目外部的 `outputs/backups` 目录。备份包含账号信息和知识库正文，可能包含个人资料，必须妥善保管，不要上传或发送给他人。

备份不包含：

- 登录会话令牌。
- `.runtime/ai-config.json` 中的 API 密钥。
- Render 环境变量。

恢复数据前先停止服务，保留现有 `.data` 备份，再将压缩包中的 `users.json`、`admin.json` 和 `users/` 恢复到项目 `.data/` 目录，然后重新启动服务。

## 正式长期部署

正式版本需要持久化磁盘和 Render 付款信息。现有 `render.yaml` 预留了 `/app/.data` 的 1GB 磁盘配置，但尚未启用。正式迁移前应再次备份 `.data`，并在 Render 环境变量中设置管理员初始化信息。
