---
title: 项目技术栈与开发规范
created: "2026-06-03"
tags:
  - guide
  - config
  - work
  - standard
summary: 本文定义项目技术栈选型、z-index层级规范及响应式布局要求
cover: /assets/default-cover.jpg
updated: "2026-07-20"
---

## 技术栈规范

| 类别       | 技术选型                      | 说明                                                                                 |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| 前端框架   | Vue 3 + JavaScript            | 不使用 TypeScript                                                                    |
| 构建工具   | Vite + pnpm                   | 包管理统一使用 pnpm                                                                  |
| UI 框架    | daisyUI                       | 已经写了 src/style.css                                                               |
| 图标方案   | UnoCSS Icons（Carbon 图标集） | 使用 `@unocss/preset-icons` + `@iconify-json/carbon`，统一通过 `i-carbon-*` 类名引用 |
| 状态管理   | Pinia                         | 全局状态集中管理                                                                     |
| 代码规范   | eslint + @antfu/eslint-config | 统一代码风格                                                                         |
| 工具库     | xe-utils                      | 对象、函数、数组、数字、字符串、URL、Web、计算、判空、数据处理统一使用               |
| 日期处理   | dayjs                         | 所有日期相关操作统一使用                                                             |
| Hooks 工具 | vue-hooks-plus                | 复用 Vue 组合式交互逻辑、异步状态、DOM 事件、虚拟列表等 hooks                        |

## 层级规范

| 层级 | 语义           | 使用场景                                   |
| --- | -------------- | ------------------------------------------ |
|    0 | base           | 普通页面内容                               |
|   10 | raised         | 卡片 hover、轻微浮起元素                   |
|  100 | sticky         | sticky 表头、吸顶筛选栏                    |
|  200 | local-floating | 页面局部浮动按钮、局部工具栏               |
|  300 | fixed-nav      | 顶部导航、移动端底部导航                   |
|  400 | dropdown       | Dropdown、Select、DatePicker、Autocomplete |
|  500 | popover        | Popover、Tooltip、HoverCard                |
|  800 | overlay-local  | 页面局部遮罩、局部 loading                 |
| 1000 | overlay        | 全局遮罩                                   |
| 1100 | drawer         | Drawer、侧边抽屉                           |
| 1200 | modal          | Modal、Dialog                              |
| 1300 | modal-floating | Modal 内部 Dropdown、Popover、Tooltip      |
| 1400 | toast          | Toast、全局通知                            |
| 1500 | global-loading | 全屏 Loading、页面阻断加载                 |
| 2000 | onboarding     | 新手引导、产品引导遮罩                     |
| 3000 | system         | 系统级弹窗、强制升级、维护提示             |
| 9000 | emergency      | 特殊兜底层，必须注释说明                   |
| 9999 | max            | 最高优先级，仅限极特殊场景                 |

- 多数场景使用 Tailwind `z-{number}` 直接对应（`z-100`、`z-300`、`z-400`、`z-500`、`z-1200`、`z-1300`）。
- 1000 之后是 4 位数，Tailwind 默认不提供，使用 `z-[1000]` / `z-[1300]` 等任意值语法。
- 0 ~ 500 用 `z-` 原生档位；不随意使用 `z-[9999]`。

## Scroll 滚动规范

| 类别         | 规范                          | 说明                                                              |
| ------------ | ----------------------------- | ----------------------------------------------------------------- |
| 滚动容器     | 单一主滚动区域                | 应用层只允许一个主滚动容器，禁止 body、main、组件多层嵌套滚动     |
| 页面滚动     | Router 统一管理               | 禁止组件内部直接调用 window.scrollTo，统一通过路由滚动策略处理    |
| 滚动恢复     | 支持页面级 scroll restoration | 列表页返回时恢复原滚动位置，普通页面进入默认滚动到顶部            |
| 滚动区域     | 明确 scroll-root              | Layout 层定义主滚动容器，业务组件不得随意创建页面滚动区域         |
| 局部滚动     | scroll-section                | 大列表、日志、代码区域等允许局部滚动，但必须明确高度和边界        |
| 弹窗滚动     | Modal / Drawer 独立滚动       | 弹窗内部内容滚动，不影响 body 滚动状态                            |
| Body 锁定    | Overlay 打开时禁止背景滚动    | Modal、Drawer、全屏遮罩打开时锁定 body，关闭后恢复                |
| Sticky       | 必须绑定正确滚动容器          | sticky 元素必须位于对应 scroll container 内，避免定位失效         |
| 表格滚动     | Table 统一处理                | 表格内部横向滚动，禁止页面整体横向滚动                            |
| 表格固定     | 使用组件能力                  | Table 固定表头、固定列必须使用组件配置，不手写定位实现            |
| 大数据列表   | 必须虚拟滚动                  | 超过指定数据量的大列表必须使用虚拟列表优化性能                    |
| 滚动事件     | Hook 统一封装                 | 禁止页面散落 addEventListener，统一通过 useScroll 等 hooks 管理   |
| 滚动监听     | 必须节流优化                  | scroll 事件必须使用 throttle / requestAnimationFrame 降低性能消耗 |
| 滚动动画     | 局部启用 smooth               | 仅允许锚点跳转、返回顶部使用 smooth，禁止全局开启                 |
| 减少动画     | 支持 prefers-reduced-motion   | 用户开启减少动画模式时关闭滚动动画效果                            |
| 锚点定位     | 统一 scrollToAnchor           | 禁止业务组件直接调用 scrollIntoView，统一封装滚动方法             |
| Sticky 偏移  | 使用 scroll-margin-top        | 页面存在固定导航时，锚点定位必须考虑顶部遮挡问题                  |
| 返回顶部     | local-floating 层级           | 返回顶部按钮使用 z-200，超过滚动阈值后显示                        |
| 横向滚动     | 禁止页面级横向滚动            | 页面禁止 overflow-x 滚动，特殊区域必须局部控制                    |
| 移动端滚动   | 适配 Touch 滚动               | 支持 iOS / Android 惯性滚动，避免滚动卡顿                         |
| 滚动高度稳定 | 避免 CLS                      | Skeleton、图片、异步内容必须保持高度稳定，避免滚动位置跳动        |
| 数据刷新     | 保留滚动上下文                | 刷新数据时保持当前滚动位置，不因重新渲染导致页面跳顶部            |
| 请求失败     | 保持用户上下文                | 请求失败进入错误态时保持当前滚动位置和已有数据                    |
| 图片加载     | 预留尺寸                      | 图片必须设置宽高或 aspect-ratio，避免加载造成页面跳动             |
| 虚拟列表     | 统一封装                      | 虚拟滚动能力通过 hooks / 组件提供，禁止业务重复实现               |
| 滚动状态     | 禁止随意持久化                | 不允许直接 localStorage 保存 scrollTop，统一由滚动管理器维护      |
| 滚动性能     | 监控长任务                    | 大量滚动计算必须避免阻塞主线程，必要时接入 Performance 监控       |
| 无障碍       | 支持键盘滚动                  | 页面滚动区域必须保持键盘访问能力和 focus 可见性                   |
| 滚动恢复清理 | 路由离开自动处理              | 页面卸载时清理滚动监听、缓存状态、事件绑定                        |

## 布局

固定视口应用壳 + 局部滚动

## 响应式要求

- 支持移动端。
- 支持平板端。
- 页面必须使用响应式布局。

## API 层标准化

| 类别         | 规范                   | 说明                                     |
| ------------ | ---------------------- | ---------------------------------------- |
| 请求封装     | Axios 二次封装         | 统一 baseURL、timeout、headers、错误处理 |
| API 结构     | 按模块拆分             | `api/modules/*.api.js`，禁止写在组件内   |
| 请求拦截     | Token + Error 统一处理 | 自动注入 token、统一处理 401/500         |
| 响应结构     | 标准化返回             | `{ code, data, message }` 统一格式       |
| 错误处理     | 全局错误中心           | Toast + 日志 + 可选上报                  |
| 取消请求     | AbortController        | 页面切换自动取消未完成请求               |
| 并发控制     | 防重复请求             | 相同 key 请求去重                        |
| Loading 管理 | 请求级 + 页面级        | 避免手动控制 loading 状态                |

---

## Skeleton / Loading 规范

| 场景       | 优先方案                     | 说明                                             |
| ---------- | ---------------------------- | ------------------------------------------------ |
| 首屏加载   | 页面骨架屏                   | 模拟真实页面结构，避免白屏和布局跳动             |
| 模块加载   | 局部骨架屏                   | 卡片、列表、表格、详情区按实际内容占位           |
| 数据刷新   | 保留旧数据 + 局部 Loading    | 不清空页面，避免用户失去上下文                   |
| 表单提交   | 按钮 Loading + 禁用提交按钮  | 防重复提交，提交中保留表单内容                   |
| 表格加载   | VXE Table loading / 表格骨架 | 表头固定，行高稳定，禁止整页遮罩替代表格加载     |
| 路由切换   | 页面级 Loading               | 只在跨页面等待明显时使用，优先展示目标页骨架     |
| 阻断型任务 | 全局 Loading                 | 仅限鉴权初始化、应用启动、强制等待等不可交互场景 |

- 骨架屏必须贴近真实布局：标题、头像、卡片、表格行、按钮区域要按最终尺寸占位，禁止使用一整块灰色矩形糊弄。
- 骨架屏风格必须匹配 Animal Island：圆角、柔和底色、轻微点状或软边框质感；禁止使用生硬的 Tailwind 默认灰阶风格。
- 骨架元素必须有稳定宽高、`min-height` 或固定行高，加载完成前后不能造成明显 CLS。
- 首次进入页面优先使用骨架屏；只有小面积异步操作、按钮提交、短时请求才使用 spinner / loading icon。
- 局部 Loading 使用层级 `z-800`；全屏 Loading 使用 `z-[1500]`，不得随意使用 `z-[9999]`。
- 加载超过 3 秒必须展示明确状态文案；超过 8 秒必须提供重试、取消或返回入口。
- 请求失败后必须进入错误态，数据为空必须进入空态，不能让 loading 无限停留。
- 页面级异步状态应由 composable、Pinia 或 API SDK 统一管理；禁止在多个组件里散落重复的 `isLoading` 和手写请求状态。
- 对刷新类请求，应优先保留已有数据并展示局部刷新状态；只有首次无数据时才用完整骨架屏。
- 动效必须克制，遵守 `prefers-reduced-motion`；骨架 shimmer 不得过亮、过快或大面积闪烁。
- Loading 文案使用业务语义，如“正在生成配置”“正在同步状态”；禁止只有“Loading...”且无上下文。

## 测试体系规范

| 类别      | 工具                       | 说明                               |
| --------- | -------------------------- | ---------------------------------- |
| 单元测试  | Vitest                     | 逻辑函数、工具库必须覆盖           |
| 组件测试  | Vue Test Utils             | 关键 UI 组件行为测试               |
| E2E 测试  | Playwright                 | 核心业务流程（登录/下单/操作链路） |
| Mock 数据 | MSW / Vitest mock          | API 层隔离测试                     |
| 覆盖率    | Vitest coverage            | 核心模块 ≥ 80%                     |
| 测试范围  | 分级测试                   | utils > service > component > flow |
| CI 集成   | GitHub Actions / GitLab CI | 每次 PR 必跑测试                   |
| 回归策略  | 关键路径回归               | 核心业务必须 e2e 覆盖              |

---

## 规范约束体系

| 类别        | 规范                          | 说明                                                |
| ----------- | ----------------------------- | --------------------------------------------------- |
| 代码风格    | eslint + @antfu/eslint-config | 全项目统一风格                                      |
| 组件规范    | 三层结构                      | Base / Layout / Business                            |
| 命名规范    | 语义化命名                    | 禁止 a/b/c、data1 这种变量                          |
| 引用规范    | 禁止跨 feature 引用           | feature 之间不能直接依赖                            |
| import 顺序 | 规范化排序                    | 外部库 → 内部模块 → 相对路径                        |
| 目录约束    | feature-first                 | 按业务模块组织代码                                  |
| JSDoc       | JS 类型与接口契约             | 所有 `.js`、`.vue` 文件中的变量与方法必须编写 JSDoc |

### UnoCSS 图标规范

- 图标统一使用 UnoCSS `presetIcons`，图标数据源统一为 `@iconify-json/carbon`；禁止再引入图标组件库、复制 SVG 源码或使用其他图标集。
- 图标类名使用静态、完整的 `i-carbon-*` 形式，例如 `i-carbon-home`、`i-carbon-settings`；禁止运行时拼接类名，确需动态映射时必须使用显式映射表或 UnoCSS `safelist`。
- 图标默认通过 `currentColor` 继承文本颜色，尺寸使用原子类统一控制；禁止在业务组件中写行内 `style` 调整颜色和尺寸。
- 纯装饰图标必须设置 `aria-hidden="true"`；仅由图标构成的交互控件必须提供 `aria-label` 或等价的可访问名称。
- 同一业务语义必须使用同一 Carbon 图标，通用图标映射应集中维护，禁止各页面自行选择近似图标。

### JSDoc 强制规范

- 所有 `.js` 文件及 `.vue` 文件的 `<script>` / `<script setup>` 中，每个变量、常量、函数和方法声明都必须在声明前编写 JSDoc；包括 `const`、`let`、普通函数、箭头函数、组件方法、回调、composable、`ref`、`reactive`、`computed` 和 Pinia action。
- 变量必须使用 `@type` 标明类型；对象、数组、联合类型及可空类型必须写出完整类型，禁止使用无约束的 `Object`、`Array` 或 `*` 代替可明确的结构。
- 函数和方法必须说明职责，并完整声明 `@param` 与 `@returns`；无返回值时使用 `@returns {void}`，异步函数使用 `@returns {Promise<T>}`。可能抛出异常时补充 `@throws`。
- 复用的数据结构使用 `@typedef` 定义；跨文件共享的类型集中放置，禁止在多个文件复制同一结构定义。
- Vue `props`、`emits`、模板引用及事件处理方法必须描述业务语义；事件回调应写明事件参数类型与副作用。
- JSDoc 必须描述类型、约束和业务意图，禁止只重复变量名或函数名；代码行为变化时必须同步更新注释。
- ESLint 必须启用 JSDoc 校验，至少检查声明覆盖、标签合法性、参数名、返回值及类型语法，CI 中不得跳过。

---

## 性能 & 监控兜底

| 类别     | 方案                 | 说明                         |
| -------- | -------------------- | ---------------------------- |
| 路由优化 | Vue Router lazy load | 页面级懒加载                 |
| 代码拆分 | Vite manualChunks    | vendor / core / feature 分包 |
| 静态资源 | 图片懒加载           | IntersectionObserver         |
| 列表优化 | 虚拟列表             | 大数据列表必须使用           |
| 缓存策略 | HTTP + localStorage  | 关键数据缓存                 |
| 错误监控 | Sentry / 自建日志    | JS 错误 + API 错误上报       |
| 性能监控 | Web Vitals           | LCP / FID / CLS 监控         |
| 请求监控 | API 耗时统计         | slow request 记录            |
| 白屏兜底 | loading + fallback   | 首屏异常兜底页面             |
| 全局异常 | errorHandler         | Vue + Promise 统一捕获       |
| 资源压缩 | gzip / brotli        | Vite compression 插件        |
| 降级策略 | feature flag         | 异常时关闭非核心功能         |

---

## 目录结构规范（Feature First）

| 层级   | 目录             | 说明                                        |
| ------ | ---------------- | ------------------------------------------- |
| 核心层 | `src/core`       | 项目级能力（request、router、store 初始化） |
| 通用层 | `src/shared`     | 纯工具 / 通用组件 / hooks                   |
| 业务层 | `src/features`   | 按业务模块拆分（核心规范）                  |
| UI层   | `src/components` | 全局通用组件                                |
| 布局层 | `src/layouts`    | 页面布局结构                                |
| 页面层 | `src/pages`      | 路由入口页面                                |
| API层  | `src/api`        | API SDK（模块化）                           |
| 状态层 | `src/stores`     | Pinia store                                 |
| 资源层 | `src/assets`     | 图片 / 样式 / 字体                          |
| 配置层 | `src/config`     | 环境配置、常量                              |

---

## ENV 文件规范

| 类别     | 规范                | 说明                                                       |
| -------- | ------------------- | ---------------------------------------------------------- |
| 环境文件 | `.env` 分层管理     | `.env / .env.development / .env.staging / .env.production` |
| 变量前缀 | `VITE_` 必须前缀    | Vite 仅暴露 `VITE_` 开头变量                               |
| 命名规范 | 大写 + 下划线       | 如 `VITE_API_BASE_URL`                                     |
| 使用方式 | 统一 env 封装访问   | 禁止直接使用 `import.meta.env`                             |
| 环境区分 | mode 控制           | `vite --mode staging`                                      |
| mock控制 | env 控制 mock 开关  | `VITE_MOCK=true/false`                                     |
| API绑定  | baseURL 由 env 控制 | 不允许写死 API 地址                                        |

| 类别   | 规范                 | 说明                |
| ------ | -------------------- | ------------------- |
| API层  | request 统一读取 env | baseURL 从 env 注入 |
| 配置层 | `src/config/env.js`  | 统一封装 env 读取   |
| 业务层 | 禁止直接读取 env     | 必须通过 config 层  |
