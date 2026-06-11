# refactor-instructions.md

node-red-contrib-plc-comm-slmp のリファクタリング指示書。
この文書は実装担当モデル向けの完結した作業指示である。実装前にこの文書全体を読むこと。

> **最重要の前提**: このパッケージは npm に公開済み
> (`@fa_yoshinobu/node-red-contrib-plc-comm-slmp` 0.2.13)の Node-RED ノード集であり、
> SLMP バイナリ 3E/4E のフレームは 5 スタック横並びの実機検証記録に紐づく。
> **実行時依存ゼロ**(package.json に dependencies なし)の方針を守ること。
> **公開面はノードの設定項目・msg のスキーマ・`lib/` の exports** であり、
> これらを変えてはならない。
>
> 本タスクの中心は `lib/slmp/client.js`(1,491 行)に同居する
> **トランスポート層(TCP フレーミング / UDP / シリアル管理)の move-only 分離**である。

---

## Objective

ノードの挙動・msg スキーマ・送信フレームのバイト列を一切壊さずに:

1. **`client.js` からトランスポート機構(TCP 接続/受信バッファの状態機械、UDP、
   シリアル番号管理、リモートパスワードの自動 lock/unlock)を `lib/slmp/transport.js`
   (新規)へ move-only 分離する**
2. 分離前に**トランスポート層の特性テストを追加**する(フレーミング分割受信・タイムアウト等)
3. `nodes/*.js` と `lib/slmp/high-level.js` は触らない

---

## Project Understanding

### 何のパッケージか

Node-RED から三菱 MELSEC PLC へ SLMP バイナリ 3E/4E で読み書きするノード 3 種
(`slmp-connection` / `slmp-read` / `slmp-write`)。`lib/slmp/` はノード非依存の
クライアント実装(core.js のフレーム組立 + client.js + high-level.js)。

### モジュール構成

| ファイル | 行数 | 内容 |
|---|---|---|
| `lib/slmp/client.js` | 1,491 | `SlmpClient`: API 面(readDevices 等)+ バリデーション + **TCP/UDP トランスポート状態機械**(`_connectTcp` 929 行〜、`_handleTcpData` 1,029 行〜)+ リモートパスワード自動処理(329〜377 行) |
| `lib/slmp/high-level.js` | 976 | 契約ヘルパ(readTyped / readNamed / poll、read-plan 最適化) |
| `lib/slmp/core.js` | 519 | フレーム組立・パース(純粋。健全) |
| `lib/slmp/device.js` 相当 / `constants.js` | — | デバイス解析・定数 |
| `nodes/*.js` | 53〜294 | Node-RED ノード(薄い。健全) |

### テスト / CI

- `test/run-tests.js`(自家製ランナー、依存ゼロ)経由:
  `slmp-core.test.js`(636)/ `slmp-high-level.test.js`(1,458)/
  `shared-vectors.test.js`(クロススタック共有ベクトル)
- `test/run-editor-smoke.js`: エディタ UI スモーク
- CI(`ci.yml`): Node 18/20/22 × `npm test` + `npm pack --dry-run`
- 実行: `npm test` / `npm run smoke:editor` / `npm run pack:dry-run`

---

## Behaviors To Preserve(絶対に壊さない既存挙動)

1. **`lib/slmp/*` の module.exports の形**(名前・シグネチャ・戻り値)。
2. **送信フレームのバイト列**(shared-vectors が契約。既存ベクトル編集禁止)。
3. **ノードの設定項目・msg スキーマ・制御メッセージ**(`connect` / `disconnect` /
   `reinitialize`)・メタデータモード(TODO.md の Cross-Stack 節)。
4. **TCP フレーミングの挙動**: 分割受信の再組立、シリアル番号と応答の対応付け
   (4E)、タイムアウト・切断時のエラー文言。
5. **リモートパスワードの自動 unlock/lock シーケンス**(接続/切断時の順序)。
6. **依存ゼロ**: dependencies / devDependencies を追加しない。
7. **package.json の `files` 一覧と node-red ノード登録**。バージョンも変更しない。

---

## Non-Negotiables(交渉不可の制約)

- 最初に `git status` を確認する。未コミット変更があれば混ぜず、報告して停止する。
- 編集前に Baseline Commands をすべて実行し、結果(テスト件数含む)を記録する。
- 変更は小さく戻しやすい単位。コミットはユーザーの指示があるまで行わない。
- 無関係な整形・「ついで」リファクタリングをしない。
- npm 依存を追加しない。package.json は変更しない
  (`files` に `transport.js` が含まれる `lib/` 配下に置くこと)。
- 分離は move-only: 状態機械のロジック・タイミング・エラー文言を変えない。
- 既存テストの既存アサーションを変更しない(追加のみ可)。
- 実機 PLC への接続を行わない(テストはモックサーバ/ソケットのみ)。
- 正しさが不明な場合は実装を止め、「Stop And Ask」として質問を報告書に書く。

---

## Stop And Ask Conditions(即時停止して質問する条件)

- トランスポート分離で `SlmpClient` のプロパティ(`LastRequestFrame` 相当、トレース
  フック等)との結合が想定より深く、インターフェース設計の判断が必要になった
- 特性テスト採取中に挙動が文書・共有ベクトルと食い違って見えた(**修正せず**報告)
- 既存テスト・エディタスモークが自分の変更後に落ちた ⇒ 即座に巻き戻して報告
- exports・msg スキーマ・フレームバイト列に影響しうる変更が必要に見えた
- 本書の Debt Map に無い大きな問題を発見した(報告のみ)

---

## Baseline Commands

作業ディレクトリ: リポジトリルート。Node.js 18+。実機 PLC 不要・接続禁止。

```bash
git status              # クリーンであることを確認
npm test                # テスト件数を記録
npm run pack:dry-run    # パッケージ内容の確認
```

エディタスモーク(`npm run smoke:editor`)は環境的に可能なら実行、不可なら未実施と明記。

---

## Debt Map

行番号は調査時点(main, commit `6a65a7d`)のアンカー。ドリフトしていたら宣言名で探すこと。

### D1. トランスポート状態機械の特性テスト不足 【実装可 / 最優先】

- **根拠**: `_handleTcpData`(分割受信の再組立)、`_awaitTcpFrame`(シリアル対応付け)、
  タイムアウト、切断検出はクライアント統合テスト経由でしか検証されていない。
- **改善案**: モックソケット(チャンク分割・遅延・切断を注入できるもの)で
  現在の挙動を固定する特性テストを `test/` に追加(自家製ランナーの形式に従う)。
- **リスク**: 低。

### D2. `client.js`(1,491 行)の API 面とトランスポートの同居 【実装可 / 主作業】

- **根拠**: コマンド API(399〜831 行)とソケット管理(849〜1,491 行)が 1 クラス。
  リモートパスワード処理(329〜377 行)も接続ライフサイクルに混在。
- **なぜ負債か**: 接続まわりの修正(再接続・タイムアウト)とプロトコル修正が
  同一ファイルで衝突し、レビューも困難。kvhostlink 版は client.js 506 行で
  同役割を保てており、肥大は SLMP 固有でなく構造的。
- **改善案**: `lib/slmp/transport.js`(新規)へ TCP/UDP 接続・送受信・フレーミング・
  シリアル管理を move-only 分離し、`SlmpClient` は requestBytes→responseBytes の
  インターフェースで利用する。`module.exports` は client.js 経由のままにする
  (transport.js を公開 API にしない)。
- **リスク**: 中。D1 完了後に着手。
- **検証**: 全テスト + エディタスモーク。

### D3. `high-level.js` の read-plan 機構 【現状維持 / 報告のみ】

- 他スタックと同型の private 機構だが、ファイルは 976 行で許容範囲、テストも厚い
  (1,458 行)。本タスクでは触らない。

### D4. その他(現状維持 / 報告のみ)

- `core.js` / `nodes/*.js` / 自家製テストランナーは健全。触らない。
- 依存ゼロ方針のためテストフレームワーク導入は**しない**。

---

## Implementation Phases

### Phase 0: 現状確認

1. `git status` 確認(クリーンでなければ停止・報告)
2. Baseline Commands を実行し、結果を記録

### Phase 1: トランスポート特性テスト(D1)

1. モックソケットで分割受信・連結受信・タイムアウト・切断・シリアル不一致の
   現在挙動を採取しテスト追加
2. `npm test` 実行

### Phase 2: トランスポート分離(D2)

1. UDP → TCP の順で move-only 分離(UDP の方が状態が少ない)
2. 各段階で `npm test`。落ちたら即巻き戻し
3. リモートパスワード処理は client.js に残す(接続「ポリシー」であって
   トランスポートではないため)。結合が深ければ Stop And Ask

### Phase 3: 検証と報告

1. 全 Verification Requirements を最終実行し、Reporting Format に従って報告

---

## Verification Requirements

各フェーズ完了時に最低限:

```bash
npm test
```

最終フェーズでは追加で:

```bash
npm run pack:dry-run     # transport.js が files に含まれることを確認
npm run smoke:editor     # 可能な環境のみ
```

- テスト件数が baseline から増えていること
- `git diff` で確認: package.json 無変更、`nodes/` 無変更、`core.js` /
  `high-level.js` 無変更(client.js の import 行を除く)、既存ベクトル無変更

---

## Reporting Format

1. **Baseline 結果**: 実行コマンドと結果(テスト件数)
2. **D1 追加テスト一覧**: ケース × 採取挙動
3. **D2 の移動一覧**: 移動した関数/状態とインターフェース
4. **各フェーズの検証結果**: 最後に実行したコマンドと結果(失敗を隠さない)
5. **Stop And Ask**: 発生した質問と停止範囲
6. **未実施事項**: エディタスモーク未実施等の明記

---

## Out-of-scope Items(やらないこと)

- 公開 exports・ノード設定項目・msg スキーマの変更
- 送信フレームバイト列・エラー文言・タイムアウト値の変更
- `nodes/` / `core.js` / `high-level.js` の変更
- テストフレームワーク・依存の導入
- バージョン変更、`CHANGELOG.md` 更新、npm publish
- `examples/` / `docsrc/` / `internal_docs/` の変更
- 実機 PLC を使う検証
- 兄弟リポジトリの変更
