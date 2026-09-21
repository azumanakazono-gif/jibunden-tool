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
  return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下のお客様情報をもとに、提案書の最終ページに掲載する「共感＆クロージングコメント」を1つ作成してください。

【お客様情報】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・ライフスタイル：${d.lifestyleNote || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・じぶん電気導入後の月間電気代の削減目安：${d.monthlySaving || 0}円/月
・${d.warrantyYears || 20}年間のコスト差：約${d.costDiffMan || 0}万円（電力会社より安い）
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
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: buildPrompt(d) }],
    });

    const comment = message.content[0].text.trim().replace(/^[「"']|[」"']$/g, '');
    if (!comment) throw new Error('AI応答が空です');

    return res.status(200).json({ comment });
  } catch (err) {
    console.error('[generate-comment] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: 'コメントを生成できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
