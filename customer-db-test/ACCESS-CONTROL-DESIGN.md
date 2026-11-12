# 顧客DBアクセス制御 設計メモ（PR #318 検証専用）
更新: 2026-11-12

## 検証結果と現状
- 検証専用Google Sheet + Apps Scriptでは、オーナー本人による保存・読み取り・金利4.6%自動復元を確認。
- Vercel→本人限定GAS画面へのリンク移動は成功したが、Vercel本体からの認証付きDB API連携は**未実装**。
- 本番顧客DB／本番計算式は変更しない。
- cloudテストモードは、誤った送信を防ぐため無効（fail closed）。

## 推奨アーキテクチャ（将来の設計案）
1. VercelフロントエンドでGoogle Identity Services等によりログイン。IDトークンをHTTPSで**VercelのサーバーAPI**へ送る。
2. サーバーはGoogle公式ライブラリで署名・issuer・audience・有効期限を検証し、email_verified / subを取得。名前・email・担当者名・顧客IDなどのブラウザ送信値を本人確認として信用しない。
3. サーバー側の登録スタッフ台帳（Google sub 主キー、active、role）と顧客ごとのownerSub・共有権限を照合。未登録・退職済み・他担当者は原則拒否。管理者と明示共有のみ例外。
4. 認可後、サーバー側の認証済み実行主体を使い、権限を限定した顧客DBストレージに保存・取得。書込権限をフロント側に渡さない。Vercelと現在の「自分のみ」GASの連携はできないため、別の認証可能なストレージや安全なサーバー間接続方式が必要。
5. 操作ログ（時刻、actor sub、対象顧客ID、操作、結果、変更前後の差分）を保存。重要な変更は同時編集を検出するためversion/updatedAtを検証。
6. 実装は検証専用DB→権限制御テスト→複数人テスト→計算式の回帰テスト→承認の順に進める。最後まで本番データを混ぜない。

## GAS特有の注意
Google Apps Scriptの「実行ユーザー：自分（オーナー）」では、Session.getActiveUser().getEmail() が空文字になることがある。これをスタッフ認証として使わない。
「アクセスできるユーザー：全員」への変更はしない。公開範囲の変更だけで安全なAPIにはならない。

## 許可モデル（今回追加）
`access-policy.mjs` は、すでにトークン検証済みのidentityを受け取り、actorのGoogle subを照合する純粋な認可関数。
- admin: read / write
- record.ownerSubと一致するstaff: read / write
- record.grantsに明示記録されたstaff: read、またはread/write
- それ以外・未検証・未登録・無効・不明操作: DENY

**重要:** この関数だけではログイン機能や安全なDB APIは成立しない。verified:trueフラグをブラウザから受け取る実装は禁止。必ずサーバーで署名済みトークンを確認した後のみ呼び出す。顧客IDによる対象レコードの解決もサーバー側で行う。

## 次の実装前に決めること
- 営業スタッフの認証基盤：アズマ管理のGoogle Workspaceか、個人Googleアカウント混在か
- 管理者、担当者、共同担当者の権限ルール
- DB保管先とサーバー間認証方式
- 退職者・異動時の権限停止、操作履歴保存期間

## 回帰テスト
`node --test customer-db-test/access-policy.test.mjs`
金利計算（20年基準）、現金/ローン単価、既存データ仕様についてはこの段階で未変更。
