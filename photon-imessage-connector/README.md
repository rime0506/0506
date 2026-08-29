# Photon iMessage Connector

这是给网站用户自行部署的 Photon Spectrum Cloud iMessage 连接器。每位用户使用自己的 Photon 项目和 Vercel 账号，网站不会接触 Photon Project Secret。

## 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frime0506%2F0506&root-directory=photon-imessage-connector&project-name=photon-imessage-connector&repository-name=photon-imessage-connector&env=SPECTRUM_PROJECT_ID%2CSPECTRUM_PROJECT_SECRET%2CCONNECTOR_ACCESS_KEY%2CALLOWED_ORIGIN&envDescription=%E8%AF%B7%E5%A1%AB%E5%86%99%20Photon%20%E9%A1%B9%E7%9B%AE%20ID%E3%80%81%E9%A1%B9%E7%9B%AE%20Secret%E3%80%81%E8%87%AA%E5%AE%9A%E4%B9%89%E8%BF%9E%E6%8E%A5%E5%99%A8%E8%AE%BF%E9%97%AE%E5%AF%86%E9%92%A5%EF%BC%8C%E4%BB%A5%E5%8F%8A%E5%85%81%E8%AE%B8%E8%B0%83%E7%94%A8%E8%BF%9E%E6%8E%A5%E5%99%A8%E7%9A%84%E7%BD%91%E7%AB%99%E6%9D%A5%E6%BA%90%E3%80%82&envLink=https%3A%2F%2Fgithub.com%2Frime0506%2F0506%2Ftree%2Fmain%2Fphoton-imessage-connector)

上面的按钮部署的是本目录中的 iMessage 连接器，不是 Photon 本身。Vercel 会自动把 Root Directory 设置成 `photon-imessage-connector`，并在部署前要求用户填写所需环境变量。

1. 在 `https://app.photon.codes` 创建 Spectrum Cloud 项目并准备角色对应的专用 iMessage Line。
2. 点击上方 `Deploy with Vercel`；也可以手动导入主仓库并把 Root Directory 设置为 `photon-imessage-connector`。
3. 在 Vercel 添加环境变量：

   - `SPECTRUM_PROJECT_ID`：Photon 控制台 → 当前项目 → Settings → Project ID。
   - `SPECTRUM_PROJECT_SECRET`：同一 Settings 页面中的 Project Secret / Secret Key。不要填写 Photon 登录密码。
   - `CONNECTOR_ACCESS_KEY`：在网站 Photon iMessage 设置中点击“生成并复制”；Vercel 和网站必须使用同一个值。
   - `ALLOWED_ORIGIN`：网站地址中协议和域名部分，例如网站是 `https://rime0506.github.io/0506/`，这里填写 `https://rime0506.github.io`，不要带最后的路径。本地 `file://` 测试可暂时设置 `*`。

任何用户都可以通过部署按钮把公开模板复制到自己的 GitHub/GitLab/Bitbucket 并部署到自己的 Vercel，不需要拥有或修改原仓库。

4. 部署后复制 Vercel 项目地址，例如 `https://my-photon-connector.vercel.app`。
5. 在网站角色聊天详情的 iMessage 区域填写连接器地址、访问密钥、角色发送号码和收件地址。

## 接口

- `GET /api/health`：校验连接器访问密钥和 Photon 项目凭据。
- `POST /api/send`：使用指定 Photon 专用号码向一个手机号或 Apple ID 邮箱发送文字消息。

Spectrum Cloud 多专用号码路由要求发送号码属于当前项目。Free/Pro 共享号码池不会保证“一角色一固定号码”；一角色一号码需要 Photon 提供可按 `phone` 路由的专用 Line。
