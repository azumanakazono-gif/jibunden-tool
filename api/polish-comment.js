import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_ORIGINS = new Set([
  'https://azumanakazono-gif.github.io',
]);

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 運営会社（株式会社アズマ）のビジョン。お客様向け文章を添削する際のトーンの土台として必ず意識させる
const COMPANY_VISION = `【運営会社のビジョン（トーンの土台として必ず意識すること）】
・運営会社は「強い田舎を作りたい」というビジョンを掲げ、電気を地域で創り地域で活かす「地消地産」を大切にしています
・添削後の文章が、単なる経済メリットの解説で終わらず、お客様の暮らしが地域のエネルギー自立・持続可能な未来づくりにつながる温かみを感じられるものになっているか意識すること
・元の文章にその視点がなければ、意味を変えない範囲で一言自然に盛り込んでよい。すでに触れられていれば、その表現をより活かす形で整えること
・「地消地産」という言葉を使う場合はそのまま使ってよいが、無理に毎回使う必要はなく、押しつけがましいスローガンにはしないこと`;

function buildPrompt(text, isNegative) {
  if (isNegative) {
    return `あなたは社内向け文章の校正が得意なプロの編集者です。
以下はスタッフが下書き・修正した「コスト差マイナス時の社内向け注意喚起メモ」です（お客様向けではありません）。
意味・ニュアンス・記載されている数値や事実関係は変えずに、より明確で分かりやすい文章に整えてください。

【現在の文章】
"""
${text}
"""

【条件】
・宛先は引き続き社内スタッフです。お客様向けの営業トーンや共感表現に書き換えないこと
・冒頭に「⚠️」「【スタッフ向け注意】」等の注意喚起の体裁があれば、それは保つこと
・意味や含まれる数値・事実（金額・年数など）は一切変えないこと。新しい数値を追加したり書き換えたりしないこと
・元の文章と大きく長さを変えないこと（日本語で120〜180文字程度を目安にする）
・出力は添削後の本文のみ。説明や見出し、鉤括弧は付けない`;
  }

  return `あなたはプロの営業ライターです。
以下はスタッフが下書き・修正した、お客様向け提案書の最終ページに載せる「共感＆クロージングコメント」です。
意味・ニュアンスは保ったまま、より伝わりやすく説得力のあるプロの営業トークへ添削・ブラッシュアップしてください。

${COMPANY_VISION}

【現在の文章】
"""
${text}
"""

【条件】
・伝えたい意味・ニュアンスは変えないこと
・含まれる金額・年数・％などの数値や事実関係は一切変えないこと。新しい数値を追加したり書き換えたりしないこと
・不自然な言い回しや冗長な表現を整え、より自然で説得力のある文章にすること
・元の文章と大きく長さを変えないこと（日本語で100〜150文字程度を目安にする）
・絵文字は元の文章にあるものは活かしてよいが、合計1つまでとし、新たに増やしすぎないこと
・出力は添削後の本文のみ。説明や見出し、鉤括弧は付けない`;
}

// コメント中の金額・年数トークン（例: 「123万円」「4,500円」「20年」）を抽出
function extractAmountTokens(text) {
  const re = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万円|円|kWh|kwh|%|年)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    tokens.push({ value: parseFloat(m[1].replace(/,/g, '')), unit: m[2] === 'kwh' ? 'kWh' : m[2] });
  }
  return tokens;
}

// 添削後の文章に、元の文章になかった数値が新たに現れていないか検証
function hasNewNumbers(original, polished) {
  const originalTokens = extractAmountTokens(original);
  return extractAmountTokens(polished).some(t =>
    !originalTokens.some(o => o.unit === t.unit && Math.abs(o.value - t.value) < 0.5)
  );
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[polish-comment] ANTHROPIC_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーが発生しました' });
  }

  try {
    const d = req.body || {};
    const original = (d.text || '').trim();
    if (!original) return res.status(400).json({ error: '添削する文章がありません' });

    const isNegative = !!d.isNegative;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = buildPrompt(original, isNegative);
    const clean = (text) => (text || '').trim().replace(/^[「"']|[」"']$/g, '');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    let polished = clean(message.content[0].text);
    if (!polished) throw new Error('AI応答が空です');

    // 元の文章になかった数値が新たに紛れ込んでいたら、一度だけ厳格な指示で再添削
    if (hasNewNumbers(original, polished)) {
      console.warn('[polish-comment] 数値の不一致を検知、再添削します');
      const retryMessage = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `${prompt}\n\n【再添削の注意】前回の出力には、元の文章になかった数値が含まれていました。数値は元の文章に書かれているものだけを、そのままの桁で使い、新しい数値は一切書かないでください。`,
        }],
      });
      const retryPolished = clean(retryMessage.content[0].text);
      // それでも整合しない場合は、数値を誤って変えるリスクを避けるため元の文章をそのまま返す
      polished = (retryPolished && !hasNewNumbers(original, retryPolished)) ? retryPolished : original;
    }

    if (isNegative && !polished.startsWith('⚠️')) polished = `⚠️【スタッフ向け注意】${polished}`;

    return res.status(200).json({ comment: polished });
  } catch (err) {
    console.error('[polish-comment] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: '添削できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
