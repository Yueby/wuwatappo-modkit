# The plugin registry

Plugins ("mods") come from a GitHub repository of their own, [wuwatappo-mods](https://github.com/Yueby/wuwatappo-mods),
where people send them as pull requests and a person reads each one before it is merged. The launcher lists what is
there and installs it. Nothing is built into the launcher itself: the exe carries no plugins, and a plugin unpacked by
hand into `mods\` works exactly the same.

## Using it

- **The launcher window**: 插件… opens a list of the registry's plugins with where each stands (not installed,
  installed, a newer version). 安装 / 更新 / 卸载 act on the selected one, after asking.
- **The MOD page** in the app's settings: 安装 in the title row opens the same list as a dialog.
- **The command line**: `mods browse` lists them, `mods get <name>` installs one (it shows what the plugin declares and
  asks; `--yes` is for something that has already asked), `mods update [name]`, `mods remove <name>`.

Before anything is put in place the person is shown what the plugin declares: whether it has a **Node part** (it runs as
an ordinary program with the rights of your account: files, network, no sandbox), the permissions it says it uses, the
other plugins it needs, the npm packages it brings (fetched without running their install scripts). Its page scripts run
inside the app's windows and can do whatever the app can. Declarations are the author's word, read by a reviewer; the
program does not enforce them.

## What the launcher trusts, and what it does not

The registry repository publishes `index.json` as the asset of a release called `index`:

```json
{ "formatVersion": 1, "generatedAt": "...", "mods": [
  { "id": "auto-click", "name": "…", "description": "…", "version": "0.4.0", "author": "…",
    "nodePart": false, "permissions": [], "requires": {}, "dependencies": [],
    "url": "https://github.com/Yueby/wuwatappo-mods/releases/download/auto-click-v0.4.0/auto-click-0.4.0.zip",
    "sha256": "…", "size": 2542 } ] }
```

(`src/lib/registry.js` is the reader.) What is checked, in order:

1. An entry whose `url` is not a release asset of the registry's own repository is dropped, so the index cannot point
   the launcher at another place. An entry with a missing or malformed field is dropped, with its reason; the rest are
   still shown. An index in a format this program does not know (`formatVersion`) is refused whole.
2. The zip is downloaded and must be exactly `size` bytes and hash to `sha256`. If not it is deleted unread.
3. The package inside must be the plugin the index says (same `id`, same `version`) **and declare the same things**
   (Node part, permissions, needed plugins, dependencies). Whatever a window or the page showed the person came from the
   index, so a package that declares more than that is refused: what was agreed to is what is installed.
4. The person says yes. For the MOD page that is a message from the panel window only; a mod running in another window
   cannot ask for an install.

What this does not stop: a script that runs in the **panel window** can send the loader the same requests the MOD page does,
including a removal (which has no question), or an install together with its own "yes". The question is there so that
nobody installs something by mistake, not against code that is already running inside the app, and such code can do
whatever the app can anyway (a plugin's page script is not sandboxed). That is one more reason a plugin that runs in the
panel window gets a close look from the reviewer.

What this does not do: it does not make a plugin safe. The registry is reviewed by hand, and the index pins the exact
bytes, so a changed file cannot slip in under a version someone has already looked at, but a reviewer can miss things.
Whoever can change the registry repository can publish plugins.

## Installed from the registry

A plugin installed this way remembers that (`.modkit-source.json` says `registry` and its name), so `update` asks the
registry again and takes a newer version if there is one, and the list shows "可更新". One installed some other way
(a folder, a zip, by hand) is shown as present but is never touched by the registry's update.

## For plugin authors

`modkit.permissions` is a list of words saying what the plugin uses. These four are shown to people in plain Chinese in
the install question and the plugin list; any other word is shown as written:

| word | shown as |
|---|---|
| `files` | 读写文件 |
| `network` | 联网 |
| `clipboard` | 读写剪贴板 |
| `run` | 运行其他程序 |

A plugin that has a Node part (`modkit.host`) is shown as "后台程序：有", whatever it declares.

`modkit.exe mods check <folder> --registry` (or `node src/cli.js mods check ...`) runs the reader the launcher uses,
plus what the registry needs: a `version` like `1.0.0`, a `description`, no `node_modules` in the folder. The registry's
`validate` check runs the same thing on every pull request, and a change to a plugin has to raise its version. What a
reviewer looks for is in the registry's CONTRIBUTING.md.
