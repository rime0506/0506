# Photon iMessage Connector

这是给网站用户自行部署的 Photon Spectrum Cloud iMessage 连接器。每位用户使用自己的 Photon 项目和 Vercel 账号，网站不会接触 Photon Project Secret。

## 部署

1. 在 `https://app.photon.codes` 创建 Spectrum Cloud 项目并准备角色对应的专用 iMessage Line。
2. 把本目录作为一个独立 Git 仓库，或在 Vercel 导入主仓库后将 Root Directory 设置为 `photon-imessage-connector`。
3. 在 Vercel 添加环境变量：

   - `SPECTRUM_PROJECT_ID`
   - `SPECTRUM_PROJECT_SECRET`
   - `CONNECTOR_ACCESS_KEY`：自行生成的长随机字符串
   - `ALLOWED_ORIGIN`：网站来源，例如 `https://example.com`；本地测试可暂时设置 `*`

4. 部署后复制 Vercel 项目地址，例如 `https://my-photon-connector.vercel.app`。
5. 在网站角色聊天详情的 iMessage 区域填写连接器地址、访问密钥、角色发送号码和收件地址。

## 接口

- `GET /api/health`：校验连接器访问密钥和 Photon 项目凭据。
- `POST /api/send`：使用指定 Photon 专用号码向一个手机号或 Apple ID 邮箱发送文字消息。

Spectrum Cloud 多专用号码路由要求发送号码属于当前项目。Free/Pro 共享号码池不会保证“一角色一固定号码”；一角色一号码需要 Photon 提供可按 `phone` 路由的专用 Line。
