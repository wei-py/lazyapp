# 证件与签名凭据有效期调研

核对日期：2026-11-02。范围来自 `src/config/model.js` 的现有字段。以下保留官方依据与核验边界；手动填写与提醒已经实现，准确数据与交互契约见 [开发规格](spec.md)。

## 已采用的填写与提醒规则

- 记录实际证书或描述文件的到期日期，不按导入时间推算，不硬编码统一年限。
- 每份证书、每份描述文件独立记录；签名配置按现有平台及环境归属保存，不能用一个平台日期覆盖所有凭据。
- 到期日期是可选信息。未填写表示“有效期未设置”，不是“长期有效”；确实适用的材料才允许明确选择“长期有效”。
- 总览提前 30 天提醒；到期当天单独显示“今日到期”，已过期继续显示，并按到期日期排序。提醒项可进入对应配置。
- 日期按本地日历日比较，不按毫秒差截断；总览刷新、恢复前台或跨日后更新，TUI 跨日后一分钟内重绘。
- 当前实现手动填写，不自动解析证书、不接外部平台、不执行更新或续费。所有日期选填；只有营业执照、免责函及软著补充材料接受明确的 `never` 长期标记。
- 提醒只说明填写日期将到期，不能据此宣称凭据已校验、发布已就绪，或所有已发行应用都会停用。

## Android、Harmony 与小程序

|平台及现有字段|建议|官方依据及边界|
|---|---|---|
|Android `keystore` + `alias` 对应的签名证书|支持可选到期日期，不强制填写|Android 官方创建密钥流程包含 `Validity (years)`；不是没有有效期，而是通常设置较长。记录 alias 对应证书的实际日期，不是容器文件日期。若未来分别管理 Play 应用签名密钥与上传密钥，二者必须分开。[Android 签名指南](https://developer.android.com/studio/publish/app-signing?hl=zh-cn#generate-key)|
|Harmony `certificate`（`.cer`）|建议添加独立可选到期日期|照实际证书或控制台填写。新版华为申请发布证书页面跳转登录，本轮未取得当前有效期条款，不能宣称已核实统一年限。[申请发布证书](https://developer.huawei.com/consumer/cn/doc/app/agc-help-release-cert-0000002283336729)|
|Harmony `profile`（`.p7b`）|[INFERENCE] 建议添加独立可选到期日期|不能因为与证书配套使用就复制证书日期。本轮未取得新版 Profile 有效期正文；实施时允许按实际文件或控制台记录，不预设期限。[华为官方 FAQ](https://developer.huawei.com/consumer/cn/doc/app/agc-help-releasefaq-0000001110342644)|
|Harmony `keystore`（`.p12`）|[INFERENCE] 不无条件新增第三个“文件到期日”|先确认容器中的证书与 `.cer` 的关系，避免重复记录；本次无法从可访问华为正文核实对应关系，也不能认为容器中的证书永不过期。|
|微信小程序 `privateKey`（上传密钥）|仅后台实际给出截止日时选填|已读取的 `miniprogram-ci` 正文没有有效期规定；“平台可配置期限”本轮未独立核实，不能写成确定事实。[微信 miniprogram-ci](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html)|
|小程序 `appSecret`|不默认添加统一到期日|微信 AppSecret 与获取的短期 access_token 不是同一凭据；未找到 AppSecret 统一定期失效的官方依据，不能由此宣称永久有效。[微信团队安全说明](https://developers.weixin.qq.com/community/minihome/doc/0004a84fcb0bb0e89eddbaa5156401)|
|支付宝及其他小程序 provider 的密钥|按具体机制核实，不套用微信规则|支付宝文档尝试未取得有效正文；`other` 没有指定厂商。保留未知，不默认期限。|

## Apple 与 Windows

|平台及现有字段|建议|官方依据及边界|
|---|---|---|
|iOS `certificate`|添加可选到期日期|`.p12` 是容器，应记录实际签名证书到期日；不同证书类型不能统一推算年限。[1]|
|iOS `provisioningProfile`|添加独立可选到期日期|Profile 有自身 `ExpirationDate`，不能复用证书日期。App Store 最终发行物会被重新签名，不应将本地 profile 到期等同于商店应用全部停用。[2]|
|iOS App Store Connect `privateKey`|不添加推算的官方到期日|官方创建、撤销说明未规定统一自动到期年限；JWT 有效期不是 `.p8` 私钥有效期。（来源 3、4）|
|iOS `apnsKey`|不添加到期日期|APNs token signing key 官方明确不自动到期，但可以撤销。该结论不适用于 APNs TLS 证书。[5]|
|macOS `certificate`|添加可选到期日期|以实际证书为准，区分商店证书、Developer ID Application、Developer ID Installer。（来源 1、6）|
|macOS `provisioningProfile`|使用时添加独立可选到期日期|并非所有 macOS 应用都需要 profile。Developer ID profile 有其特定期限，不能当成所有 profile 的默认规则。（来源 2、6）|
|Windows `certificate`|添加可选到期日期|记录 PFX 中签名证书的到期日；可信时间戳、MSIX 信任要求及 Store 签名会影响既有发行物，不能笼统提示应用停用。（来源 7、8、9）|

Apple Developer Program 会员续费日期与证书、Profile 日期属于不同实体。[6] 若要记录，应单独设计账号/团队信息，不塞入某份证书的字段；当前字段范围不包含账号续费管理。

## 通用材料与服务

|现有字段|建议|依据及边界|
|---|---|---|
|`assets.businessLicense`|可选填写实际经营期限，允许明确标记长期有效；不能强制到期日|2023 年市场监管总局通知明确，多类新版营业执照不再记载营业期限等信息；不能要求用户仅凭新版执照填出日期，也不能把没有日期自动当作长期。[10]|
|`assets.softwareCopyright`|不默认加入证件续期提醒|软件著作权的法定保护期不是登记证书的定期换证日期；不应把登记日起固定年限当作证书到期日。[11]|
|`assets.waiver`、`assets.copyrightSupplement`|仅材料实际约定期限时选填|产品建议：按具体文件约定，不凭文件类型虚构统一期限。|
|服务 `credentials`、`privateKey`、`token` 等|不统一增加“证件有效期”|产品建议：证书、API 密钥、短期访问令牌的生命周期不同。未来如涉及真实有期限的服务凭据，应按具体对象建模，而非把整个服务配置赋予一个到期日。|
|图标、截图、宣传图、普通配置 JSON|不添加有效期|这些字段不代表有有效期的证件。|

## 官方来源

1. Apple — [Certificates overview](https://developer.apple.com/help/account/certificates/certificates-overview)
2. Apple — [TN3125: Inside Code Signing: Provisioning Profiles](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles)
3. Apple — [Creating API Keys for App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
4. Apple — [Revoking API Keys](https://developer.apple.com/documentation/appstoreconnectapi/revoking-api-keys)
5. Apple — [Communicate with APNs using authentication tokens](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens)
6. Apple — [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
7. Microsoft — [Time Stamping Authenticode Signatures](https://learn.microsoft.com/en-us/windows/win32/seccrypto/time-stamping-authenticode-signatures)
8. Microsoft — [Sign an MSIX package](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview)
9. Microsoft — [Sign an app package using SignTool](https://learn.microsoft.com/en-us/windows/msix/package/sign-app-package-using-signtool)
10. 市场监管总局 — [关于调整营业执照照面事项的通知](https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/djzcj/art/2023/art_9c67139da37a46fc8955d42d130947b2.html)
11. 国务院《计算机软件保护条例》— [中央网信办转载](https://www.cac.gov.cn/2013-02/08/c_126468744.htm)
