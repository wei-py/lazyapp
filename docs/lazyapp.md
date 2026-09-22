对，那就应该把它设计成一个**纯本地的个人 App 配置保险箱/工作台**，不考虑 UniApp，也不需要为了 Git/团队协作过度设计。

而且你说得对：如果是你自己用、整个 `lazyapp/` 不上传仓库，那么**密码、私钥、Token 等敏感信息都可以直接保存在里面**。重点是目录结构清晰、TUI 好用、以后不容易漏配置。

## 我建议重新定义 `lazyapp`

```text
lazyapp
= Local Mobile App Configuration Manager
```

管理的不只是证书，而是：

```text
App
├── 基础信息
├── 图标
├── 启动页
├── Android
├── iOS
├── HarmonyOS
├── Windows
├── macOS
├── 小程序
├── 推送
├── 第三方服务
├── API / 环境
└── 其他发布资料
```

---

# 一、目录结构

我建议第一版直接这样：

当前首次启动先在普通终端询问是否创建工作区 `(y/N)`，默认拒绝；回答 `y` 后原子创建最小 `app.json` 与 `.example` 占位结构并直接进入 TUI，不要求填写初始化表单或提供真实图片／签名凭据。下方目录树描述补齐资料后的目标结构；首次创建时配置使用 `*.json.example`，资源／签名说明使用对应目标名，如 `source.png.example`、`certificate.p12.example`。默认准备全部平台及 development／production 示例，但 App 尚未启用任何平台或环境。TUI 中缺失的逻辑条目显示红色，真实文件存在显示绿色（不代表验证有效）；Enter 编辑缺失配置或导入资源后立即更新颜色。具体行为以 `docs/spec.md` 第 12 节为准。

```text
my-app/
└── lazyapp/
    │
    ├── app.json
    │
    ├── assets/
    │   ├── icon/
    │   │   └── source.png
    │   │
    │   └── splash/
    │       └── source.png
    │
    ├── platforms/
    │   │
    │   ├── android/
    │   │   ├── config.json
    │   │   ├── development/
    │   │   │   ├── signing.keystore
    │   │   │   └── config.json
    │   │   │
    │   │   └── production/
    │   │       ├── signing.keystore
    │   │       └── config.json
    │   │
    │   ├── ios/
    │   │   ├── config.json
    │   │   ├── development/
    │   │   │   ├── certificate.p12
    │   │   │   ├── provisioning.mobileprovision
    │   │   │   └── config.json
    │   │   │
    │   │   └── production/
    │   │       ├── certificate.p12
    │   │       ├── provisioning.mobileprovision
    │   │       └── config.json
    │   │
    │   └── harmony/
    │       ├── config.json
    │       ├── development/
    │       │   ├── certificate.cer
    │       │   ├── profile.p7b
    │       │   ├── keystore.p12
    │       │   └── config.json
    │       │
    │       └── production/
    │           ├── certificate.cer
    │           ├── profile.p7b
    │           ├── keystore.p12
    │           └── config.json
    │
    ├── services/
    │   ├── apple.json
    │   ├── google.json
    │   ├── huawei.json
    │   ├── amap.json
    │   ├── wechat.json
    │   └── ...
    │
    ├── environments/
    │   ├── development.json
    │   ├── test.json
    │   ├── staging.json
    │   └── production.json
    │
    └── notes/
        └── README.md
```

不过我会再做一个调整：

**不要强制每个平台必须 development / production。**

因为不同平台的实际情况不一样。

所以由 TUI 创建：

```text
Environments

[x] development
[x] production
[ ] test
[ ] staging
[+] custom
```

---

# 二、到底应该保存哪些信息？

这个才是 `lazyapp` 的核心。

## Android

至少：

```text
Android
├── Application ID
├── Version Code
├── Version Name
│
└── Signing
    ├── Keystore
    ├── Keystore Password
    ├── Key Alias
    └── Key Password
```

还可以保存：

```text
├── Google Play
│   ├── Package Name
│   ├── Service Account JSON
│   └── Play Console information
│
├── Firebase
│   ├── google-services.json
│   └── Firebase App ID
│
└── Push
    └── FCM credentials
```

---

# 三、iOS

iOS 需要单独设计。

```text
iOS
├── Bundle ID
├── Team ID
├── Apple ID
│
├── Development
│   ├── Certificate .p12
│   ├── Certificate Password
│   └── Provisioning Profile
│
└── Production
    ├── Certificate .p12
    ├── Certificate Password
    └── Provisioning Profile
```

然后再考虑：

```text
App Store Connect
├── Issuer ID
├── Key ID
└── Private Key .p8
```

还有：

```text
Push Notifications
├── APNs Auth Key .p8
├── Key ID
└── Team ID
```

以及：

```text
Capabilities
├── Push Notifications
├── Associated Domains
├── Sign in with Apple
├── iCloud
├── App Groups
└── ...
```

这些其实也属于 App 配置资产。

---

# 四、HarmonyOS

同样独立设计：

```text
HarmonyOS
├── Bundle Name
├── Bundle Type
│
├── Development
│   ├── Certificate .cer
│   ├── Profile .p7b
│   ├── Keystore .p12
│   ├── Key Alias
│   ├── Keystore Password
│   └── Key Password
│
└── Production
    ├── Certificate .cer
    ├── Profile .p7b
    ├── Keystore .p12
    ├── Key Alias
    ├── Keystore Password
    └── Key Password
```

---

# 五、还有大量容易忘记的东西

这个其实是你这个工具最有价值的地方。

### App 身份

```text
App ID
Bundle ID
Package Name
Application ID
Team ID
Developer ID
```

### 商店

```text
Apple App Store
Google Play
Huawei AppGallery
Microsoft Store
Mac App Store
```

### 推送

```text
APNs
FCM
Huawei Push
小米 Push
OPPO Push
vivo Push
荣耀 Push
```

### 第三方服务

```text
地图
微信
支付宝
支付
短信
OCR
对象存储
统计
崩溃监控
登录
OAuth
广告
AI API
```

### API

```text
Development API
Test API
Staging API
Production API
```

### 域名

```text
API
Web
CDN
Download
Privacy Policy
Terms
```

### 商店资料

甚至可以保存：

```text
Store
├── App Name
├── Subtitle
├── Description
├── Keywords
├── Privacy URL
├── Support URL
├── Marketing URL
├── Screenshots
└── Promotional Images
```

所以它慢慢就不是「证书管理器」了。

而是：

> **App 的单一配置来源。**

---

# 六、TUI 首页

我会让它非常简单：

```text
┌──────────────────────────────────────────────┐
│ lazyapp                         my-app       │
├──────────────────────────────────────────────┤
│                                              │
│ ❯ App                                        │
│   Assets                                     │
│   Platforms                                  │
│   Services                                   │
│   Environments                               │
│   Store                                      │
│                                              │
│   ────────────────────────────────────────   │
│                                              │
│   Doctor                                     │
│   Settings                                   │
│                                              │
└──────────────────────────────────────────────┘
```

进入 `Platforms`：

```text
┌──────────────────────────────────────────────┐
│ Platforms                                    │
├──────────────────────────────────────────────┤
│                                              │
│ ❯ Android                 ✓ configured       │
│   iOS                     ⚠ incomplete       │
│   HarmonyOS               ✓ configured       │
│   macOS                   — not configured   │
│   Windows                 — not configured   │
│   WeChat                  ✓ configured       │
│                                              │
│                                              │
│   + Add Platform                             │
│                                              │
└──────────────────────────────────────────────┘
```

---

# 七、第一次运行

这是你刚才说的重点：

```bash
lazyapp
```

检测：

```text
No lazyapp configuration found.

Current directory:

~/Projects/my-app

Create lazyapp configuration?

❯ Yes
  No
```

然后：

```text
Step 1 / 6

Application

Name
> My App

Identifier
> com.example.myapp

Environments

[x] development
[x] production
[ ] test
[ ] staging
```

---

然后：

```text
Step 2 / 6

Platforms

[x] Android
[x] iOS
[x] HarmonyOS
[ ] macOS
[ ] Windows
[ ] WeChat
```

然后：

```text
Step 3 / 6

Assets

App Icon
> Select file

Splash Screen
> Select file
```

然后 Android：

```text
Step 4 / 6

Android

Application ID
> com.example.myapp

Development Signing

Keystore
> Select file

Store Password
> ********

Alias
> myapp

Key Password
> ********

Production Signing
...
```

接下来 iOS、HarmonyOS。

最后：

```text
Step 6 / 6

Configuration Summary

✓ App
✓ Assets
✓ Android
✓ iOS
✓ HarmonyOS

Create configuration?

❯ Create
  Back
  Cancel
```

---

# 八、敏感信息我建议「正常保存」

既然这是你的**个人本地工具**，我反而不建议第一版搞：

```text
Keychain
Vault
AES
Master Password
Secret Server
```

把事情复杂化。

直接：

```json
{
  "keystore": "./signing.keystore",
  "storePassword": "xxxxxx",
  "alias": "myapp",
  "keyPassword": "xxxxxx"
}
```

就可以。

不过增加一个：

```text
lazyapp/.gitignore
```

自动创建：

```gitignore
lazyapp/
```

或者更精细：

```gitignore
lazyapp/platforms/**/development/*
lazyapp/platforms/**/production/*
lazyapp/services/*
lazyapp/environments/*
```

**但你自己不提交 Git 的话，这只是保险，不影响使用。**

---

# 九、我甚至建议增加「文件引用 + 内嵌」两种模式

比如证书：

```text
Certificate

❯ Copy into lazyapp
  Use existing file
```

如果选择：

```text
Copy into lazyapp
```

就：

```text
lazyapp/platforms/ios/production/certificate.p12
```

如果选择：

```text
Use existing file
```

就保存：

```json
{
  "certificate": "/Users/wx/Documents/certs/app.p12"
}
```

这样特别适合你自己用。

---

# 十、最终 `lazyapp` 的定位

我会把第一版收敛成这几个功能：

```text
lazyapp
│
├── init       初始化目录
│
├── config     TUI 配置
│
├── assets     Icon / Splash / Store Assets
│
├── platforms  Android / iOS / HarmonyOS / ...
│
├── services   第三方服务
│
├── env        development / test / production
│
├── store      App Store / Play / 华为等
│
└── doctor     检查配置完整性
```

但**第一阶段 CLI 甚至不需要这么多命令**：

```bash
lazyapp
```

就是全部入口。

进入 TUI 后：

```text
App
Assets
Platforms
Services
Environments
Store
Doctor
Settings
```

**最关键的设计原则就是：`lazyapp` 不负责「做事情」，先负责「把一个 App 所有需要的东西收拾整齐」。**

以后再加 `build`、`release`、`generate` 都行，但第一版先把这个**配置模型 + 目录规范 + 初始化 Wizard + TUI 编辑器 + Doctor** 做扎实。
