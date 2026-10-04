# WebPi Desktop

[English](./README.md) | [中文文档](./README.zh-CN.md) | [Русский](./README.ru.md)

**WebPi Desktop は [pi coding agent](https://github.com/earendil-works/pi) のデスクトップクライアントで、WebPi を土台にしています。** トレイアイコン付きの普通のデスクトップウィンドウで、アプリを起動するとサーバーが起動し、終了すると停止します。**Node.js のインストールは不要**です。pi と同じ設定・認証情報・セッションファイルを読み書きするため、ターミナルで始めた会話をアプリで開けますし、その逆もできます。

![WebPi Desktop の開始画面：セッションサイドバー、Get Started パネル、下部のモデル・スキル・設定](./docs/screenshot.png)

このリポジトリーには**二つ**あり、pi のデータ（セッションと認証情報は `~/.pi/agent`）を共有します。

| | 何か | 起動方法 |
| --- | --- | --- |
| **WebPi Desktop** | デスクトップクライアント — 専用ウィンドウとトレイアイコン、サーバーはアプリと一緒に起動・停止 | [リリースページ](https://github.com/citie114514/pi-web/releases/latest)からインストーラーまたはポータブル版、または `npm run desktop` |
| **WebPi** | その土台となるブラウザー UI：セッション、チャット、モデル、ファイル、ターミナル | グローバルコマンド `webpi`、または pi 内で `/webpi` |

## これは何ではないか

GitHub には pi のフロントエンドが数多くあり、名前も衝突します。境界を先に書いておきます。

- **ターミナルのブリッジではありません。** WebPi は本物の Web UI（Next.js）で、pi のセッションファイルと RPC を直接読み書きします。TUI を xterm.js でブラウザーに移したものではありません。
- **別の agent ランタイムではありません。** セッション管理、モデルと認証の設定、agent の実行はすべて上流の `pi` を通します。これはその外側の殻です。
- **`agegr/pi-web` が土台**で、Web UI はそこから来ています。WebPi Desktop が加えるのはデスクトップシェル、パッケージング、Windows で扱いやすい起動処理です。

WebPi は [pi-web](https://github.com/agegr/pi-web) の下流ビルドです。アプリケーション本体は上流の成果物で、このリポジトリーが追加するのは `webpi` コマンド、WebPi Desktop デスクトップクライアント、Pi パッケージ、Windows で扱いやすい起動処理、そして WebPi という名称です。差分は [docs/webpi.md](./docs/webpi.md)、デスクトップ版は [docs/webpi-desktop.md](./docs/webpi-desktop.md)、上流の取り込みは [docs/upstream-sync.md](./docs/upstream-sync.md)、分岐元は [docs/upstream-inventory.md](./docs/upstream-inventory.md) を参照してください。

## 機能

- **セッションワークスペース**：プロジェクトごとに会話を一覧・再開・名前変更・エクスポート・削除でき、実行状態、コンテキスト使用量、コスト、圧縮の情報も表示します。
- **二通りの分岐**：**新しいセッション** は過去のメッセージから独立したセッションファイルを作り、**ここから編集** は現在のセッション内に分岐を作ります。
- **プロジェクトファイル操作**：ファイルの閲覧とアップロード、Git 差分の確認、ソース・Markdown・画像・音声・PDF・DOCX のプレビュー（自動更新付き）。
- **Git worktree**：サイドバーでチェックアウトを切り替えつつ、同じリポジトリーのセッションは一つにまとまります。
- **ブラウザー上の設定**：プロバイダーのログインと API キー、モデル、モデルテスト、プラグインパッケージ、スキルをブラウザーから管理できます。
- **英語・簡体字中国語・繁体字中国語の UI**：初期値はブラウザーの言語に従い、上部バーで切り替えられます。

## クイックスタート

### デスクトップアプリケーション

[リリースページ](https://github.com/citie114514/pi-web/releases/latest) からお使いのプラットフォーム向けビルドをダウンロードして実行します。アプリを起動すると WebPi サーバーが起動し、終了するとそのサーバーも停止します。ほかに何もインストールする必要はありません。

| プラットフォーム | インストーラー | ポータブル版 |
| --- | --- | --- |
| Windows x64 | `WebPi-Setup-<version>-x64.exe`（ユーザー単位、管理者権限不要） | `WebPi-Portable-<version>-x64.exe`、`WebPi-<version>-win-x64-portable.zip` |
| Linux x64 | `WebPi-<version>-linux-x86_64.AppImage`、`WebPi-<version>-linux-amd64.deb` | `WebPi-<version>-linux-x64-portable.zip` |
| Linux arm64 | `WebPi-<version>-linux-arm64.AppImage`、`WebPi-<version>-linux-arm64.deb` | `WebPi-<version>-linux-arm64-portable.zip` |
| macOS x64 / arm64 | `WebPi-Setup-<version>-<arch>.dmg` | `WebPi-<version>-mac-<arch>-portable.zip` |

アプリとサーバーの関係、ポータブルモード、署名の警告については[デスクトップアプリケーション](#デスクトップアプリケーション)を参照してください。

### `webpi` コマンド

Node.js 22.19.0 以上が必要です。`node --version` で確認し、このリポジトリーをグローバルコマンドとしてインストールします。

```bash
git clone https://github.com/citie114514/pi-web
cd pi-web
npm install
npm run build
npm install -g .
webpi
```

サーバーの準備ができると `webpi` はブラウザーを開きます。開かない場合は表示された URL（既定は [http://127.0.0.1:30141](http://127.0.0.1:30141)）を開いてください。WebPi は既定で `127.0.0.1` のみを待ち受けます。不要になったら `npm uninstall -g webpi` で削除できます。

### Pi パッケージとして

このディレクトリーを Pi パッケージとしてインストールすると、pi の中からサーバーを起動できます。

```bash
pi install /path/to/pi-web
```

pi の TUI で `/webpi` を実行するとサーバーが起動し、URL が表示されます。`/webpi --port 8080` は同じランチャーに引数を渡します。この方法で起動したサーバーはその pi セッションと一緒に停止します。TUI より長く動かしたい場合はシェルかデスクトップアプリから起動してください。

### モデルの設定

モデルのプロバイダーが未設定の場合は、**Models** パネルを開いてログインするか API キーを追加してください。このパネルは pi のモデル・設定・認証情報ストアをそのまま使うため、どちらの画面で変更しても他方に反映されます。pi CLI の `/login` が書き込むのも同じ認証情報です。

上流のパッケージは `npx @agegr/pi-web@latest` として引き続き利用できます。このパッケージング層が不要な場合はそちらを使ってください。

## デスクトップアプリケーション

デスクトップ版は同じアプリケーションを専用ウィンドウで動かすもので、トレイアイコンと明確なライフサイクルを持ちます。

- **アプリの起動がサーバーの起動、アプリの終了がそのサーバーの停止です。** このアプリが起動していないサーバーは停止しません。同じポートで別の WebPi が動いている場合は、空いているポートで自分用のインスタンスを起動するため、終了時に他のプロセスを巻き込みません。
- **ウィンドウを閉じると確認されます**——トレイに最小化するか、完全に終了するか。選択は記憶でき、トレイメニューからいつでも変更できます。
- **トレイメニュー**ではウィンドウの表示・非表示、サーバーの再起動、終了も行えます。サーバーが予期せず終了した場合は、再起動または終了を選ぶダイアログが出ます。
- **ポータブルモード**：ポータブル版は設定を展開先フォルダー内に保存するため、フォルダーごと USB メモリーに移せます。pi 自身のデータは `~/.pi/agent` のままです。

ビルドにはコード署名を行っていないため、Windows SmartScreen と macOS Gatekeeper が初回起動時に警告を出します。警告への対処、ポータブルモード、署名の設定、CI でのリリース手順は [docs/webpi-desktop.md](./docs/webpi-desktop.md) にまとめています。

ソースからビルドする場合：

```bash
npm run desktop          # ソースから実行
npm run desktop:dist     # このプラットフォーム向けのインストーラーとポータブル版
```

成果物は `release/` に出力されます。`.github/workflows/desktop-release.yml` は全プラットフォームをビルドし、各成果物を実際に起動して確認したうえでリリースを公開します。

## 設定

ポートとホスト名はコマンドライン引数が対応する環境変数より優先されます。`--no-open` または `PI_WEB_NO_OPEN=1` のいずれかでブラウザーの自動起動を無効にできます。`webpi --help`（または `-h`）は起動オプションを表示して終了コード 0 で終わり、サーバーは起動しません。未知の引数はエラー終了します。

環境変数は上流の `PI_WEB_*` 名をそのまま使うため、既存の手順やラッパーは変更不要です。

| オプション / 環境変数 | 用途 | 既定値 |
| --- | --- | --- |
| `--help`、`-h` | 起動オプションを表示して終了 | — |
| `--port <ポート>`、`-p <ポート>`、`PORT` | サーバーのポート | `30141` |
| `--hostname <ホスト>`、`-H <ホスト>`、`PI_WEB_HOSTNAME` | 待ち受けホスト名 | `127.0.0.1` |
| `--no-open`、`PI_WEB_NO_OPEN=1` | ブラウザーを自動で開かない | 自動で開く |
| `PI_WEB_SKIP_VERSION_CHECK=1` | WebPi の更新確認を無効化 | 未設定 |
| `PI_WEB_ALLOWED_HOSTS` | 追加で許可するプロキシ／独自ホスト名（カンマ区切り、完全一致） | 未設定 |
| `PI_WEB_PASSWORD` | ブラウザーのパスワードログインを有効化。API クライアントはユーザー名 `pi` で Basic 認証可 | 認証なし |
| `PI_WEB_IDLE_TIMEOUT_MS` | セッションのアイドルタイムアウト（ミリ秒、上限 `2147483647`）。`0` で無効化。不正値・範囲外は既定値 | `600000`（10 分） |

例：

```bash
webpi --help
webpi -p 8080 -H 0.0.0.0 --no-open
```

### 起動時の挙動

- 指定ポートで既に WebPi が動いている場合は再利用します。`webpi` はその URL を表示して終了し、同じセッションファイルに対して二重にサーバーを起動しません。
- 他のプログラムが使っているポートは飛ばします。最大で連続 10 ポートまで試し、実際に使ったポートを表示します。Next.js 自身が拒否する予約ポートも飛ばします。
- `--port 0` は空いているポートを OS に選ばせます。
- 単体で起動した `webpi` は `Ctrl+C` で止めるまで動作し続けます。

### リモートアクセス

ループバック以外にバインドすると、高い権限で動作できるエージェントをそのまま公開することになります。信頼できる LAN でも、十分に長いランダムなパスワードを設定してください。

```bash
PI_WEB_PASSWORD='長いランダムパスワード' webpi --hostname 0.0.0.0
```

パスワード認証は通信を暗号化しません。WebPi を平文 HTTP でインターネットに公開しないでください。信頼できるリバースプロキシーか VPN 経由で HTTPS を使ってください。リバースプロキシーが外部ホスト名を転送する場合は、その完全一致名を `PI_WEB_ALLOWED_HOSTS` に追加します。この許可リストは WebPi がバインドするアドレスを変更しません。

### HTTP プロキシー

サーバー側のモデルおよび API リクエストは、標準の `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 環境変数に従います。

macOS / Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
webpi
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
webpi
```

## 注意事項

- **エージェントのデータ**：WebPi は既定で `~/.pi/agent` から pi のデータを読みます。セッションファイルは `sessions/<エンコードされた作業ディレクトリー>/<タイムスタンプ>_<uuid>.jsonl` にあります。`PI_CODING_AGENT_DIR` で別のディレクトリーを指定できます。
- **ファイルシステムへのアクセス**：WebPi はエージェントデータディレクトリーと、セッションに記録された作業ディレクトリーを読める必要があります。既存のセッションを共有する場合は pi と同じファイルシステム環境で動かしてください。
- **設定の共有**：モデルパネルは pi のモデル・設定・認証情報ストアを使うため、変更は両方の画面に反映されます。
- **ファイルアクセスの範囲**：ファイルブラウザーは WebPi で選択した作業ディレクトリーと、既に把握しているプロジェクト／セッションのルートに限定されます。汎用のファイルマネージャーではありません。
- **Git worktree**：切り替えの表示条件、worktree の作成と削除の挙動は [Worktrees in WebPi](./docs/worktrees.md) を参照してください。
- **WebPi を土台にする場合**：ラッパーなどはセッション行のコンテキストメニューと拡張セッションの生存リースを利用できます。[下流向け連携](./docs/downstream-integration.md) を参照してください。

## 開発

```bash
npm install
npm run dev
```

開発サーバーは [http://127.0.0.1:30141](http://127.0.0.1:30141) で動きます。よく使うチェック：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

通常の開発中に `next build` や `npm run build` を実行しないでください。`.next/` に書き込み、開発サーバーに影響することがあります。ビルドはリリース作業で行います。

コントリビューター向けドキュメント：[上流の取り込み](./docs/upstream-sync.md)（この fork は毎週上流を追跡します）、[国際化](./docs/i18n.md)、[リリース手順](./docs/release.md)。

## リポジトリー構成

```text
app/             Next.js の UI と API ルート
components/      React UI コンポーネント
hooks/           クライアント状態とインタラクション
lib/             セッション、エージェント、モデル、ファイル、Git、セキュリティ
public/          静的アセットと PWA ファイル
bin/             npm CLI エントリーポイント、起動引数の解析、起動ポートの選択
desktop/         Electron シェル：ウィンドウ、トレイ、サーバーライフサイクル、パッケージング
extensions/      /webpi コマンドを提供する Pi パッケージ拡張
skills/          Pi パッケージのスキル
docs/            利用者・コントリビューター向けの個別ドキュメント
demo/            GitHub Pages に公開する静的デモ（demo/README.md 参照）
```

アーキテクチャの説明と詳細なファイル一覧は [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

[MIT](./LICENSE)。上流の著作権と表示は保持します。WebPi は [pi-web](https://github.com/agegr/pi-web) の下流ビルドです。
