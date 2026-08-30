# LoopMessage iMessage Connector

这是给网站用户自行部署的 LoopMessage iMessage 连接器。每位用户使用自己的 LoopMessage、GitHub 和 Vercel 账号；网站前端不会接触 LoopMessage Organization API Key。

## 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Frime0506%2F0506&root-directory=loopmessage-connector&project-name=loopmessage-connector&repository-name=loopmessage-connector&env=LOOPMESSAGE_API_KEY%2CCONNECTOR_ACCESS_KEY%2CALLOWED_ORIGIN&envDescription=%E8%AF%B7%E5%A1%AB%E5%86%99%20LoopMessage%20Organization%20API%20Key%E3%80%81%E7%BD%91%E7%AB%99%E7%94%9F%E6%88%90%E7%9A%84%E8%BF%9E%E6%8E%A5%E5%99%A8%E8%AE%BF%E9%97%AE%E5%AF%86%E9%92%A5%EF%BC%8C%E4%BB%A5%E5%8F%8A%E5%85%81%E8%AE%B8%E8%B0%83%E7%94%A8%E8%BF%9E%E6%8E%A5%E5%99%A8%E7%9A%84%E7%BD%91%E7%AB%99%E6%9D%A5%E6%BA%90%E3%80%82&envLink=https%3A%2F%2Fgithub.com%2Frime0506%2F0506%2Ftree%2Fmain%2Floopmessage-connector)

任何用户都可以点击按钮部署，不需要是原 GitHub 仓库的作者。Vercel 会复制公开仓库，并把 Root Directory 设置为 `loopmessage-connector`。

## 环境变量

- `LOOPMESSAGE_API_KEY`：LoopMessage Dashboard → Organization → API → Settings 中的 Organization API Key。只填原始 Key，不加 `Bearer`。
- `CONNECTOR_ACCESS_KEY`：网站设置页点击“生成并复制”获得；Vercel 与网站必须填写同一个值。
- `ALLOWED_ORIGIN`：允许调用连接器的网站来源，例如 `https://example.com`。多个来源用英文逗号分隔；仅本地测试可临时设为 `*`。

部署完成后复制 `https://你的项目.vercel.app`，粘贴进网站的“连接器地址”，再点击“测试连接”。

## 发送模式

- Sandbox：免费测试，最多添加少量联系人。联系人必须与 iPhone/Mac“发起新对话时使用”的手机号或邮箱完全一致，并先给 Sandbox 发一条 iMessage；收到入站消息后会开启 24 小时发送窗口。网站里的 Sender ID 可留空。
- 共享 Sender：接收者先完成共享号码的 opt-in 并建立会话。已建立会话时 Sender ID 可留空。
- 专用 Sender：适合“一角色一个固定号码”。在每个角色设置里填入该角色对应的 LoopMessage Sender ID。

## 接口

- `GET /api/health`：验证网站访问密钥和 LoopMessage API Key。
- `POST /api/send`：发送一条 iMessage 文字消息；接收 `recipient`、`text`、可选 `senderId` 和 `clientMessageId`。

当前版本只实现网站主动发出消息，不处理入站 webhook。
