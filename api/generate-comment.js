import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_ORIGINS = new Set([
  'https://azumanakazono-gif.github.io',
]);

const PROPOSAL_MODE_LABEL = {
  pv_battery: '太陽光＋蓄電池',
  pv_only: '太陽光のみ',
  battery_only: '蓄電池のみ',
};

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildPrompt(d) {
  const modeLabel = PROPOSAL_MODE_LABEL[d.proposalMode] || '太陽光＋蓄電池';
  const costDiffMan = Number(d.costDiffMan) || 0;
  const isNegative = costDiffMan < 0;

  if (isNegative) {
    return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下の試算では、${d.warrantyYears || 20}年間のコスト差が電力会社よりも高くなる結果（マイナス）になりました。
これは提案書に載せる顧客向け文章ではなく、担当スタッフ向けの「注意喚起メモ」です。

【試算結果】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・${d.warrantyYears || 20}年間のコスト差：約${costDiffMan}万円（マイナス＝電力会社より高くなる試算）
・提案モード：${modeLabel}

【必ず含める内容】
・このままの条件ではコスト差がマイナスになり、プラン内容やシステム構成（太陽光容量・蓄電池容量・工事費・補助金条件など）の見直しが必要であること
・スタッフがお客様へどのように慎重にご案内・ご提案すべきか（数値を断定的に伝えない、前提条件次第で結果が変わる旨を丁寧に説明する、必要なら再シミュレーションを提案する、等）の具体的な助言

【条件】
・宛先はお客様ではなく社内スタッフである（お客様向けの共感・クロージング表現は使わない）
・日本語で120〜180文字程度
・出力は本文のみ。説明や見出し、鉤括弧は付けない`;
  }

  return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下のお客様情報をもとに、提案書の最終ページに掲載する「共感＆クロージングコメント」を1つ作成してください。

【お客様情報】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・ライフスタイル：${d.lifestyleNote || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・じぶん電気導入後の月間電気代の削減目安：${d.monthlySaving || 0}円/月
・${d.warrantyYears || 20}年間のコスト差：約${costDiffMan}万円（電力会社より安い）
・提案モード：${modeLabel}

【条件】
・お客様の家族構成や暮らしに寄り添う共感の一言から始め、最後は導入への後押し・ご検討のお願いで締めくくる
・日本語で100〜150文字程度（厳守）
・絵文字は1つまで使用可（任意）
・出力はコメント本文のみ。説明や見出し、鉤括弧は付けない`;
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[generate-comment] ANTHROPIC_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーが発生しました' });
  }

  try {
    const d = req.body || {};
    const isNegative = (Number(d.costDiffMan) || 0) < 0;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(d) }],
    });

    let comment = message.content[0].text.trim().replace(/^[「"']|[」"']$/g, '');
    if (!comment) throw new Error('AI応答が空です');
    if (isNegative && !comment.startsWith('⚠️')) comment = `⚠️【スタッフ向け注意】${comment}`;

    return res.status(200).json({ comment, isNegative });
  } catch (err) {
    console.error('[generate-comment] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: 'コメントを生成できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
