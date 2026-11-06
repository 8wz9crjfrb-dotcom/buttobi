# ぶっとびアリーナ（BUTTOBI ARENA）

iPhone・iPad・Android のブラウザで遊べる、2〜6人の3D対戦アクションゲーム（PWA）です。
攻撃を当てて相手のダメージ%を溜め、画面の外まで飛ばしたら撃墜です。

- 端末側：TypeScript + three.js（WebGL2）、Vite でビルド
- 対戦サーバー：Cloudflare Workers + Durable Objects（無料プラン）
- 公開：GitHub Pages（無料）

## できること（現時点）

| 項目 | 状態 |
| --- | --- |
| CPU戦（1〜5体、強さ1〜9） | 遊べる |
| オンライン対戦（4桁のルームコード、最大6人、空き枠をCPUで埋める） | 遊べる（ローカル環境で動作確認済み） |
| キャラクター4体（ミラ・ボルト・グラン・ピコ） | 仮モデル（基本図形の組み合わせ） |
| ステージ3つ（平坦・すり抜け床・動く足場） | 遊べる |
| ルール（ストック制・タイム制） | 遊べる |
| 技（弱・横・スマッシュ溜め・上・下・空中5種・必殺4種・つかみ投げ） | 遊べる |
| ガード・回避・空中回避・崖つかまり | 遊べる |
| タッチ操作・キーボード・ゲームパッド | 遊べる |
| 横向き案内（iOS）、全画面＋横向き固定（Android） | 実装済み |
| ホーム画面に追加（PWA）・オフライン起動 | 実装済み |

## 1. 準備（最初に1回だけ）

1. Mac に [Node.js](https://nodejs.org/) の LTS 版を入れる
2. このフォルダでターミナルを開き、次を実行する

```bash
npm install
```

```bash
cd server && npm install && cd ..
```

## 2. Mac で動かして iPhone / Android から遊ぶ

ゲーム本体を起動します。

```bash
npm run dev
```

オンライン対戦を試すときは、別のターミナルで対戦サーバーも起動します。

```bash
npm run server:dev
```

- Mac のブラウザで http://localhost:5173 を開くと遊べます。
- iPhone / Android は Mac と同じ Wi-Fi につなぎ、`npm run dev` の表示にある `Network: http://192.168.x.x:5173` を開きます。
- このときオンライン対戦は自動で `ws://（MacのIP）:8787` のサーバーにつながります。
- 開発中（http）は「ホーム画面に追加」やオフライン起動は使えません。公開後（https）に使えます。

## 3. 公開する（すべて無料）

### 3-1. 対戦サーバーを Cloudflare に公開

1. [Cloudflare](https://dash.cloudflare.com/sign-up) の無料アカウントを作る
2. 次を実行する（初回はブラウザでログインを求められます）

```bash
cd server && npx wrangler login
```

```bash
npx wrangler deploy
```

3. 表示された `https://buttobi-server.（あなたのサブドメイン）.workers.dev` の `https` を `wss` に変えたものが、サーバーのURLになります。

### 3-2. ゲームを GitHub Pages に公開

1. GitHub で**公開（Public）リポジトリ**を作り、このフォルダを push する（無料プランの GitHub Pages は公開リポジトリが条件です）
2. リポジトリの Settings → Pages → Build and deployment の Source を「GitHub Actions」にする
3. Settings → Secrets and variables → Actions → Variables タブで、`VITE_SERVER_URL` に 3-1 の `wss://…` を登録する
4. main ブランチに push すると自動でビルド・公開されます（`.github/workflows/deploy-pages.yml`）
5. `https://（ユーザー名）.github.io/（リポジトリ名）/` を iPhone の Safari / Android の Chrome で開き、「ホーム画面に追加」する

サーバーのURLは、ゲームの「設定」画面からも変更できます。

## 4. 操作

| 操作 | タッチ | キーボード | ゲームパッド |
| --- | --- | --- | --- |
| 移動 | 画面の左半分をなぞる | 矢印 / WASD | 左スティック・十字キー |
| ジャンプ | ↑ボタン（またはスティックを上にはじく） | スペース | 下・上ボタン |
| 攻撃（A） | Aボタン | J | 左ボタン |
| 必殺技（B） | Bボタン | K | 右ボタン |
| ガード | ◎ボタン | L | 肩ボタン |
| メニュー | 右上の II | Esc | — |

- スティックを横に素早くはじいて A：スマッシュ攻撃（A を押し続けると溜め）
- ガード中にスティックをはじく：回避、ガード中に A：つかみ投げ
- B：そのまま＝飛び道具、横＝突進、上＝復帰、下＝叩きつけ

## 5. フォルダ構成

```
src/shared/     端末とサーバーで共用するゲームの中身
  sim.ts        ゲーム進行（物理・当たり判定・ふっとばし・撃墜）
  moves.ts      技のデータ（発生・持続・ダメージ・ふっとばし）
  characters.ts キャラクターの性能
  stages.ts     ステージ
  ai.ts         CPU の思考
  protocol.ts   通信メッセージの形式
src/client/     端末側（画面・操作・描画・通信）
server/         対戦サーバー（Cloudflare Workers + Durable Objects）
scripts/        テスト・アイコン生成
public/         PWA 用ファイル（manifest・Service Worker・アイコン）
```

## 6. テスト

```bash
npm test
```

CPU同士の試合を画面なしで全ステージ・2/4/6人で最後まで行い、異常値が出ないことと、試合が終わることを確認します。

```bash
npx tsx scripts/ko-test.ts
```

スマッシュ攻撃で何%から撃墜できるかを表示します（調整用）。

オンライン対戦の通しテストは、`npm run server:dev` を起動した状態で次を実行します。

```bash
node scripts/net-test.mjs
```

## 7. 調整のしかた

- 技の強さ・速さ：`src/shared/moves.ts`
- キャラの性能：`src/shared/characters.ts`
- ふっとびやすさ全体：`src/shared/sim.ts` の `KB_GROWTH_SCALE` と `HITSTUN_DRAG`

## 8. まだできていないこと

- **オンライン対戦の「先行表示（予測）」**：今は全員のキャラを、サーバーから届いた状態の補間で表示しています。そのため自分の操作も「通信の往復時間＋約0.1秒」遅れて反映されます。
- **3Dモデルとアニメーション**：今は仮モデルです。差し替える場合は `src/client/fighterModel.ts` と同じ `update()` を持つクラスを作ります。
- **チーム戦・アイテム・BGM**：未実装です。
- **実機での確認**：iPhone / Android の実機では、まだ動作や速さを確認していません。

## 9. 注意

- キャラクター・ステージ・名前はすべてオリジナルです。既存ゲームのキャラクターや名前、音楽は使わないでください。
- Cloudflare の無料プランには1日の上限があります。超えるとその日は対戦がエラーになり、日本時間の朝9時に戻ります。
