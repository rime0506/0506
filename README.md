# 联机交友后端服务器

这是一个用于支持 WeChat 联机交友功能的 WebSocket 服务器。

## 功能特性

- 🔐 用户注册/登录（JWT认证）
- 👤 角色上线/下线管理
- 🔍 通过虚拟微信号搜索用户
- 🤝 发送/接受/拒绝好友申请
- 💬 实时消息转发
- 📨 离线消息存储和投递
- 💾 SQLite 本地数据库

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
# 1. 复制环境变量文件
cp env-example.txt .env

# 2. 编辑 .env，修改 JWT_SECRET 为随机字符串

# 3. 启动服务
docker-compose up -d

# 4. 查看日志
docker-compose logs -f
```

### 方式二：Docker 单独运行

```bash
# 构建镜像
docker build -t wechat-online-server .

# 运行容器
docker run -d \
  --name wechat-online \
  -p 3000:3000 \
  -e JWT_SECRET=your-secret-key \
  -v ./data:/app/data \
  wechat-online-server
```

### 方式三：直接运行 Node.js

```bash
# 安装依赖
npm install

# 设置环境变量（可选）
export JWT_SECRET=your-secret-key
export PORT=3000

# 启动服务
npm start

# 或者使用开发模式（自动重启）
npm run dev
```

## 配置说明

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| PORT | 服务器端口 | 3000 |
| JWT_SECRET | JWT签名密钥 | your-secret-key-change-in-production |
| DB_PATH | SQLite数据库路径 | ./data/database.sqlite |

## WebSocket API

### 连接地址

- 本地: `ws://localhost:3000`
- 生产: `wss://your-domain.com` (需配置反向代理)

### 消息格式

所有消息均为 JSON 格式。

#### 注册

```json
// 请求
{ "type": "register", "username": "用户名", "email": "邮箱(可选)", "password": "密码" }

// 成功响应
{ "type": "register_success", "token": "JWT_TOKEN", "user": { "id": "xxx", "username": "xxx" } }
```

#### 登录

```json
// 请求
{ "type": "login", "username": "用户名", "password": "密码" }

// 成功响应
{ "type": "login_success", "token": "JWT_TOKEN", "user": { "id": "xxx", "username": "xxx" } }
```

#### Token认证（重连时使用）

```json
// 请求
{ "type": "auth", "token": "JWT_TOKEN" }

// 成功响应
{ "type": "auth_success", "user": { "id": "xxx", "username": "xxx" } }
```

#### 角色上线

```json
// 请求
{
  "type": "go_online",
  "wx_account": "wxid_xxx",
  "nickname": "昵称",
  "avatar": "头像URL",
  "bio": "个性签名"
}

// 成功响应
{ "type": "character_online", "wx_account": "wxid_xxx", "nickname": "昵称" }
```

#### 角色下线

```json
// 请求
{ "type": "go_offline", "wx_account": "wxid_xxx" }

// 响应
{ "type": "character_offline", "wx_account": "wxid_xxx" }
```

#### 获取已上线角色

```json
// 请求
{ "type": "get_online_characters" }

// 响应
{
  "type": "online_characters",
  "characters": [
    { "wx_account": "wxid_xxx", "nickname": "昵称", "avatar": "...", "bio": "..." }
  ]
}
```

#### 搜索用户

```json
// 请求
{ "type": "search_user", "wx_account": "wxid_xxx" }

// 响应（找到）
{
  "type": "search_result",
  "result": {
    "wx_account": "wxid_xxx",
    "nickname": "昵称",
    "avatar": "...",
    "bio": "...",
    "is_online": true
  }
}

// 响应（未找到）
{ "type": "search_result", "result": null }
```

#### 发送好友申请

```json
// 请求
{
  "type": "friend_request",
  "from_wx_account": "我的wxid",
  "to_wx_account": "对方wxid",
  "message": "申请备注"
}
```

#### 接受好友申请

```json
// 请求
{
  "type": "accept_friend_request",
  "request_id": "申请ID",
  "my_wx_account": "我的wxid"
}

// 双方都会收到
{
  "type": "friend_request_accepted",
  "friend_wx_account": "对方wxid",
  "friend_nickname": "对方昵称",
  "friend_avatar": "...",
  "friend_bio": "..."
}
```

#### 发送消息

```json
// 请求
{
  "type": "message",
  "from_wx_account": "发送方wxid",
  "to_wx_account": "接收方wxid",
  "content": "消息内容"
}

// 接收方收到
{
  "type": "message",
  "from_wx_account": "发送方wxid",
  "from_nickname": "发送方昵称",
  "from_avatar": "...",
  "content": "消息内容",
  "timestamp": 1234567890
}
```

## 部署到公网

### 使用 Nginx 反向代理 + SSL

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### 使用 Cloudflare Tunnel（免费）

1. 安装 cloudflared
2. 运行 `cloudflared tunnel --url http://localhost:3000`
3. 获得一个临时的公网URL

### 使用 frp 内网穿透

参考 frp 官方文档配置。

## 📦 数据持久化说明

### ✅ 你的数据是安全的！

所有数据都保存在 SQLite 数据库文件中：`./data/database.sqlite`

**包含的数据：**
- ✅ 用户账号（用户名、密码）
- ✅ 角色信息（微信号、昵称、头像、个性签名）
- ✅ 好友关系
- ✅ 群聊信息（群组、成员、消息记录）
- ✅ 离线消息

**Docker 部署时的数据持久化：**
- Docker Compose 通过 volume 映射：`./data:/app/data`
- 数据保存在宿主机的 `./server/data/` 目录
- **重启容器、更新代码、重新构建镜像都不会丢失数据**

### ⚠️ 注意事项

**安全的操作（不会丢数据）：**
- ✅ `docker-compose restart` - 重启容器
- ✅ `docker-compose up -d --build` - 重新构建并启动
- ✅ `docker-compose down` 然后 `docker-compose up -d` - 停止并重启
- ✅ 服务器重启
- ✅ 更新 server.js 代码

**危险的操作（会丢数据）：**
- ❌ 删除 `./data/` 目录或 `database.sqlite` 文件
- ❌ `docker-compose down -v` （`-v` 会删除 volumes）
- ❌ `docker volume rm` 删除卷

### 🔄 数据备份

**自动备份脚本（推荐）：**

```bash
# 给备份脚本添加执行权限
chmod +x backup.sh

# 手动执行备份
./backup.sh

# 设置定时任务（每天凌晨2点自动备份）
crontab -e
# 添加以下行：
0 2 * * * cd /path/to/your/server && ./backup.sh
```

**手动备份：**

```bash
# 创建备份目录
mkdir -p backups

# 备份数据库
cp ./data/database.sqlite ./backups/database_$(date +%Y%m%d_%H%M%S).sqlite

# 查看备份
ls -lh backups/
```

**恢复数据：**

```bash
# 停止服务
docker-compose down

# 恢复数据库文件
cp ./backups/database_20260204_120000.sqlite ./data/database.sqlite

# 重启服务
docker-compose up -d
```

### 🔍 数据验证

**检查数据库是否存在：**

```bash
ls -lh ./data/database.sqlite
```

**查看数据库内容：**

```bash
# 安装 sqlite3（如果没有）
sudo apt install sqlite3

# 查看数据库
sqlite3 ./data/database.sqlite

# 在 SQLite shell 中执行：
.tables                           # 查看所有表
SELECT COUNT(*) FROM users;       # 查看用户数量
SELECT COUNT(*) FROM online_groups; # 查看群聊数量
SELECT username FROM users;       # 查看所有用户名
.quit                             # 退出
```

## 安全提示

1. **务必修改 JWT_SECRET** - 使用强随机字符串
2. **使用 HTTPS/WSS** - 生产环境必须使用加密连接
3. **限制访问** - 可以通过防火墙限制可访问的IP
4. **定期备份** - 定期备份数据库文件

## 许可证

MIT

