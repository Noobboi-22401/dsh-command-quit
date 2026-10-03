# dsh-command-quit

[English](README_en.md) | [简体中文](README.md)

**Plugin name**: `dsh-command-quit`

Adds two ways to close the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) desktop client: the slash command `/quit-dsh` in the conversation box, and **`quit-dsh` in any terminal window**. **Both names are configurable**, and the terminal command can be set to ask before it quits.

**Disclosure**: **This plugin was written entirely by DeepSeek V4.1 Flash (including this README file itself). The uploader only ran basic functional tests and did not review the code line by line**, so unknown bugs may exist.

**Relationship to the official product**: This plugin **is not an official DeepSeek plugin** and has **no relationship whatsoever** with DeepSeek. The "configuration menu" inside the plugin merely **borrows DSH's own plugin-settings entry point** to store one configuration value of its own; the interface controls are shared with official plugins, and that is all.

## Features

**1. Composer command**: type `/quit-dsh` in the DSH conversation box and press Enter to **close the DeepSeek Harness desktop client**.

**2. Terminal command**: type `quit-dsh` in any terminal window (PowerShell, cmd, Windows Terminal or Git Bash) and press Enter to close the client too — by default after one question, "确认退出吗 [y/N]", which only `y` answers.

Both go through the **same native quit flow**: if a task is still running at that moment, a confirmation dialog appears instead of the process being killed outright. **Nothing is force-killed and nothing is lost.**

## Usage

Type `/q` in the input box and `/quit-dsh` appears as a candidate below. **Press `Tab` and the candidate is completed and executed immediately — the client closes right away**; in the current version, completion and execution happen in one step.

If a task is still running when you type the command, a confirmation dialog appears first.

You can also select `quit-dsh` from the command palette. Its description is 「关闭 DeepSeek Harness 客户端（退出程序）」 ("Close the DeepSeek Harness client (exit the program)").

**No tokens are consumed at runtime**: the command is handled entirely locally. It only asks the application shell to quit over IPC; it makes no model call at all and counts toward no token usage.

## Renaming the command (configuration menu)

Open the **Plugins** page from the left sidebar of the DSH interface (the "Plugins" panel), find **退出命令** ("Quit command") in the **Official** group, and click it to rename the command.

> **Disclaimer**: This plugin (`dsh-command-quit`) **is not an official DeepSeek plugin** and has **no relationship** with DeepSeek. The configuration panel above is **DSH's own plugin-settings entry point**, borrowed by this plugin to hold one of its own settings (namely the command name). Because a plugin's settings page must be supplied by the plugin itself, while the settings controls on screen are public controls provided by DSH, it looks the same as an official plugin's settings page and sits in the same group — but that **does not mean** it is an official feature.

- **Four presets**: `/quit`, `/quit-dsh`, `/quitdsh`, `/qd`. One click fills the name into the input box.
- **Custom**: type directly into the "Command name" field — the part after the `/` (for example `bye`).
- **Only one is active at a time**: only the command name you saved works; typing any other name does nothing.
- **Takes effect immediately after saving**, with no client restart; the old name stops working at the same time.
- **Two checks before saving** (failing either one refuses the save — the field turns red and the save button cannot be clicked):
  1. **Format**: it must start with a lowercase English letter and may contain only lowercase letters, digits, underscores `_` or hyphens `-`. Uppercase letters, Chinese characters, spaces, a leading digit and an empty value are all rejected. This rule is enforced by the declared configuration schema, so nothing is even written to disk.
  2. **Name collision**: it must not duplicate a built-in DSH command or a command registered by another plugin. There is an easy trap here: DSH stores commands in two layers — some (such as `compact`, `goal`, `plan`) are registered **inside each session/preset scope**, while others (such as `export`, `feedback`, `permission`) are global. If only the global layer is consulted, a name like `compact` looks unused, and your quit command registers successfully yet is **shadowed by the built-in command of the same name** — typing it does not quit at all (this is exactly why "the quit effect disappeared after switching to compact"). The check now walks **every scope the registry knows**; if any layer is occupied, the save is **refused**: the panel shows red text, your input is preserved, the configuration file is not rewritten, and the command currently in use keeps working.

  If you already saved a colliding name earlier (for example `compact`), the plugin notices at startup that the saved name is unavailable, **falls back to the default command name `/quit-dsh` automatically**, and says so in the log.
- **If the name is taken away later, you are told on the spot**: there is also a case that cannot be detected at save time — another plugin registers a command of the same name only **after a particular session starts running**, and that session did not exist when you saved. The plugin listens for DSH's "command table changed" notification and re-confirms after every change that "does this name still belong to me": as soon as it finds the name covered by another command, it **switches back to the default command name `/quit-dsh` automatically** and tells you clearly in the interface:
  - **On the plugin configuration page** (Plugins → Official → Quit command) a passage of red text appears stating "your configured name `/xxx` is taken by another command (the owner)", and then explains that the plugin has switched to `/quit-dsh` and that typing it quits.
  - **A banner pops up at the bottom of the application window**, visible without opening the settings page, and can be dismissed with `×`. Dismissing it closes only that one notice; a different collision, or the same conflict still present after a restart, raises it again.
  - If even the default name is occupied (an extreme case), the message changes to "the quit command is temporarily unavailable" and asks you to pick another name on the configuration page.

> The configuration is kept by DSH itself and written into the current profile's `cordis.patch.yml`; **no** separate configuration file appears in the plugin directory. The conflict notice above is written into that same configuration entry as a `notice` field (it appears only when such a conflict has actually happened, and is empty otherwise); it is cleared automatically once you switch back to a usable name on the configuration page.


## The terminal command `quit-dsh`

### Install it once

1. Open the plugin folder and double-click **`install-dsh-quit.cmd`**.
2. Wait for "安装完成", then close that window.
3. **Open a new terminal** (an already-open one does not know the new command yet) and type `quit-dsh`.

Installing does exactly one thing: it writes two tiny files into **the command directory DSH already keeps on your PATH** — the directory that holds `dsh.cmd`. It **does not modify the client's files and needs no administrator rights**, and it can run while the client is open.

### What it looks like

```text
> quit-dsh
即将关闭 DeepSeek Harness 客户端。
（如果客户端里还有任务在跑，关的时候它自己还会再弹一次确认框。）

确认退出吗？ [y/N] y
正在请求关闭 DeepSeek Harness 客户端…
已发送退出请求，客户端正在关闭。
```

- **Enter alone means no.** Only `y`, `yes` or `是` are read as consent, so a stray Enter cannot close a running client.
- With no client running it says so plainly instead of failing silently.
- **Two confirmations are deliberate**: the terminal one is the first; the client's own "a task is running, quit anyway?" is DSH's second, which this plugin neither can nor tries to bypass — that is exactly why it quits cleanly.
- With several clients running, one invocation asks all of them to quit.

### Options

| Command | Effect |
|---|---|
| `quit-dsh` | Ask first; `y` quits (the default) |
| `quit-dsh --yes` | Do not ask; quit immediately (for scripts and shortcuts) |
| `quit-dsh --list` | List the running clients without quitting |
| `quit-dsh --help` | Show the usage text |

> The name printed by `--help` and by every other message is the one you actually installed: rename the terminal command to `dshq` and the messages say `dshq` — the default is never written in stone.

### What the settings page controls

Open the **Plugins** page in DSH and find **Quit command**; the "Terminal command" section holds:

| Control | Default | Meaning |
|---|---|---|
| **Enable the terminal quit command** | on | When off, `quit-dsh` will not close the client — it only says the feature is off. **The installed launcher is kept**, so turning it back on needs no reinstall. |
| **Ask for confirmation first (y/N)** | on | When off, `quit-dsh` quits immediately without asking. This one is greyed out while the switch above is off. |
| **Terminal command name** | `quit-dsh` | Any legal name (presets: `quit-dsh`, `dsh-quit`, `dshq`, `dsq`). **Saving a new name renames the installed launcher automatically** — no reinstall. |
| **The status line** | — | Says whether it is installed, where, and whether the name is taken. |

After a rename, **a terminal that is already open must be reopened**: shells cache the commands they found on PATH.

### When the name is taken

If the name is already used by another file on the PATH (say `dshq.ps1` in some directory), **the save is refused**, the field turns red and the occupying files are listed — a shell resolves a command against the whole PATH, so a collision would silently run someone else's program. Windows reserved device names (`con`, `nul`, `com1`, …) are refused too.

### Uninstall

Double-click **`uninstall-dsh-quit.cmd`**. It deletes only the two files carrying **this plugin's own marker**; a file of the same name that you created yourself is never touched, and the client's `/quit-dsh` is unaffected.

### How it manages a clean quit

The terminal's `quit-dsh` and the plugin are **two different processes**: the client's internal "please quit" channel is only reachable from the plugin's child process. So while the client runs, the plugin listens on a **local-only** endpoint — a Windows named pipe when available, a `127.0.0.1` loopback port otherwise, with the server rejecting any connection whose peer is not this machine. The endpoint name is not a secret, so a per-process random token (64 hex characters) guards it, stored under your own `~/.dsh-command-quit/`. The terminal command reads the endpoint and the token, connects, and asks the plugin to quit; the plugin then does **exactly what `/quit-dsh` does**.

A wrong token is refused explicitly. Somebody without the token cannot close your client.

## Installation

### Option 1: Install from GitHub

```
install_bundle  github:Noobboi-22401/dsh-command-quit
```

`github:user/repository` is the standard form supported by `install_bundle`, and is the recommended one.

### Option 2: Install from a local path

First clone the repository:

```powershell
git clone https://github.com/Noobboi-22401/dsh-command-quit.git
```

Then:

```
install_bundle  link:<absolute path you cloned to>/dsh-command-quit
```

Installation is performed by DSH's built-in `plugin_manager`, which runs `pnpm add`, writes `dsh-command-quit` into the profile's `dsh.profile.bundles`, creates the symbolic link and updates the lockfile.

### Making it take effect

**Installing the plugin is not the whole story — you must also patch the client shell once, and then restart the client.**

Your own `app.asar` (the client installation file) has no "Host → shell" quit channel, so the plugin needs a small patch as well; see the next section, "Why a desktop-shell patch is still needed". The patch script applies only once per version; running it repeatedly causes no problems.

There are two ways to apply the patch; pick one:

- **If you would rather not use the command line**: double-click `fix-quit.cmd`. It first checks whether the client is closed, then repairs everything automatically and prints a conclusion in Chinese.
- **Using the command line**:

  ```powershell
  node tools\patch-asar.mjs --apply
  ```

**Then restart the desktop client once.** The profile's bundle list is read at startup, and the shell patch is loaded when the Electron main process starts. After the restart the default `/quit-dsh` is available (the command name can be changed at any time on the plugin configuration page, and takes effect immediately without another restart).

## Why a desktop-shell patch is still needed

The command's handler runs inside the Host child process, and the Host is a child process that the Electron shell spawns over IPC. Some DSH versions only have "shell → Host" control messages (`shutdown` / `quit-inspection` / `update-tasks`); they have no "Host → shell" quit channel and expose no quit API to plugins. Clicking the window's X merely `hide()`s to the tray, which is not the same as quitting.

This plugin therefore ships a minimal `app.asar` patch that does three things:

1. `isDesktopHostEvent()` admits the new message `{ type: "quit-request" }`;
2. a branch is added to the Host message handler → `app.quit()` (reusing the native quit flow and confirmation dialog);
3. `DSH_DESKTOP_QUIT_REQUEST=1` is injected into the Host child process so the plugin can tell whether the shell supports this channel at all.

Point 3 is a safety valve: if the patch is ever lost (for example when a client upgrade overwrites `app.asar`), the plugin cannot read that environment variable and returns a clear error message instead of sending an unknown message to the shell (**which** would make the shell treat it as a protocol error and kill the Host).

The patch is an **in-place, equal-length write**: the byte count of `lib/main.js` does not change, and the asar header and the offsets of all other files stay exactly as they were, so there is no risk of the archive being repacked. The script also runs a "reversibility proof" internally — it restores the four edited spots in memory one by one and requires the result to be byte-for-byte identical to the original; otherwise it refuses to write. This mechanism guarantees:

- **Either the patch is applied completely, or nothing is touched.** The script first verifies that the four changes are either all present or all absent; a half-patched archive is refused with advice to restore first, and a half-finished state is never mistaken for "already fixed".
- **There is verification before and after writing.** Before writing, the backup is copied to a temporary file, compared byte by byte, and only renamed into place once confirmed; after writing, the content is read back and compared to confirm that all four changes are really there. Failing any step produces a clear error and tells you how to restore.
- **Even if something does go wrong, there is a clean backup to restore from.** An extreme case (a power failure mid-write, for instance) can still leave an incomplete archive; the script detects that and refuses to continue on top of it. In that situation, restore from the backup with `node tools\unpatch-asar.mjs --apply`. Before restoring, the script also confirms that the backup itself is intact and genuinely free of the patch.

```powershell
# First see what the patch would do (changes no files)
node tools\patch-asar.mjs

# Apply the patch
node tools\patch-asar.mjs --apply

# Behaviour sampling: with quit-request removed, the other sampled messages are judged as in the original
node tools\verify-shell.mjs
```

For non-technical users: double-click `fix-quit.cmd`. It first confirms that the client is closed (its files cannot be changed while the client is running), then runs everything automatically and prints a Chinese conclusion. The launcher looks for a system-installed Node.js first, falls back to the Node bundled with DeepSeek Harness, and only if neither exists does it ask you to install one.

## Upgrading the plugin (1.1.0 → 1.2.2)

If you already run an older version, the upgrade has three steps — **the terminal command is new in 1.2.x, so replacing the plugin files alone is not enough.**

1. **Replace the plugin itself.** Use `plugin_manager` to remove it, then install the latest version (re-installing in place can return `ambiguous-install`; removing first avoids that):

   ```
   remove_bundle  dsh-command-quit
   install_bundle github:Noobboi-22401/dsh-command-quit
   ```

2. **Install the terminal command once.** Open the plugin folder and double-click **`install-dsh-quit.cmd`**.

3. **Restart the client.** Afterwards `/quit-dsh` works as before, and the terminal gains a `quit-dsh` command.

> If you already installed the terminal command earlier (say, a test build), **do not delete anything by hand**: the plugin recognises the launcher files it wrote by their *generation* and replaces an older one automatically.

### What 1.2.2 changes

- **A terminal command**: type `quit-dsh` in any terminal window to close the client through exactly the same clean shutdown path as `/quit-dsh` — never a forced kill.
- **A configurable name**: `quit-dsh` by default; renaming it renames the installed launcher automatically, with no reinstall.
- **One question before it quits**: on by default, and only `y` proceeds; it can be switched off to quit straight away.
- **Messages follow the name you actually use**: rename the command to `dshq` and `--help` and every other message say `dshq` instead of a hard-coded default.
- **Older launcher files upgrade themselves**: the plugin recognises the files it wrote by generation and rewrites a stale one automatically.

## After a client upgrade

An upgrade replaces `app.asar`, so the shell patch is lost with it. The plugin itself is unaffected: the command then returns a clear error message instead of crashing or failing silently.

Simply apply the patch again (idempotent — an already patched archive is skipped):

```powershell
node tools\patch-asar.mjs --apply
```

## Uninstallation

1. Restore the shell (close the client first):
   ```powershell
   node tools\unpatch-asar.mjs --apply
   ```
   It first confirms that the backup is intact and genuinely free of the patch, and after restoring it reads the content back for verification. If the backup file is missing or obviously incomplete, it refuses to run rather than risk a write.
2. Remove the plugin (using the in-application plugin_manager, equivalent to clicking uninstall in the interface):
   ```
   remove_bundle  dsh-command-quit
   ```
3. Restart the client.

## Path configuration

The scripts under `tools/` contain **no hard-coded absolute paths**. They locate the installation in the following order:

| Environment variable | Purpose |
|---|---|
| `DSH_APP_ASAR` | absolute path of the desktop client's `resources\app.asar` |
| `DSH_DESKTOP_EXE` | absolute path of the desktop client executable |
| `DSH_DESKTOP_RESOURCES` | the `resources` directory inside the installation |
| `DSH_PROFILE_DIR` | the DSH profile directory |
| `DSH_HOME` | the DSH home directory (default `~/.dsh`) |
| `DSH_COMMAND_DIR` | where the terminal command is installed (default: the directory holding `dsh.cmd`, found automatically) |
| `DSH_COMMAND_QUIT_STATE` | the terminal feature's state directory (default `~/.dsh-command-quit`) |
| `DSH_COMMAND_QUIT_TRANSPORT` | force the relay transport: `pipe` (named pipe) / `tcp` (loopback port) / `auto` (default) |

If none is set, the scripts search the conventional install locations (`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources` and so on); when nothing is found they report a clear error telling you which variable to set.

**Note: an explicitly set variable has the highest priority, and the path must really exist.** If `DSH_APP_ASAR` points at a non-existent location, the script **stops with an error** instead of quietly falling back to another installation found automatically — this avoids patching the wrong client. For the same reason, when searching automatically for the desktop executable the script will not mistake an uninstaller inside the install directory (such as `Uninstall DeepSeek Harness.exe`) for the client.

For example, when the installation is in an unusual location:

```powershell
$env:DSH_APP_ASAR = '<your install directory>\DeepSeek Harness\resources\app.asar'
node tools\patch-asar.mjs --apply
```

## Directory structure

```
dsh-command-quit/
├── package.json            # npm package manifest (with the dsh.bundle.patch and dsh.client declarations)
├── cordis.patch.yml        # bundle mount declaration: insert command-quit
├── .gitignore              # ignores node_modules, patch backups, etc.
├── lib/
│   ├── index.js            # plugin core (Host half): command registration, command-name validation, save interception and runtime re-check
│   ├── client.js           # browser half: plugin configuration page (two names + two switches) + conflict notices
│   ├── terminal-state.js   # on-disk state of the terminal feature: instance records and the settings snapshot
│   ├── quit-channel.js     # the local relay: named pipe / loopback port + random token
│   ├── terminal-install.js # PATH scanning, launcher install / rename / removal
│   ├── terminal-quit.js    # Host-half life cycle of the terminal feature (listen, publish, auto-sync)
│   └── quit-cli.js         # the terminal command itself: ask, decide, request, print
├── bin/
│   ├── dsh-quit.mjs        # terminal command entry point (called by the two launchers below)
│   ├── dsh-quit.cmd        # Windows launcher (locates Node.js)
│   └── dsh-quit            # POSIX launcher (Git Bash and friends)
├── tools/
│   ├── dsh-paths.mjs       # shared path resolution (environment variables / conventional install locations)
│   ├── patch-asar.mjs      # applies the equal-length shell patch to app.asar
│   ├── unpatch-asar.mjs    # restores the shell from the backup
│   ├── verify-shell.mjs    # behaviour-sampling test for the shell patch
│   ├── profile-check.mjs   # verifies that the profile composes this plugin correctly
│   ├── install-dsh-quit.mjs # installs / removes the terminal command (Chinese-message layer)
│   ├── test-command.mjs    # end-to-end IPC test of the command + configuration tests for both names (Host half)
│   ├── test-client.mjs     # structural test of the configuration page (browser half)
│   ├── test-terminal.mjs   # end-to-end test of the terminal command (relay, question, launcher files)
│   └── fix-desktop-quit.mjs # Chinese-message layer of the one-click repair
├── fix-quit.cmd            # Windows double-click entry point: repair the shell patch (locates Node automatically: system first, then the one bundled with DSH)
├── install-dsh-quit.cmd    # Windows double-click entry point: install the terminal command
├── uninstall-dsh-quit.cmd  # Windows double-click entry point: remove the terminal command
├── README.md
├── README_en.md
└── LICENSE
```

`.gitignore` exists for the repository and is not shipped inside the npm package.

## Compatibility

- **Platform**: the desktop-shell patch is written for the **Windows** packaging format of DeepSeek Harness (`resources\app.asar`, `.exe` entry point). The plugin core (`lib/index.js`) is itself cross-platform, but it depends on the shell providing the `DSH_DESKTOP_QUIT_REQUEST` channel.
- **macOS / Linux not verified**: this plugin has only been developed and tested on one Windows machine, against the Windows build of DeepSeek Harness. The author **does not know whether this plugin is compatible with macOS or Linux**, and has done no verification on those systems. The plugin core (`lib/`) contains no platform-specific code and does not in principle exclude other systems, but the desktop-shell patch and the double-click entry point (see the previous bullet and the notes below) are written for Windows only. Please evaluate and test it yourself on other systems, and do not assume it works there.
- **DSH version**: verified on desktop builds such as `0.2.0-rc.2`. `patch-asar.mjs` depends on several anchor strings inside `lib/main.js`; when a DSH version change makes an anchor disappear, the script reports `anchor not found` and **refuses to write**, rather than writing half a bad patch. An archive whose structure does not match (not an asar, truncated, or `lib/main.js` missing) produces the same clear error instead of an English stack trace.
- **Configuration menu**: the command name is configured through DSH's own plugin configuration page (the Host half declares `Config`, and the browser half `lib/client.js` registers the configuration page). It requires the DSH composition to include `@deepseek-ai/dsh-client-ui-settings`, `@deepseek-ai/dsh-client-ui-plugin-manager` and `@deepseek-ai/dsh-client-ui-primitives` (the source of the shared controls the configuration card uses), plus `react` (shipped with the DSH frontend) — all four are provided by the DSH host and present by default in official desktop builds, so nothing has to be installed separately; `package.json` marks them as optional peer dependencies (`peerDependenciesMeta.optional`). Without the browser half, the plugin core still loads but no configuration page appears in the interface. This entry point is a **public mechanism provided by DSH**; this plugin is merely a user of it, and the bottom of the configuration panel also states that it is "unofficial". Once again: **this plugin has no relationship whatsoever with DeepSeek.**
- **Save interception**: collision interception relies on DSH dispatching the `internal/config` hook before writing the profile patch (the save path of `dsh-config-editor`). This plugin recognises that save in two independent ways — "its own fiber" and "its own profile entry id" — and either hit is enough. The scope that gets checked is the **global layer plus every known session/preset scope in the registry** (DSH's `/compact`, `/goal` and `/plan` hide in scoped layers, so a global-only check would miss them). If some DSH version does not expose scopes (leaving only the global check), a saved name that is unavailable at startup still falls back automatically to the default name `/quit-dsh`, so the quit command never stops working.
- **Fallback and notice when the name is taken away**: the plugin also listens to DSH's `commands/change` event (dispatched on every command addition or removal in the registry, and forwarded to the browser as well). After every change it re-confirms "does the currently registered name still belong to me in every scope" — it recognises itself by the stable identity written at registration time (`definitionId`, a public field of the DSH command registry, unrelated to display text); only when the registry of the running environment does not return that field does it fall back to comparing the command description (with leading and trailing whitespace normalized). So its own global registration is never misread as a conflict, and a description rewritten by DSH does not affect the judgement. As soon as it is covered by someone else, the plugin switches back to the default name automatically and writes the reason into its own configuration entry (the `notice` field). The browser half reads it through the `settings/document-updated` event forwarded by DSH, renders red text on the configuration page, and registers a `shell.overlay` entry that pops a banner at the bottom of the interface. If some DSH version does not forward that event or has no `shell.overlay` slot, the worst case is that the notice cannot be displayed, and **the automatic fallback of the command itself is unaffected**.
- **Fault tolerance of the browser half**: the `shell.overlay` slot that holds the bottom banner is **the very layer the settings dialog lives in**, so if that component threw during rendering it would take the settings page down with it. Three layers of isolation were therefore built in: the settings page is registered **first** and the banner **last**, each with its own error containment; the banner keeps its own state and does not rely on "slot injection" to pass data into the component; and neither component ever throws — a failed render degrades into a line of text on the page and records the failure in the browser's `localStorage` under the `dsh-command-quit:diag` key, which you can read directly when investigating.
- **The contract for reading state on the configuration page**: DSH uses React's `useSyncExternalStore` to turn the data source in "slot injection" into component props, and that channel requires `getSnapshot()` to **return the same object whenever the data has not changed**. As long as two consecutive reads differ by reference, React re-renders endlessly and eventually drags the plugin page down along with the settings page; the symptom is **the configuration menu refusing to open or showing a blank page, with no error on the page at all**. The card in this plugin therefore uses the form's own binding (`SettingsFormModel.bind`, the same approach as the official settings pages) as its data source, wrapped in a structural-comparison cache, giving two guarantees that reads are stable; `tools/test-client.mjs` contains a dedicated regression check watching for this.
- **Node.js**: `>=18` (the build artifacts use ESM, top-level await and `node:`-prefixed imports). The double-click entry point `fix-quit.cmd` first looks for `node.exe` on the system `PATH` (and actually runs it once to confirm it works); if it is not found it automatically falls back to the Node bundled with DeepSeek Harness (located via `DSH_HOME`, `DSH_APP_ASAR` and the conventional install locations), so **a machine without a separately installed Node.js can still use it by double-clicking**.
- **Host shape**: the command can only really quit inside a desktop client that has the quit channel. Executing it in a pure Web / server-side Host returns a clear error message rather than failing silently.
- **The terminal command's relay**: a Windows named pipe is preferred (the operating system never exposes it to the network), falling back automatically to a `127.0.0.1` loopback port where creating a pipe is not permitted. In loopback mode the server checks the peer address and drops anything that is not this machine; both modes require the per-process random token from the instance record, compared in constant time so the comparison leaks nothing. While the feature is off **nothing is listening at all**: "off" means no socket, not a refused request.
- **The terminal command's launcher files**: installed into the directory DSH already keeps on PATH (the one holding `dsh.cmd`). On Windows both `<name>.cmd` (for cmd / PowerShell / Windows Terminal) and the extension-less `<name>` (for Git Bash and similar shells) are written; on macOS / Linux the extension-less one. Both carry this plugin's marker, and renaming or uninstalling **touches only marked files**. The launcher in `bin\` tries, in order: the Node recorded at install time, then `node.exe` on PATH (actually run once to confirm it works), then the Node bundled with DSH — so a machine without a separately installed Node.js still works.
- **The terminal command's collision check**: both saving and installing scan **the whole PATH**, counting `<name>` plus every `.cmd`, `.bat`, `.exe`, `.ps1`, `.com` and `.vbs` spelling, and letting through only files carrying this plugin's marker. Windows reserved device names (`con`, `nul`, `com1`, …) are refused as well.
- **How the terminal command and the configuration page stay in step**: the plugin publishes its status into the `terminalNotice` field of its own configuration entry, and the browser half renders it as the status line from the settings-update event DSH forwards. On a DSH build that does not forward that event the worst case is a status line that does not refresh, and **the command itself keeps working**. Renaming and both switches take effect immediately, with no client restart.

## Notes

- Patching **modifies DeepSeek Harness's installation file** (`app.asar`). The script creates an `app.asar.quit-patch-backup` backup before the first patch (the original file is only changed after the backup has been written and verified); to uninstall, use `unpatch-asar.mjs --apply` rather than deleting files by hand.
- **Close the client before patching or restoring.** The client holds `app.asar` open while running, so the script cannot write safely; `fix-quit.cmd` checks this itself and asks you to quit first.
- The patch is lost after every client upgrade and must be applied again (idempotent, safe to repeat).
- **This plugin is not an official DeepSeek plugin.** It calls DSH's own plugin configuration entry point and plugin registration service; the plugin itself has nothing to do with DeepSeek. Please assess the consequences of modifying the client's installation files yourself; if the client offers an official quit API, prefer the official approach.
- **Command-name collisions are intercepted "at save time".** The check happens before the configuration is written: a collision rejects the save outright, the panel shows red text, the configuration is not written and the command is not switched. To verify this, try one of DSH's own names (such as `compact`): the collision is refused at the moment you press save.
- **Collisions that cannot be detected at save time are caught and reported at runtime.** If another plugin registers a command of the same name only after a particular session starts, it is invisible at the moment of saving; the plugin re-checks whenever the command table changes, and once covered it switches back to `/quit-dsh` automatically and explains why in **red text on the configuration page** and in a **banner at the bottom of the interface**. This notice has to travel through DSH's settings push to appear, so **after restarting the client** an ongoing conflict shows up again.
- Known leftover issue: running `install_bundle` again for an **already existing** local path dependency may make `plugin_manager` return `ambiguous-install` (its fallback matching does not recognise `link:<path>`). This is `plugin_manager`'s matching behaviour, not a problem with this plugin; the first installation is unaffected, and if you hit it, `remove_bundle` first and then `install_bundle` again.
- **The terminal command's launcher lives inside DSH's installation directory** (`resources\runtime\cli\bin`, the directory holding `dsh.cmd`). **A client upgrade may remove it**; if `quit-dsh` disappears after an upgrade, double-click `install-dsh-quit.cmd` once to restore it — the status line on the configuration page will also say "not installed yet".
- **The terminal command is a separate program and needs a running client.** With no client running it only says so; there is nothing it can queue up in advance. It also needs the desktop shell to carry the quit patch (see "Why a desktop-shell patch is still needed"): without it the plugin answers "当前 Host 没有桌面退出通道".
- **This plugin never overwrites someone else's file.** A terminal command name that collides with an existing file is refused at save time; the launcher install removes only files carrying this plugin's marker; and `uninstall-dsh-quit.cmd` never touches a same-named file you created yourself.
- Interoperability note regarding DSH: the tool scripts quote verbatim a small number of strings taken from DeepSeek Harness's own `app.asar` — several anchor code lines and one comment in `tools\patch-asar.mjs`, and one function signature in `tools\verify-shell.mjs`. They serve precise editing and verification only and nothing else. DeepSeek Harness is MIT-licensed (<https://github.com/deepseek-ai/deepseek-harness>), and the copyright of those quoted strings remains with its original author.

## License

[MIT](LICENSE)
