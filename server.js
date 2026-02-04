/**
 * 联机交友后端服务器
 * 支持用户注册/登录、角色上线、好友搜索、消息转发
 */

const WebSocket = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// 配置
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'database.sqlite');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
const db = new Database(DB_PATH);

// 创建表
db.exec(`
    -- 用户表（主账号）
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        last_login INTEGER
    );

    -- 在线角色表
    CREATE TABLE IF NOT EXISTS online_characters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        wx_account TEXT UNIQUE NOT NULL,
        nickname TEXT NOT NULL,
        avatar TEXT,
        bio TEXT,
        is_online INTEGER DEFAULT 0,
        last_seen INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 好友关系表
    CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        char_a_wx TEXT NOT NULL,
        char_b_wx TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(char_a_wx, char_b_wx)
    );

    -- 好友申请表
    CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_wx_account TEXT NOT NULL,
        to_wx_account TEXT NOT NULL,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER
    );

    -- 离线消息表
    CREATE TABLE IF NOT EXISTS offline_messages (
        id TEXT PRIMARY KEY,
        from_wx_account TEXT NOT NULL,
        to_wx_account TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        delivered INTEGER DEFAULT 0
    );

    -- 联机群聊表
    CREATE TABLE IF NOT EXISTS online_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        avatar TEXT,
        creator_wx TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    );

    -- 联机群聊成员表
    CREATE TABLE IF NOT EXISTS online_group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_wx TEXT NOT NULL,
        character_name TEXT,
        character_avatar TEXT,
        character_desc TEXT,
        joined_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (group_id) REFERENCES online_groups(id),
        UNIQUE(group_id, user_wx)
    );

    -- 联机群聊消息表
    CREATE TABLE IF NOT EXISTS online_group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_wx TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        character_name TEXT,
        content TEXT NOT NULL,
        msg_type TEXT DEFAULT 'text',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        FOREIGN KEY (group_id) REFERENCES online_groups(id)
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_online_chars_wx ON online_characters(wx_account);
    CREATE INDEX IF NOT EXISTS idx_online_chars_user ON online_characters(user_id);
    CREATE INDEX IF NOT EXISTS idx_friendships_char_a ON friendships(char_a_wx);
    CREATE INDEX IF NOT EXISTS idx_friendships_char_b ON friendships(char_b_wx);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_wx_account);
    CREATE INDEX IF NOT EXISTS idx_offline_messages_to ON offline_messages(to_wx_account);
    CREATE INDEX IF NOT EXISTS idx_online_group_members_group ON online_group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_online_group_messages_group ON online_group_messages(group_id);
`);

// 准备语句
const stmts = {
    // 用户
    createUser: db.prepare('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    updateLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    
    // 角色
    createOrUpdateChar: db.prepare(`
        INSERT INTO online_characters (id, user_id, wx_account, nickname, avatar, bio, is_online, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(wx_account) DO UPDATE SET
            nickname = excluded.nickname,
            avatar = excluded.avatar,
            bio = excluded.bio,
            is_online = 1,
            last_seen = excluded.last_seen
    `),
    getCharByWxAccount: db.prepare('SELECT * FROM online_characters WHERE wx_account = ?'),
    getCharsByUserId: db.prepare('SELECT * FROM online_characters WHERE user_id = ?'),
    setCharOffline: db.prepare('UPDATE online_characters SET is_online = 0, last_seen = ? WHERE wx_account = ?'),
    setAllCharsOfflineByUserId: db.prepare('UPDATE online_characters SET is_online = 0, last_seen = ? WHERE user_id = ?'),
    
    // 好友申请
    createFriendRequest: db.prepare('INSERT INTO friend_requests (id, from_wx_account, to_wx_account, message) VALUES (?, ?, ?, ?)'),
    getPendingRequestsForWx: db.prepare('SELECT * FROM friend_requests WHERE to_wx_account = ? AND status = ?'),
    updateFriendRequestStatus: db.prepare('UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?'),
    getFriendRequestById: db.prepare('SELECT * FROM friend_requests WHERE id = ?'),
    
    // 好友关系
    createFriendship: db.prepare('INSERT OR IGNORE INTO friendships (id, char_a_wx, char_b_wx) VALUES (?, ?, ?)'),
    getFriends: db.prepare(`
        SELECT oc.* FROM online_characters oc
        INNER JOIN friendships f ON (f.char_a_wx = oc.wx_account OR f.char_b_wx = oc.wx_account)
        WHERE (f.char_a_wx = ? OR f.char_b_wx = ?) AND oc.wx_account != ?
    `),
    areFriends: db.prepare(`
        SELECT 1 FROM friendships 
        WHERE (char_a_wx = ? AND char_b_wx = ?) OR (char_a_wx = ? AND char_b_wx = ?)
    `),
    
    // 离线消息
    saveOfflineMessage: db.prepare('INSERT INTO offline_messages (id, from_wx_account, to_wx_account, content) VALUES (?, ?, ?, ?)'),
    getOfflineMessages: db.prepare('SELECT * FROM offline_messages WHERE to_wx_account = ? AND delivered = 0 ORDER BY created_at'),
    markMessagesDelivered: db.prepare('UPDATE offline_messages SET delivered = 1 WHERE to_wx_account = ?'),
    
    // 联机群聊
    createGroup: db.prepare('INSERT INTO online_groups (id, name, avatar, creator_wx) VALUES (?, ?, ?, ?)'),
    getGroupById: db.prepare('SELECT * FROM online_groups WHERE id = ?'),
    getGroupsByMember: db.prepare(`
        SELECT g.* FROM online_groups g
        INNER JOIN online_group_members m ON g.id = m.group_id
        WHERE m.user_wx = ?
    `),
    
    // 群成员
    addGroupMember: db.prepare('INSERT OR REPLACE INTO online_group_members (id, group_id, user_wx, character_name, character_avatar, character_desc) VALUES (?, ?, ?, ?, ?, ?)'),
    getGroupMembers: db.prepare('SELECT * FROM online_group_members WHERE group_id = ?'),
    getGroupMember: db.prepare('SELECT * FROM online_group_members WHERE group_id = ? AND user_wx = ?'),
    updateGroupMemberCharacter: db.prepare('UPDATE online_group_members SET character_name = ?, character_avatar = ?, character_desc = ? WHERE group_id = ? AND user_wx = ?'),
    removeGroupMember: db.prepare('DELETE FROM online_group_members WHERE group_id = ? AND user_wx = ?'),
    
    // 群消息
    saveGroupMessage: db.prepare('INSERT INTO online_group_messages (id, group_id, sender_type, sender_wx, sender_name, character_name, content, msg_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    getGroupMessages: db.prepare('SELECT * FROM online_group_messages WHERE group_id = ? ORDER BY created_at ASC'),
    getGroupMessagesLimit: db.prepare('SELECT * FROM online_group_messages WHERE group_id = ? ORDER BY created_at DESC LIMIT ?'),
    getGroupMessagesSince: db.prepare('SELECT * FROM online_group_messages WHERE group_id = ? AND created_at > ? ORDER BY created_at ASC')
};

// 在线连接管理
const clients = new Map(); // socket -> { userId, wxAccounts: Set }
const wxAccountToSocket = new Map(); // wxAccount -> socket

// 创建 HTTP 服务器
const http = require('http');
const server = http.createServer((req, res) => {
    // 健康检查接口（只处理非 WebSocket 请求）
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        message: '联机服务器运行中',
        connections: clients.size,
        websocket: 'ws://此地址:' + PORT
    }));
});

// 创建 WebSocket 服务器（不指定 path，处理所有 WebSocket 升级请求）
const wss = new WebSocket.Server({ server });

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 联机服务器已启动，端口: ${PORT}`);
    console.log(`📂 数据库路径: ${DB_PATH}`);
    console.log(`🔗 WebSocket 地址: ws://localhost:${PORT}`);
    console.log(`🔗 健康检查: http://localhost:${PORT}`);
});

// 处理 WebSocket 连接
wss.on('connection', (ws, req) => {
    console.log('[WS] 新连接，来自:', req.socket.remoteAddress);
    
    // 初始化客户端状态
    clients.set(ws, { userId: null, wxAccounts: new Set() });
    
    // 心跳检测：标记连接为活跃
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // 处理客户端发来的心跳
            if (data.type === 'ping') {
                send(ws, { type: 'pong' });
                return;
            }
            handleMessage(ws, data);
        } catch (e) {
            console.error('[WS] 消息解析错误:', e);
            sendError(ws, '消息格式错误');
        }
    });
    
    ws.on('close', () => {
        console.log('[WS] 连接断开');
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.error('[WS] 错误:', error);
    });
});

// 心跳检测：每30秒检查一次所有连接
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('[WS] 心跳超时，关闭连接');
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(); // 发送 ping，等待 pong 响应
    });
}, 30000);

// 处理消息
function handleMessage(ws, data) {
    console.log('[WS] 收到消息:', data.type);
    
    switch (data.type) {
        case 'register':
            handleRegister(ws, data);
            break;
        case 'login':
            handleLogin(ws, data);
            break;
        case 'auth':
            handleAuth(ws, data);
            break;
        case 'logout':
            handleLogout(ws);
            break;
        case 'go_online':
            handleGoOnline(ws, data);
            break;
        case 'go_offline':
            handleGoOffline(ws, data);
            break;
        case 'get_online_characters':
            handleGetOnlineCharacters(ws);
            break;
        case 'search_user':
            handleSearchUser(ws, data);
            break;
        case 'friend_request':
            handleFriendRequest(ws, data);
            break;
        case 'accept_friend_request':
            handleAcceptFriendRequest(ws, data);
            break;
        case 'reject_friend_request':
            handleRejectFriendRequest(ws, data);
            break;
        case 'message':
            handleSendMessage(ws, data);
            break;
        case 'get_pending_requests':
            handleGetPendingRequests(ws, data);
            break;
        
        // 联机群聊
        case 'create_online_group':
            handleCreateOnlineGroup(ws, data);
            break;
        case 'invite_to_group':
            handleInviteToGroup(ws, data);
            break;
        case 'join_online_group':
            handleJoinOnlineGroup(ws, data);
            break;
        case 'get_online_groups':
            handleGetOnlineGroups(ws, data);
            break;
        case 'get_group_messages':
            handleGetGroupMessages(ws, data);
            break;
        case 'send_group_message':
            handleSendGroupMessage(ws, data);
            break;
        case 'get_group_members':
            handleGetGroupMembers(ws, data);
            break;
        case 'update_group_character':
            handleUpdateGroupCharacter(ws, data);
            break;
        case 'group_typing_start':
            handleGroupTypingStart(ws, data);
            break;
        case 'group_typing_stop':
            handleGroupTypingStop(ws, data);
            break;
            
        default:
            sendError(ws, '未知的消息类型');
    }
}

// 注册
function handleRegister(ws, data) {
    const { username, email, password } = data;
    
    if (!username || !password) {
        sendError(ws, '用户名和密码不能为空');
        return;
    }
    
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        sendError(ws, '用户名只能包含字母、数字和下划线，长度3-20位');
        return;
    }
    
    if (password.length < 6) {
        sendError(ws, '密码至少6位');
        return;
    }
    
    // 检查用户名是否已存在
    const existing = stmts.getUserByUsername.get(username);
    if (existing) {
        sendError(ws, '用户名已被注册');
        return;
    }
    
    // 创建用户
    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    
    try {
        stmts.createUser.run(userId, username, email || null, passwordHash);
        
        // 生成token
        const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
        
        // 设置客户端状态
        const clientData = clients.get(ws);
        clientData.userId = userId;
        
        send(ws, {
            type: 'register_success',
            token,
            user: { id: userId, username }
        });
        
        console.log(`[注册] 新用户: ${username}`);
    } catch (e) {
        console.error('[注册] 错误:', e);
        sendError(ws, '注册失败');
    }
}

// 登录
function handleLogin(ws, data) {
    const { username, password } = data;
    
    if (!username || !password) {
        sendError(ws, '用户名和密码不能为空');
        return;
    }
    
    const user = stmts.getUserByUsername.get(username);
    if (!user) {
        sendError(ws, '用户名或密码错误');
        return;
    }
    
    if (!bcrypt.compareSync(password, user.password_hash)) {
        sendError(ws, '用户名或密码错误');
        return;
    }
    
    // 更新最后登录时间
    stmts.updateLastLogin.run(Date.now(), user.id);
    
    // 生成token
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    
    // 设置客户端状态
    const clientData = clients.get(ws);
    clientData.userId = user.id;
    
    send(ws, {
        type: 'login_success',
        token,
        user: { id: user.id, username: user.username }
    });
    
    console.log(`[登录] 用户: ${username}`);
}

// Token认证
function handleAuth(ws, data) {
    const { token } = data;
    
    if (!token) {
        send(ws, { type: 'auth_failed', message: '未提供token' });
        return;
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = stmts.getUserById.get(decoded.userId);
        
        if (!user) {
            send(ws, { type: 'auth_failed', message: '用户不存在' });
            return;
        }
        
        // 设置客户端状态
        const clientData = clients.get(ws);
        clientData.userId = user.id;
        
        send(ws, {
            type: 'auth_success',
            user: { id: user.id, username: user.username }
        });
        
        console.log(`[认证] 用户: ${user.username}`);
        
        // 恢复之前上线的角色
        restoreUserCharacters(ws, user.id);
        
    } catch (e) {
        send(ws, { type: 'auth_failed', message: 'token无效或已过期' });
    }
}

// 恢复用户角色
function restoreUserCharacters(ws, userId) {
    const chars = stmts.getCharsByUserId.all(userId);
    const clientData = clients.get(ws);
    
    // 将之前在线的角色重新设置为在线
    chars.filter(c => c.is_online).forEach(char => {
        clientData.wxAccounts.add(char.wx_account);
        wxAccountToSocket.set(char.wx_account, ws);
    });
    
    // 发送在线角色列表
    handleGetOnlineCharacters(ws);
    
    // 投递离线消息
    chars.forEach(char => {
        deliverOfflineMessages(ws, char.wx_account);
    });
}

// 登出
function handleLogout(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    // 将所有角色设为离线
    if (clientData.userId) {
        stmts.setAllCharsOfflineByUserId.run(Date.now(), clientData.userId);
    }
    
    // 清理映射
    clientData.wxAccounts.forEach(wx => {
        wxAccountToSocket.delete(wx);
    });
    
    clientData.userId = null;
    clientData.wxAccounts.clear();
    
    console.log('[登出]');
}

// 角色上线
function handleGoOnline(ws, data) {
    const clientData = clients.get(ws);
    if (!clientData.userId) {
        sendError(ws, '请先登录');
        return;
    }
    
    const { wx_account, nickname, avatar, bio } = data;
    
    if (!wx_account || !nickname) {
        sendError(ws, '微信号和昵称不能为空');
        return;
    }
    
    // 检查微信号是否被其他用户占用
    const existingChar = stmts.getCharByWxAccount.get(wx_account);
    if (existingChar && existingChar.user_id !== clientData.userId) {
        sendError(ws, '该微信号已被其他用户使用');
        return;
    }
    
    // 创建或更新角色
    const charId = existingChar?.id || uuidv4();
    stmts.createOrUpdateChar.run(charId, clientData.userId, wx_account, nickname, avatar || '', bio || '', Date.now());
    
    // 更新映射
    clientData.wxAccounts.add(wx_account);
    wxAccountToSocket.set(wx_account, ws);
    
    send(ws, {
        type: 'character_online',
        wx_account,
        nickname
    });
    
    // 投递离线消息
    deliverOfflineMessages(ws, wx_account);
    
    // 投递待处理的好友申请
    deliverPendingFriendRequests(ws, wx_account);
    
    console.log(`[上线] ${nickname} (${wx_account})`);
}

// 角色下线
function handleGoOffline(ws, data) {
    const clientData = clients.get(ws);
    const { wx_account } = data;
    
    if (!wx_account || !clientData.wxAccounts.has(wx_account)) {
        return;
    }
    
    stmts.setCharOffline.run(Date.now(), wx_account);
    clientData.wxAccounts.delete(wx_account);
    wxAccountToSocket.delete(wx_account);
    
    send(ws, { type: 'character_offline', wx_account });
    
    console.log(`[下线] ${wx_account}`);
}

// 获取已上线角色
function handleGetOnlineCharacters(ws) {
    const clientData = clients.get(ws);
    if (!clientData.userId) {
        send(ws, { type: 'online_characters', characters: [] });
        return;
    }
    
    const chars = stmts.getCharsByUserId.all(clientData.userId);
    const onlineChars = chars.filter(c => clientData.wxAccounts.has(c.wx_account));
    
    send(ws, {
        type: 'online_characters',
        characters: onlineChars.map(c => ({
            wx_account: c.wx_account,
            nickname: c.nickname,
            avatar: c.avatar,
            bio: c.bio
        }))
    });
}

// 搜索用户
function handleSearchUser(ws, data) {
    const { wx_account } = data;
    
    if (!wx_account) {
        send(ws, { type: 'search_result', result: null });
        return;
    }
    
    const char = stmts.getCharByWxAccount.get(wx_account);
    
    if (!char) {
        send(ws, { type: 'search_result', result: null });
        return;
    }
    
    send(ws, {
        type: 'search_result',
        result: {
            wx_account: char.wx_account,
            nickname: char.nickname,
            avatar: char.avatar,
            // 不返回 bio（人设），保护隐私
            is_online: !!char.is_online
        }
    });
}

// 发送好友申请
function handleFriendRequest(ws, data) {
    const clientData = clients.get(ws);
    const { from_wx_account, to_wx_account, message } = data;
    
    if (!clientData.wxAccounts.has(from_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查目标是否存在
    const toChar = stmts.getCharByWxAccount.get(to_wx_account);
    if (!toChar) {
        sendError(ws, '目标用户不存在');
        return;
    }
    
    // 检查是否已经是好友
    const alreadyFriends = stmts.areFriends.get(from_wx_account, to_wx_account, to_wx_account, from_wx_account);
    if (alreadyFriends) {
        sendError(ws, '你们已经是好友了');
        return;
    }
    
    // 创建好友申请
    const requestId = uuidv4();
    stmts.createFriendRequest.run(requestId, from_wx_account, to_wx_account, message || '');
    
    // 获取发送者信息
    const fromChar = stmts.getCharByWxAccount.get(from_wx_account);
    
    // 如果目标在线，立即推送
    const toSocket = wxAccountToSocket.get(to_wx_account);
    if (toSocket) {
        send(toSocket, {
            type: 'friend_request',
            request: {
                id: requestId,
                from_wx_account,
                from_nickname: fromChar?.nickname || from_wx_account,
                from_avatar: fromChar?.avatar || '',
                message: message || '',
                time: Date.now()
            }
        });
    }
    
    console.log(`[好友申请] ${from_wx_account} -> ${to_wx_account}`);
}

// 接受好友申请
function handleAcceptFriendRequest(ws, data) {
    const clientData = clients.get(ws);
    const { request_id, my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const request = stmts.getFriendRequestById.get(request_id);
    if (!request || request.to_wx_account !== my_wx_account) {
        sendError(ws, '好友申请不存在');
        return;
    }
    
    if (request.status !== 'pending') {
        sendError(ws, '该申请已处理');
        return;
    }
    
    // 更新申请状态
    stmts.updateFriendRequestStatus.run('accepted', Date.now(), request_id);
    
    // 创建好友关系
    const friendshipId = uuidv4();
    stmts.createFriendship.run(friendshipId, request.from_wx_account, my_wx_account);
    
    // 获取双方信息
    const myChar = stmts.getCharByWxAccount.get(my_wx_account);
    const theirChar = stmts.getCharByWxAccount.get(request.from_wx_account);
    
    // 通知申请者
    const theirSocket = wxAccountToSocket.get(request.from_wx_account);
    if (theirSocket) {
        send(theirSocket, {
            type: 'friend_request_accepted',
            friend_wx_account: my_wx_account,
            friend_nickname: myChar?.nickname || my_wx_account,
            friend_avatar: myChar?.avatar || '',
            friend_bio: myChar?.bio || ''
        });
    }
    
    // 通知自己
    send(ws, {
        type: 'friend_request_accepted',
        friend_wx_account: request.from_wx_account,
        friend_nickname: theirChar?.nickname || request.from_wx_account,
        friend_avatar: theirChar?.avatar || '',
        friend_bio: theirChar?.bio || ''
    });
    
    console.log(`[好友申请接受] ${request.from_wx_account} <-> ${my_wx_account}`);
}

// 拒绝好友申请
function handleRejectFriendRequest(ws, data) {
    const { request_id, my_wx_account } = data;
    const clientData = clients.get(ws);
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const request = stmts.getFriendRequestById.get(request_id);
    if (!request || request.to_wx_account !== my_wx_account) {
        sendError(ws, '好友申请不存在');
        return;
    }
    
    stmts.updateFriendRequestStatus.run('rejected', Date.now(), request_id);
    
    console.log(`[好友申请拒绝] ${request.from_wx_account} -> ${my_wx_account}`);
}

// 发送消息
function handleSendMessage(ws, data) {
    const clientData = clients.get(ws);
    const { from_wx_account, to_wx_account, content } = data;
    
    if (!clientData.wxAccounts.has(from_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是好友
    const areFriends = stmts.areFriends.get(from_wx_account, to_wx_account, to_wx_account, from_wx_account);
    if (!areFriends) {
        sendError(ws, '你们还不是好友');
        return;
    }
    
    // 获取发送者信息
    const fromChar = stmts.getCharByWxAccount.get(from_wx_account);
    
    // 检查目标是否在线
    const toSocket = wxAccountToSocket.get(to_wx_account);
    if (toSocket) {
        send(toSocket, {
            type: 'message',
            from_wx_account,
            from_nickname: fromChar?.nickname || from_wx_account,
            from_avatar: fromChar?.avatar || '',
            content,
            timestamp: Date.now()
        });
    } else {
        // 保存离线消息
        const msgId = uuidv4();
        stmts.saveOfflineMessage.run(msgId, from_wx_account, to_wx_account, content);
    }
    
    console.log(`[消息] ${from_wx_account} -> ${to_wx_account}`);
}

// 获取待处理的好友申请
function handleGetPendingRequests(ws, data) {
    const clientData = clients.get(ws);
    const { wx_account } = data;
    
    if (!clientData.wxAccounts.has(wx_account)) {
        return;
    }
    
    const requests = stmts.getPendingRequestsForWx.all(wx_account, 'pending');
    
    const result = requests.map(r => {
        const fromChar = stmts.getCharByWxAccount.get(r.from_wx_account);
        return {
            id: r.id,
            from_wx_account: r.from_wx_account,
            from_nickname: fromChar?.nickname || r.from_wx_account,
            from_avatar: fromChar?.avatar || '',
            message: r.message,
            time: r.created_at
        };
    });
    
    send(ws, {
        type: 'pending_friend_requests',
        requests: result
    });
}

// 投递离线消息
function deliverOfflineMessages(ws, wxAccount) {
    const messages = stmts.getOfflineMessages.all(wxAccount);
    
    messages.forEach(msg => {
        const fromChar = stmts.getCharByWxAccount.get(msg.from_wx_account);
        send(ws, {
            type: 'message',
            from_wx_account: msg.from_wx_account,
            from_nickname: fromChar?.nickname || msg.from_wx_account,
            from_avatar: fromChar?.avatar || '',
            content: msg.content,
            timestamp: msg.created_at
        });
    });
    
    if (messages.length > 0) {
        stmts.markMessagesDelivered.run(wxAccount);
        console.log(`[离线消息] 投递 ${messages.length} 条消息给 ${wxAccount}`);
    }
}

// 投递待处理的好友申请
function deliverPendingFriendRequests(ws, wxAccount) {
    const requests = stmts.getPendingRequestsForWx.all(wxAccount, 'pending');
    
    requests.forEach(r => {
        const fromChar = stmts.getCharByWxAccount.get(r.from_wx_account);
        send(ws, {
            type: 'friend_request',
            request: {
                id: r.id,
                from_wx_account: r.from_wx_account,
                from_nickname: fromChar?.nickname || r.from_wx_account,
                from_avatar: fromChar?.avatar || '',
                message: r.message,
                time: r.created_at
            }
        });
    });
}

// 处理断开连接
function handleDisconnect(ws) {
    const clientData = clients.get(ws);
    if (!clientData) return;
    
    // 将所有角色设为离线
    clientData.wxAccounts.forEach(wx => {
        stmts.setCharOffline.run(Date.now(), wx);
        wxAccountToSocket.delete(wx);
    });
    
    clients.delete(ws);
}

// 发送消息
function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// 发送错误
function sendError(ws, message) {
    send(ws, { type: 'error', message });
}

// ==================== 联机群聊功能 ====================

// 创建联机群聊
function handleCreateOnlineGroup(ws, data) {
    const clientData = clients.get(ws);
    if (!clientData.userId) {
        sendError(ws, '请先登录');
        return;
    }
    
    const { name, my_wx_account, invite_wx_accounts, my_character } = data;
    
    if (!name || !my_wx_account) {
        sendError(ws, '群名称和创建者微信号不能为空');
        return;
    }
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 创建群聊
    const groupId = uuidv4();
    stmts.createGroup.run(groupId, name, '', my_wx_account);
    
    // 添加创建者为成员
    const memberId = uuidv4();
    stmts.addGroupMember.run(
        memberId, groupId, my_wx_account,
        my_character?.name || null,
        my_character?.avatar || null,
        my_character?.desc || null
    );
    
    // 获取创建者信息
    const creatorChar = stmts.getCharByWxAccount.get(my_wx_account);
    
    // 给创建者发送成功消息
    send(ws, {
        type: 'online_group_created',
        group: {
            id: groupId,
            name: name,
            creator_wx: my_wx_account,
            created_at: Date.now()
        }
    });
    
    // 邀请好友
    if (invite_wx_accounts && invite_wx_accounts.length > 0) {
        invite_wx_accounts.forEach(inviteWx => {
            const inviteSocket = wxAccountToSocket.get(inviteWx);
            if (inviteSocket) {
                send(inviteSocket, {
                    type: 'group_invite',
                    group_id: groupId,
                    group_name: name,
                    inviter_wx: my_wx_account,
                    inviter_name: creatorChar?.nickname || my_wx_account
                });
            }
        });
    }
    
    console.log(`[群聊] 创建群聊: ${name} (${groupId}) by ${my_wx_account}`);
}

// 邀请好友加入群聊
function handleInviteToGroup(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, invite_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查群是否存在
    const group = stmts.getGroupById.get(group_id);
    if (!group) {
        sendError(ws, '群聊不存在');
        return;
    }
    
    // 检查邀请者是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 获取邀请者信息
    const inviterChar = stmts.getCharByWxAccount.get(my_wx_account);
    
    // 发送邀请
    const inviteSocket = wxAccountToSocket.get(invite_wx_account);
    if (inviteSocket) {
        send(inviteSocket, {
            type: 'group_invite',
            group_id: group_id,
            group_name: group.name,
            inviter_wx: my_wx_account,
            inviter_name: inviterChar?.nickname || my_wx_account
        });
    }
    
    console.log(`[群聊] 邀请 ${invite_wx_account} 加入群 ${group.name}`);
}

// 加入群聊
function handleJoinOnlineGroup(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, my_character } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查群是否存在
    const group = stmts.getGroupById.get(group_id);
    if (!group) {
        sendError(ws, '群聊不存在');
        return;
    }
    
    // 检查是否已是成员
    const existingMember = stmts.getGroupMember.get(group_id, my_wx_account);
    if (existingMember) {
        // 已经是成员，更新角色信息
        if (my_character) {
            stmts.updateGroupMemberCharacter.run(
                my_character.name, my_character.avatar, my_character.desc,
                group_id, my_wx_account
            );
        }
    } else {
        // 添加为新成员
        const memberId = uuidv4();
        stmts.addGroupMember.run(
            memberId, group_id, my_wx_account,
            my_character?.name || null,
            my_character?.avatar || null,
            my_character?.desc || null
        );
    }
    
    // 获取加入者信息
    const joinerChar = stmts.getCharByWxAccount.get(my_wx_account);
    
    // 通知所有群成员
    const members = stmts.getGroupMembers.all(group_id);
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, {
                type: 'group_member_joined',
                group_id: group_id,
                member: {
                    user_wx: my_wx_account,
                    user_name: joinerChar?.nickname || my_wx_account,
                    user_avatar: joinerChar?.avatar || '',
                    character_name: my_character?.name || null,
                    character_avatar: my_character?.avatar || null
                }
            });
        }
    });
    
    // 发送加入成功消息给自己
    send(ws, {
        type: 'online_group_joined',
        group: {
            id: group_id,
            name: group.name,
            creator_wx: group.creator_wx,
            created_at: group.created_at
        }
    });
    
    console.log(`[群聊] ${my_wx_account} 加入群 ${group.name}`);
}

// 获取我的联机群聊列表
function handleGetOnlineGroups(ws, data) {
    const clientData = clients.get(ws);
    const { my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    const groups = stmts.getGroupsByMember.all(my_wx_account);
    
    send(ws, {
        type: 'online_groups_list',
        groups: groups.map(g => ({
            id: g.id,
            name: g.name,
            creator_wx: g.creator_wx,
            created_at: g.created_at
        }))
    });
}

// 获取群聊消息记录
function handleGetGroupMessages(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, limit, since } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    let messages;
    if (since) {
        messages = stmts.getGroupMessagesSince.all(group_id, since);
    } else if (limit) {
        messages = stmts.getGroupMessagesLimit.all(group_id, limit).reverse();
    } else {
        messages = stmts.getGroupMessages.all(group_id);
    }
    
    send(ws, {
        type: 'group_messages',
        group_id: group_id,
        messages: messages
    });
}

// 发送群聊消息
function handleSendGroupMessage(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, sender_type, sender_name, character_name, content, msg_type } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 如果是角色发的消息，验证是否是该用户的角色
    if (sender_type === 'character' && character_name !== member.character_name) {
        sendError(ws, '你只能使用自己带入群的角色发言');
        return;
    }
    
    // 保存消息
    const msgId = uuidv4();
    stmts.saveGroupMessage.run(
        msgId, group_id, sender_type || 'user', my_wx_account,
        sender_name, character_name || null, content, msg_type || 'text'
    );
    
    // 获取发送者头像
    const senderChar = stmts.getCharByWxAccount.get(my_wx_account);
    
    // 广播给所有群成员
    const members = stmts.getGroupMembers.all(group_id);
    const msgData = {
        type: 'group_message',
        group_id: group_id,
        message: {
            id: msgId,
            sender_type: sender_type || 'user',
            sender_wx: my_wx_account,
            sender_name: sender_name,
            sender_avatar: senderChar?.avatar || '',
            character_name: character_name || null,
            character_avatar: sender_type === 'character' ? member.character_avatar : null,
            content: content,
            msg_type: msg_type || 'text',
            created_at: Date.now()
        }
    };
    
    members.forEach(m => {
        const memberSocket = wxAccountToSocket.get(m.user_wx);
        if (memberSocket) {
            send(memberSocket, msgData);
        }
    });
    
    console.log(`[群消息] ${sender_type === 'character' ? character_name : sender_name} in ${group_id}: ${content.substring(0, 30)}...`);
}

// 处理群聊"正在输入"状态开始
function handleGroupTypingStart(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, character_name } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        return;
    }
    
    // 广播给群里的其他成员（除了自己）
    const members = stmts.getGroupMembers.all(group_id);
    members.forEach(m => {
        if (m.user_wx !== my_wx_account) { // 不发给自己
            const memberSocket = wxAccountToSocket.get(m.user_wx);
            if (memberSocket) {
                send(memberSocket, {
                    type: 'group_typing_start',
                    group_id: group_id,
                    character_name: character_name,
                    user_wx: my_wx_account
                });
            }
        }
    });
    
    console.log(`[群聊] ${character_name} 开始输入 (群: ${group_id})`);
}

// 处理群聊"正在输入"状态结束
function handleGroupTypingStop(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        return;
    }
    
    // 广播给群里的其他成员（除了自己）
    const members = stmts.getGroupMembers.all(group_id);
    members.forEach(m => {
        if (m.user_wx !== my_wx_account) { // 不发给自己
            const memberSocket = wxAccountToSocket.get(m.user_wx);
            if (memberSocket) {
                send(memberSocket, {
                    type: 'group_typing_stop',
                    group_id: group_id,
                    user_wx: my_wx_account
                });
            }
        }
    });
    
    console.log(`[群聊] 输入结束 (群: ${group_id}, 用户: ${my_wx_account})`);
}

// 获取群成员列表
function handleGetGroupMembers(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    const members = stmts.getGroupMembers.all(group_id);
    
    // 获取每个成员的在线状态和昵称
    const membersWithInfo = members.map(m => {
        const charInfo = stmts.getCharByWxAccount.get(m.user_wx);
        return {
            user_wx: m.user_wx,
            user_name: charInfo?.nickname || m.user_wx,
            user_avatar: charInfo?.avatar || '',
            is_online: charInfo?.is_online === 1,
            character_name: m.character_name,
            character_avatar: m.character_avatar,
            character_desc: m.character_desc
        };
    });
    
    send(ws, {
        type: 'group_members',
        group_id: group_id,
        members: membersWithInfo
    });
}

// 更新群内角色
function handleUpdateGroupCharacter(ws, data) {
    const clientData = clients.get(ws);
    const { group_id, my_wx_account, character } = data;
    
    if (!clientData.wxAccounts.has(my_wx_account)) {
        sendError(ws, '你没有使用该微信号上线');
        return;
    }
    
    // 检查是否是群成员
    const member = stmts.getGroupMember.get(group_id, my_wx_account);
    if (!member) {
        sendError(ws, '你不是该群的成员');
        return;
    }
    
    // 更新角色信息
    stmts.updateGroupMemberCharacter.run(
        character?.name || null,
        character?.avatar || null,
        character?.desc || null,
        group_id, my_wx_account
    );
    
    send(ws, {
        type: 'group_character_updated',
        group_id: group_id,
        character: character
    });
    
    console.log(`[群聊] ${my_wx_account} 更新群 ${group_id} 的角色为 ${character?.name || '无'}`);
}

// ==================== 联机群聊功能结束 ====================

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    
    // 将所有角色设为离线
    db.exec('UPDATE online_characters SET is_online = 0');
    
    // 关闭 WebSocket 服务器
    wss.close();
    
    // 关闭 HTTP 服务器
    server.close(() => {
        db.close();
        console.log('服务器已关闭');
        process.exit(0);
    });
});

