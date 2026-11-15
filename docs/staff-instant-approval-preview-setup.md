# じぶん電気 スタッフ即時承認プレビュー実装

## 現状
営業スタッフがGoogle（会社/個人Gmail）で本人確認 → 初回pending登録 → 中園管理者 azumanakazono@gmail.com へ通知 → 管理者がGoogle認証して承認 → スタッフ画面が5秒ごとに承認を確認。

本機能はプレビュー用の開発途中です。本番顧客DB、ローン計算式、共有金利マスタは未変更。承認済みでも、ローン画面と顧客データAPIの使用制限解除はまだ接続されません。

## 実装したファイル
- staff-login-preview.html : Googleログイン、申請、承認待ちの自動更新
- staff-approval-preview.html : 管理者向けスマホ承認・却下画面
- api/staff-auth-preview.js : IDトークン検証、登録、通知
- api/staff-status-preview.js : 有効なログインセッションの承認状態確認
- api/staff-approval-preview.js : DB承認済み管理者の操作に限定
- customer-db-test/staff-instant-service.mjs : 登録・申請・通知試行履歴
- customer-db-test/staff-session-preview.mjs : 署名付きHttpOnly Cookie
- customer-db-test/staff-notice-preview.mjs : Resendを使う通知
- customer-db-test/staff-runtime-preview.mjs : DB接続と過剰権限の拒否
- customer-db-test/staff-registration-requests.preview.sql : 申請情報用の追加テーブル

## 公開前の必要作業（未実施）
1. 対象を専用NeonプレビューDBと確認し、バックアップ。
2. 既存jibunden_staff_appにはneon_superuser継承、CREATEROLE、CREATEDB、BYPASSRLSがあるため、現在のコードは接続を拒否する。最小権限のランタイム専用ロールを新設し、Neonで実効権限を確認。既存のロールを無条件に削除・変更しない。
3. 専用DBで既存のスタッフ台帳・監査ログ構造を確認し、追加テーブルSQLを実行。新しいランタイムロールはstaff_registryに必要最小限のSELECT/INSERT/UPDATE、staff_audit_logにINSERTのみ、追加テーブルに必要最小限のSELECT/INSERT/UPDATEを付与。監査ログUPDATE/DELETEやDDLは付与しない。
4. 管理者本人の不変Google subを公式Google認証済みIDから確認し、管理用DBロールで approved/admin を安全にbootstrap登録、監査ログにbootstrapを同一トランザクションで記録。メールアドレス一致だけで管理者にしない。
5. Vercel Preview専用の環境変数を設定（秘密はソースやチャットに貼らない）：JIBUNDEN_STAFF_GOOGLE_CLIENT_ID、JIBUNDEN_STAFF_DB_DATABASE_URL（上記最小権限ロール）、JIBUNDEN_STAFF_SESSION_SECRET（32文字以上の乱数）、JIBUNDEN_STAFF_PUBLIC_ORIGIN（HTTPSのプレビューURL）、JIBUNDEN_STAFF_RESEND_API_KEY、JIBUNDEN_STAFF_MAIL_FROM（送信ドメイン認証済みアドレス）。
6. Google CloudでプレビューURLをOAuth許可オリジンに登録。Resendで送信元ドメインを検証。
7. 実機で申請、Gmail配送、管理者承認、スタッフ側自動反映を一貫試験。未承認、停止、誤アカウントはアクセス拒否。
8. スタッフによるローン画面利用制限解除は、サーバー側で実際のローン画面/APIに認可ゲートを実装した後にE2E試験。単なる画面上の非表示では認可にならない。
9. 本番展開・マージは最終レビューと明示承認後のみ。

## 安全設計
- メールリンクはリクエストIDのみ。開くだけでは承認できず、管理者ログインとDB上のadmin権限が必要。
- 登録はpending + staffのみ。approved/suspended/rejectedはログインし直しても自動変更しない。
- 管理操作は同一オリジンPOST、DBの承認済み管理者を確認、自己承認禁止、監査ログ更新とトランザクション。
- セッションは署名付きHttpOnly/Secure/SameSite=Lax Cookie、最大24時間。承認記録は永続的で、同じGoogleアカウントで再ログイン可。
- 重複通知は10分間隔で制御。メールAPI障害時でもpendingを維持し、管理者画面で確認可能。メール配送の即時到着は保証できない。
- 本番運用前に、通知失敗の再送ジョブ、アクセス試行のレート制限、停止時のセッション検証、監視を追加。
- 現段階ではloanAccessGrantedは常にfalse。DB接続・通知の未設定時はfail closed。

## 2026-11-15: ローン画面アクセスゲート（追加）
- middleware.js にプレビュー専用のサーバー側アクセス判定を追加。
- JIBUNDEN_STAFF_GATE_MODE=enforce **かつ** VERCEL_ENV=preview の場合だけ有効。
- 対象: /, /index.html, /payment-options.html, /loan-presentation.html。
- DB承認済みの staff/admin で、同じGoogle subにひも付く署名済みセッションだけ通過。
- 未承認、停止中、セッションなしはログイン検証画面へ移動。
- 承認されればログイン検証画面から対象ページへ戻る。
- デフォルトは無効（既存画面の動作維持）。プレビューでも管理者bootstrap・最小権限DBロール・セッション署名鍵等の検証が完了するまで有効化しない。
- 本番やGitHub Pages等の公開ページはこのミドルウェアで保護されない。営業スタッフ用のアクセスを限定する際は、GitHub Pagesの公開経路も別途閉鎖または安全な認証付き経路へ移す必要がある。
- レート制限、二段階認証条件、セッション失効、メール再送の耐障害性、DB権限監査、端末でのE2Eを満たしてから本番導入判断。
- PR #320 のDraft中であり、Production環境と本番顧客データへの変更は行っていない。
