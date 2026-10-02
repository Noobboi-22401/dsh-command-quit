# dsh-command-quit

[English](README_en.md) | [简体中文](README.md)

**插件名**：`dsh-command-quit`

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）桌面客户端加一条斜杠指令，用来关闭客户端。**命令名可以自己改**，默认是 `/quit-dsh`。

**声明**：**本插件编写过程均由Deepseek V4.1 Flash完成（包括这个Readme文件本身），上传者只进行了基本功能测试，未逐行复查代码**，可能存在未知的bug。

**与官方的关系**：本插件**不是 DeepSeek 官方插件**，与 DeepSeek 官方**没有任何关系**。插件里的"配置菜单"只是**借用了 DSH 自带的插件设置入口**来存一个自己的配置项，界面控件和官方插件共用，仅此而已。

## 功能

在 DSH 对话框中输入 `/quit-dsh` 并回车，**关闭 DeepSeek Harness 桌面客户端**。

它走应用原生的退出流程：如果此时还有任务在跑，会弹出确认框，而不是直接杀掉进程。

## 使用

在输入框里输入 `/q`，下方会出现 `/quit-dsh` 候选。**按 `Tab` 键后，候选会补全并立即执行，客户端随即关闭**——当前版本里补全与执行是一步完成的。

如果输入命令时，还有任务在跑，会先弹出确认框。

也可以在命令面板里选择 `quit-dsh`。命令描述为「关闭 DeepSeek Harness 客户端（退出程序）」。

**运行时不消耗 Token**：命令完全在本地处理，只是通过 IPC 让应用外壳退出，不会发起任何模型调用，不计入 token 用量。

## 改命令名（配置菜单）

在 DSH 界面左侧栏打开**插件**页面（"插件"面板），在**官方**分组里找到**退出命令**，点开它就能改命令名。

> **免责声明**：本插件（`dsh-command-quit`）**不是 DeepSeek 官方插件**，与 DeepSeek 官方**没有关系**。上面那个配置面板是 **DSH 自带的插件设置入口**，被本插件借用来存放自己的一个配置项（就是命令名）。因为插件配置页必须由插件自带，而界面上的设置控件是 DSH 提供的公共控件，所以它和官方插件的设置页长得一样、也排在同一个分组里——但这**不代表**它是官方功能。

- **四个预设**：`/quit`、`/quit-dsh`、`/quitdsh`、`/qd`。点一下就直接填进输入框。
- **自定义**：在「命令名」输入框里直接打字，填 `/` 后面那一段（例如 `bye`）。
- **同一时刻只生效一个**：只有你保存的那个命令名能用，其他名字输入了也没有反应。
- **保存后立刻生效**，不需要重启客户端；旧名字同时失效。
- **保存前的两道检查**（不通过就拒绝保存，输入框会变红、保存按钮点不动）：
  1. **格式**：必须以小写英文字母开头，只能包含小写字母、数字、下划线 `_` 或连字符 `-`。大写、中文、空格、数字开头、空值都不行。这一条由配置声明的规则直接拒绝，连写盘都不会发生。
  2. **撞名**：不能和 DSH 内置命令、其他插件已注册的命令重名。这里有个容易踩的坑：DSH 的命令分两层存放——一部分（比如 `compact`、`goal`、`plan`）登记在**每个会话/预设各自的作用域**里，另一部分（比如 `export`、`feedback`、`permission`）才是全局的。如果只看全局层，像 `compact` 这种名字会被当成"没人用"，结果你的退出命令虽然登记成功了，却**被同名的内置命令遮住**，输入它根本不会退出（这正是"改成 compact 之后退出效果消失"的原因）。现在检查会遍历注册表里**所有已知作用域**，任一层被占用就**拒绝保存**：面板出现红字说明，输入框保留你的内容，配置文件不会被改写，当前正在用的命令继续可用。

  万一你之前已经把一个撞名保存进去了（例如 `compact`），插件启动时发现这个已保存的名字不可用，会**自动退回默认命令名 `/quit-dsh`**，并在日志里写明。
- **名字事后被抢走，也会当场告诉你**：还有一种保存时查不出来的情况——另一个插件只在**某个会话跑起来之后**才登记同名命令，而你保存时那个会话还不存在。插件会监听 DSH 的「命令表发生变化」通知，每次变化后重新确认"这个名字现在还归我吗"：一旦发现被别的命令盖住，就**自动改回默认命令名 `/quit-dsh`**，并且在界面上明确告诉你：
  - **插件配置页**（插件 → 官方 → 退出命令）里出现一段红字，写明"你配置的命令名 `/xxx` 已被其他命令占用（占用者）"，并接着说明插件已自动改用 `/quit-dsh`、输入它即可退出。
  - **应用界面底部弹出一条横幅**，不用打开设置页也能看到，可以点 `×` 关掉。关掉只关这一条；换个名字再撞、或重启后仍是同一个冲突，会再弹一次。
  - 如果连默认名也被占用（极端情况），提示会改成"退出命令暂时无法使用"，并请你去配置页另选一个名字。

> 配置由 DSH 自己保管，写进当前 profile 的 `cordis.patch.yml`，插件目录下**不会**产生独立的配置文件。上面那条冲突提醒会作为一个 `notice` 字段写进同一个配置项里（只在这个冲突真的发生过时才出现，平时是空的），你在配置页里换回一个可用的名字后它会被自动清掉。


## 安装

### 方式一：从 GitHub 安装

```
install_bundle  github:Noobboi-22401/dsh-command-quit
```

`github:用户名/仓库名` 是 `install_bundle` 支持的标准写法，推荐用它。

### 方式二：本地路径安装

先把仓库克隆下来：

```powershell
git clone https://github.com/Noobboi-22401/dsh-command-quit.git
```

然后：

```
install_bundle  link:<克隆到的绝对路径>/dsh-command-quit
```

安装由 DSH 自带的 `plugin_manager` 完成，它会自动执行 `pnpm add`、把 `dsh-command-quit` 写进 profile 的 `dsh.profile.bundles`、建立符号链接并更新 lockfile。

### 生效方式

**装完插件还不算完，还要给客户端外壳打一次补丁，然后重启客户端。**

用户自己的 `app.asar`（客户端安装文件）里没有「Host → 外壳」的退出通道，所以插件还需要一处小的补丁，见下一节《为什么还需要桌面外壳补丁》。补丁脚本对同一个版本只会生效一次，重复运行不会出问题。

补丁有两种做法，选一种：

- **不想用命令行**：双击 `fix-quit.cmd`。它会先检查客户端是否已经关闭，再自动修好并打印中文结论。
- **用命令行**：

  ```powershell
  node tools\patch-asar.mjs --apply
  ```

**然后重启一次桌面客户端。** profile 的 bundle 列表在启动时读取，外壳补丁也在 Electron 主进程启动时加载。重启后默认的 `/quit-dsh` 即可用（命令名随时可在插件配置页里改，改完立即生效，不用再重启）。

## 为什么还需要桌面外壳补丁

指令的 handler 跑在 Host 子进程里，而 Host 是 Electron 外壳用 IPC 拉起来的子进程。部分 DSH 版本只有「外壳 → Host」的控制消息（`shutdown` / `quit-inspection` / `update-tasks`），没有「Host → 外壳」的退出通道，也没有暴露给插件的 quit API；点窗口的 X 只会 `hide()` 到托盘，不等于退出。

所以本插件附带一处最小的 `app.asar` 补丁，做三件事：

1. `isDesktopHostEvent()` 放行新消息 `{ type: "quit-request" }`；
2. Host 消息处理器里加一个分支 → `app.quit()`（复用原生退出流程与确认弹窗）；
3. 给 Host 子进程注入 `DSH_DESKTOP_QUIT_REQUEST=1`，让插件能判断外壳到底支不支持这条通道。

第 3 条是安全阀：一旦补丁丢失（例如客户端升级覆盖了 `app.asar`），插件因为读不到这个环境变量会返回一条明确的错误提示，**不会**把未知消息发给外壳（那会让外壳判定协议错误并杀掉 Host）。

补丁是**等长原地写入**：`lib/main.js` 的字节数不变，asar 头部与其他文件偏移完全不变，因此没有重新打包 asar 的风险。脚本内部还会跑一次「可逆性证明」——把刚才写入的四处在内存里逐一还原，必须得到与原文一字不差的字节，否则拒绝写入。这套机制保证了：

- **要么完整打好，要么完全不动。** 脚本会先核对四处改动是「全在」还是「全不在」；只打了一半的档案会被拒绝处理并提示你先还原，绝不会把半成品当成「已经修好」。
- **写入前后都有校验。** 写入前，备份会先复制到临时文件、逐字节比对确认无误、落盘后再改名；写入后会把内容读回来比对，确认四处改动确实都在。任何一步没通过都会明确报错，并告诉你怎么还原。
- **万一真的写坏了，也有干净备份可还原。** 极端情况（例如写入过程中断电）仍可能留下不完整的档案，脚本会检测并拒绝在此基础上继续；此时用 `node tools\unpatch-asar.mjs --apply` 从备份还原即可。还原前脚本还会先确认备份本身完整、且确实没有带着补丁。

```powershell
# 先看补丁会做什么（不改文件）
node tools\patch-asar.mjs

# 应用补丁
node tools\patch-asar.mjs --apply

# 行为采样：去掉 quit-request 后，其余抽样消息的判定与原版一致
node tools\verify-shell.mjs
```

给非技术使用者的方式：双击 `fix-quit.cmd`。它会先确认客户端已经关闭（客户端运行时改不了它的文件），再自动跑完并打印中文结论。启动器会先找系统安装的 Node.js，找不到就自动改用 DeepSeek Harness 自带的 Node，两者都没有才会提示你去安装。

## 客户端升级后

升级会替换 `app.asar`，外壳补丁随之丢失。此时插件本身不受影响，命令会返回一条明确的错误提示而不是崩溃或静默失败。

重新打补丁即可（幂等，已打过会直接跳过）：

```powershell
node tools\patch-asar.mjs --apply
```

## 卸载

1. 还原外壳（先关闭客户端）：
   ```powershell
   node tools\unpatch-asar.mjs --apply
   ```
   它会先确认备份完好、确实没有带着补丁，还原后还会把内容读回来核对。备份文件缺失或明显不完整时会拒绝执行，而不是冒险写入。
2. 移除插件（用应用内 plugin_manager，等价于界面里点卸载）：
   ```
   remove_bundle  dsh-command-quit
   ```
3. 重启客户端。

## 路径配置

`tools/` 下的脚本**不含任何硬编码的绝对路径**。它们按以下顺序定位安装位置：

| 环境变量 | 作用 |
|---|---|
| `DSH_APP_ASAR` | 桌面客户端的 `resources\app.asar` 绝对路径 |
| `DSH_DESKTOP_EXE` | 桌面客户端可执行文件绝对路径 |
| `DSH_DESKTOP_RESOURCES` | 安装目录下的 `resources` 目录 |
| `DSH_PROFILE_DIR` | DSH profile 目录 |
| `DSH_HOME` | DSH home 目录（默认 `~/.dsh`） |

如果没有设置，脚本会在常见的安装位置（`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources` 等）里自动查找；找不到时会报一条明确的错误，告诉你要设置哪个变量。

**注意：显式设置的变量优先级最高，而且必须真实存在。** 如果 `DSH_APP_ASAR` 指到了一个不存在的位置，脚本会**直接报错停止**，而不是悄悄改用自动找到的另一个安装——避免改错客户端。同理，脚本在自动寻找桌面主程序时，不会把安装目录里的卸载程序（如 `Uninstall DeepSeek Harness.exe`）误当成客户端。

例如安装位置比较特殊时：

```powershell
$env:DSH_APP_ASAR = '<你的安装目录>\DeepSeek Harness\resources\app.asar'
node tools\patch-asar.mjs --apply
```

## 目录结构

```
dsh-command-quit/
├── package.json            # npm 包清单（含 dsh.bundle.patch 与 dsh.client 声明）
├── cordis.patch.yml        # bundle 挂载声明：insert command-quit
├── .gitignore              # 忽略 node_modules、补丁备份等
├── lib/
│   ├── index.js            # 插件本体（Host 半侧）：注册指令、命令名校验、保存拦截与运行时复查
│   └── client.js           # 浏览器半侧：插件配置页（预设 / 自定义 / 保存）+ 冲突提醒（页内红字与底部横幅）
├── tools/
│   ├── dsh-paths.mjs       # 共享的路径解析（环境变量 / 常见安装位置）
│   ├── patch-asar.mjs      # 给 app.asar 打等长外壳补丁
│   ├── unpatch-asar.mjs    # 从备份还原外壳
│   ├── verify-shell.mjs    # 外壳补丁的行为采样测试
│   ├── profile-check.mjs   # 校验 profile 是否正确组合了本插件
│   ├── test-command.mjs    # 指令的 IPC 端到端测试 + 命令名配置测试（Host 半侧）
│   ├── test-client.mjs     # 配置页（浏览器半侧）的结构测试
│   └── fix-desktop-quit.mjs # 一键修复的中文提示层
├── fix-quit.cmd            # Windows 双击入口（自动定位 Node：系统优先，其次 DSH 自带）
├── README.md
├── README_en.md
└── LICENSE
```

`.gitignore` 是给仓库用的，不会打进 npm 包里。

## 兼容性

- **平台**：桌面外壳补丁针对 **Windows** 版 DeepSeek Harness 打包格式编写（`resources\app.asar`，`.exe` 入口）。插件本体（`lib/index.js`）本身是跨平台的，但它依赖外壳提供 `DSH_DESKTOP_QUIT_REQUEST` 通道。
- **macOS / Linux 未经验证**：本插件只在一台 Windows 机器上、对着 Windows 版 DeepSeek Harness 开发和测试过。作者**不清楚本插件是否兼容 macOS 或 Linux**，也没有在那些系统上做过任何验证。插件本体（`lib/`）不含平台相关代码，理论上不排斥其它系统，但桌面外壳补丁与双击入口（见上一条与下方说明）只针对 Windows 编写。请在其它系统上自行评估与测试，不要假定它一定能用。
- **DSH 版本**：在 `0.2.0-rc.2` 一类的桌面构建上验证。`patch-asar.mjs` 依赖 `lib/main.js` 中若干锚点字符串；DSH 版本变化导致锚点消失时，脚本会直接报 `anchor not found` 并**拒绝写入**，不会写出半个坏补丁。档案结构不符（不是 asar、被截断、找不到 `lib/main.js`）也会得到同样的明确报错，而不是一串英文堆栈。
- **配置菜单**：命令名配置走 DSH 自带的插件配置页（Host 半侧声明 `Config` + 浏览器半侧 `lib/client.js` 注册配置页）。要求 DSH 组合里带有 `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-plugin-manager` 与 `@deepseek-ai/dsh-client-ui-primitives`（配置卡片所用公共界面控件的来源），以及 `react`（DSH 前端自带）——这四者由 DSH 主程序提供，官方桌面构建默认都有，不需要单独安装，`package.json` 里已把它们标注为可选的 peer 依赖（`peerDependenciesMeta.optional`）。缺少浏览器半侧时，插件本体仍能加载，但界面上不会出现配置页。这个入口是 **DSH 提供的公共机制**，本插件只是使用方，配置面板底部也写明了"非官方"的说明。再次提醒：**本插件与Deepseek官方无任何关系。**
- **保存拦截**：撞名拦截依赖 DSH 在写入 profile patch 之前派发 `internal/config` 钩子（`dsh-config-editor` 的保存路径）。本插件同时按“自己的 fiber”和“自己的 profile 条目 id”两种方式识别该次保存，任一命中即生效；检查范围是**全局层 + 注册表里每个已知的会话/预设作用域**（DSH 的 `/compact`、`/goal`、`/plan` 就藏在作用域层，只看全局层会漏掉）。若某个 DSH 版本不暴露作用域（此时只剩全局层检查），已保存的名字在启动时若不可用，仍会自动退回默认名 `/quit-dsh`，退出指令不会失效。
- **被抢名字后的兜底与提醒**：插件同时监听 DSH 的 `commands/change` 事件（注册表每次增删命令都会派发一次，这个事件也会转发到浏览器）。每次变化后重新确认"当前注册的名字在各作用域里是否还归自己"——自己靠登记时写下的固定身份标识（`definitionId`，DSH 命令注册表的公开字段，与显示文字无关）辨认；只有当运行环境的注册表不返回这个字段时，才退回比对命令说明文字（并做首尾空白归一化）。所以自己的全局注册不会被误判成冲突，命令说明文字被 DSH 改写也不影响判断。一旦被别人盖住就自动改回默认名，并把原因写进插件自己的配置项（`notice` 字段）。浏览器半侧通过 DSH 转发的 `settings/document-updated` 事件读到它，在配置页渲染红字，并注册一个 `shell.overlay` 条目在界面底部弹横幅。若某个 DSH 版本不转发该事件、或没有 `shell.overlay` 槽位，最坏情况只是提醒显示不出来，**命令本身的自动退回不受影响**。
- **浏览器半侧的容错**：底部横幅所在的 `shell.overlay` 正是**设置弹窗所在的那一层**，所以那个组件一旦在渲染时报错，会连带把设置页一起弄没。为此做了三重隔离：设置页**先注册**、横幅**最后注册**且各自独立容错；横幅自己保管状态，不依赖"槽位注入"给组件传数据；两个组件都不会抛错——渲染失败会降级成页面上的一行提示，并把失败内容记进浏览器 `localStorage` 的 `dsh-command-quit:diag` 键，排查时可以直接读它。
- **配置页读取状态的约定**：DSH 用 React 的 `useSyncExternalStore` 把“槽位注入”里的数据源变成组件属性，这条通道要求 `getSnapshot()` **在数据没变时必须返回同一个对象**。两次读取只要引用不同，React 就会不断重渲染，最终把插件页连同设置页一起拖垮，表现是**配置菜单打不开或一片空白，而且页面上没有任何报错**。本插件的卡片因此把表单自己的绑定（`SettingsFormModel.bind`，与官方设置页同一做法）当作数据源，外面再包一层结构比较缓存，两重保证读取结果稳定；`tools/test-client.mjs` 里有专门的回归检查盯着这一点。
- **Node.js**：`>=18`（构建产物使用 ESM、顶层 await 与 `node:` 前缀导入）。双击入口 `fix-quit.cmd` 会先找系统 `PATH` 上的 `node.exe`（并实际运行一次确认可用），找不到时自动改用 DeepSeek Harness 自带的 Node（按 `DSH_HOME`、`DSH_APP_ASAR` 和常见安装位置查找），因此**没单独安装 Node.js 的机器也能直接双击使用**。
- **Host 形态**：只有在带退出通道的桌面客户端里指令才能真正退出。在纯 Web / 服务端 Host 中执行会返回明确的错误提示，不会静默失败。

## 注意事项

- 打补丁会**修改 DeepSeek Harness 的安装文件**（`app.asar`）。脚本会在首次打补丁前生成 `app.asar.quit-patch-backup` 备份（备份写好并校验通过之后才会改动原文件）；卸载请用 `unpatch-asar.mjs --apply`，不要手工删文件。
- **打补丁和还原前请先关闭客户端。** 客户端运行时占着 `app.asar`，脚本无法安全写入；`fix-quit.cmd` 会自己检查并提示你先退出。
- 补丁在客户端每次升级后都会丢失，需要重打一次（幂等，可重复执行）。
- **本插件不是 DeepSeek 官方插件。** 它调用的是 DSH 自带的插件配置入口与插件注册服务，插件本身与 DeepSeek 官方无关。修改客户端安装文件的后果请自行评估；如客户端提供了官方退出 API，建议优先使用官方方式。
- **命令名冲突是"保存时"拦截的。** 检查发生在配置写盘之前：撞名则保存直接被拒绝，面板显示红字，配置不落盘、命令不切换。想验证的话，试一个 DSH 自带的名字（如 `compact`），撞名会在保存那一刻被直接拒绝。
- **保存时查不出的那种撞名，会在运行中兜底并告诉你。** 如果另一个插件只在某个会话跑起来之后才登记同名命令，保存那一刻它还看不见；插件会在命令表变化时重新复查，被盖住就自动改回 `/quit-dsh`，并在**配置页红字**和**界面底部横幅**上写明原因。这条提醒要经过 DSH 的设置推送才会显示，因此**重启客户端后**如果冲突仍在，会重新出现。
- 已知遗留：对**已存在**的本地路径依赖再执行一次 `install_bundle`，`plugin_manager` 可能返回 `ambiguous-install`（它的兜底匹配不认 `link:<路径>`）。这是 `plugin_manager` 的匹配行为，不是本插件的问题；首次安装不受影响，遇到时先 `remove_bundle` 再重新 `install_bundle` 即可。
- 与 DSH 的互操作性说明：工具脚本逐字引用了少量来自 DeepSeek Harness 自身 `app.asar` 的字符串——`tools\patch-asar.mjs` 里若干锚点代码行与一段注释，`tools\verify-shell.mjs` 里一个函数签名。它们仅用于精确改写与校验，不参与任何其他用途。DeepSeek Harness 采用 MIT 许可（<https://github.com/deepseek-ai/deepseek-harness>），上述原文的版权归其原作者所有。

## License

[MIT](LICENSE)
