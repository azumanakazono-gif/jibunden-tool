import Anthropic from '@anthropic-ai/sdk';

const ALLOWED_ORIGINS = new Set([
  'https://azumanakazono-gif.github.io',
]);

const PROPOSAL_MODE_LABEL = {
  pv_battery: '太陽光＋蓄電池',
  pv_only: '太陽光のみ',
  battery_only: '蓄電池のみ',
};

// この自家消費率（%）以上なら「自分の屋根の電気を自宅で使い切れている」アピールを促す
const HIGH_SELF_CONSUMPTION_THRESHOLD = 80;

// 家族構成にお子様が含まれるかの簡易判定キーワード
const CHILD_KEYWORDS = ['子供', '子ども', 'こども', 'お子様', 'お子さん', '息子', '娘', '子'];
function hasChild(familyComposition) {
  return CHILD_KEYWORDS.some(k => (familyComposition || '').includes(k));
}

// 運営会社（株式会社アズマ）のビジョン。お客様向けコメントのトーンの土台として必ず意識させる
const COMPANY_VISION = `【運営会社のビジョン（トーンの土台として必ず意識すること）】
・運営会社は「強い田舎を作りたい」というビジョンを掲げ、電気を地域で創り地域で活かす「地消地産」を大切にしています
・単なる経済メリットの解説だけで終わらせず、お客様ご自身の暮らしが、少しずつ地域のエネルギー自立や持続可能な未来づくりにつながっていく、という温かみのある一文を自然に盛り込むこと
・押しつけがましいスローガンの羅列や大げさな社会貢献アピールにはせず、あくまでお客様の暮らしに寄り添う自然な言葉として触れる程度に留めること
・「地消地産」という言葉を使う場合はそのまま使ってよいが、無理に毎回使う必要はない`;

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
  const NUMBER_RULE = '・金額や年数などの数値を本文に書く場合は、上記【試算結果】または【お客様情報】に記載した数値だけを、記載どおりの桁でそのまま使うこと。それ以外の金額・kWh・%・年数などの数値を新たに計算したり、書き加えたり、推測したりしないこと';

  if (isNegative) {
    return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下の試算では、${d.warrantyYears || 20}年間のコスト差が電力会社よりも高くなる結果（マイナス）になりました。
これは提案書に載せる顧客向け文章ではなく、担当スタッフ向けの「注意喚起メモ」です。

【試算結果】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・${d.warrantyYears || 20}年間のコスト差：約${Math.abs(costDiffMan)}万円のマイナス（電力会社より高くなる試算）
・提案モード：${modeLabel}

【必ず含める内容】
・このままの条件ではコスト差がマイナスになり、プラン内容やシステム構成（太陽光容量・蓄電池容量・工事費・補助金条件など）の見直しが必要であること
・スタッフがお客様へどのように慎重にご案内・ご提案すべきか（数値を断定的に伝えない、前提条件次第で結果が変わる旨を丁寧に説明する、必要なら再シミュレーションを提案する、等）の具体的な助言

【条件】
・宛先はお客様ではなく社内スタッフである（お客様向けの共感・クロージング表現は使わない）
${NUMBER_RULE}
・日本語で120〜180文字程度
・出力は本文のみ。説明や見出し、鉤括弧は付けない`;
  }

  const monthlyBillSaving = Math.round(Number(d.monthlyBillSaving) || 0);
  const monthlyTotalMerit = Math.round(Number(d.monthlyTotalMerit) || 0);
  const selfConsumptionRate = Math.round(Number(d.selfConsumptionRate) || 0);
  const isHighSelfConsumption = selfConsumptionRate >= HIGH_SELF_CONSUMPTION_THRESHOLD;
  const HIGH_SELF_CONSUMPTION_RULE = isHighSelfConsumption
    ? `\n\n【自家消費率が高いお客様への追加ルール】\n・自家消費率${selfConsumptionRate}%は非常に優れた数値です。「自分の屋根で作った電気を自宅でたっぷり有効活用できている」ことを、効率の良さやクリーンな魅力として、また下記の「地消地産」の理念を体現する分かりやすい事例として文中に自然に盛り込んでアピールすること\n・自家消費率の数値（${selfConsumptionRate}%）を使う場合は、この値をそのまま使うこと`
    : '';

  const CHILD_FUTURE_STORY_RULE = hasChild(d.familyComposition)
    ? `\n\n【お子様がいるご家庭への追加ルール】\n・今すくすく育っているお子様たちが、これから10年・20年という長い年月をかけて成長していく未来の暮らしに、ずっと安心できるエネルギー基盤や家計の支えがあることの価値を、温かいトーンで一言触れること\n・「家族の未来の安心」と「地消地産による強い地域社会を子供たちに残していく」という2つの視点を自然につなげ、単なる家計節約の話で終わらせないこと\n・この未来への言及は、Ａ・Ｂいずれかの実際の金額や${d.warrantyYears || 20}年間のコスト差の数値と、違和感なく地続きの一文として書くこと（未来の話と数値の話を無関係に並べないこと）\n・原稿全体の文字数上限（100〜150文字）は変えないため、詰め込みすぎず簡潔にまとめること`
    : '';

  const PV_ONLY_BATTERY_TEASE_RULE = d.proposalMode === 'pv_only'
    ? `\n\n【太陽光のみモードへの追加ルール】\n・今回のご提案は太陽光のみであり、上記のコスト差や削減額はあくまで太陽光のみの数値であることを前提にすること\n・その上で、「ここに蓄電池が加われば、万が一の停電時にもご家族の日常を守る大きな安心の備えになる」という気づきを、押し売りにならない温かいトーンで一言だけ自然に添えること（蓄電池の金額・削減額・容量などの数値は一切書かないこと）\n・あくまで将来のオプション・選択肢としての示唆に留め、太陽光のみの提案内容や数値の説明が主役であることを崩さないこと`
    : '';

  return `あなたは太陽光発電・蓄電池の提案営業をサポートするアシスタントです。
以下のお客様情報をもとに、提案書の最終ページに掲載する「共感＆クロージングコメント」を1つ作成してください。

${COMPANY_VISION}

【お客様情報】
・お客様名：${d.customerName || '記載なし'}
・家族構成：${d.familyComposition || '記載なし'}
・ライフスタイル：${d.lifestyleNote || '記載なし'}
・現在の月間電気代：${d.monthlyElectricBill || 0}円
・Ａ：月々の電気代削減額（電気代が安くなる分のみ。売電収入は含まない）：${monthlyBillSaving}円/月
・Ｂ：月平均の総合経済メリット（買電削減＋売電収入をすべて含む合計額）：${monthlyTotalMerit}円/月
・${d.warrantyYears || 20}年間のコスト差：約${costDiffMan}万円（電力会社より安い）
・自家消費率（発電した電気のうち自宅で使えている割合）：${selfConsumptionRate}%
・提案モード：${modeLabel}

【金額の使い分けルール（厳守）】
・ＡとＢは意味が異なる別々の金額であり、絶対に混同・合算・言い換えをしないこと
・「電気代が安くなる」「電気代の負担が減る」という趣旨で金額に触れる場合は、必ずＡ（月々の電気代削減額）の数値だけを使うこと
・「売電収入も含めたトータルのお得額」「経済的メリット」という趣旨で金額に触れる場合は、必ずＢ（月平均の総合経済メリット）の数値だけを使うこと
・どちらの意味で使うか迷う場合や、単に「お得」「メリットがある」と触れるだけで金額を明示する必要がない場合は、金額の記載を省略してもよい
・ＡとＢを両方とも本文に書く必要はない。書く場合は1つの金額のみに絞ってもよい${HIGH_SELF_CONSUMPTION_RULE}${CHILD_FUTURE_STORY_RULE}${PV_ONLY_BATTERY_TEASE_RULE}

【条件】
・お客様の家族構成や暮らしに寄り添う共感の一言から始め、上記ビジョンを踏まえた温かみのある一文を経て、最後は導入への後押し・ご検討のお願いで締めくくる
・単なる経済メリットの解説で終わらせず、お客様の暮らしと地域の未来がつながっていく物語として仕上げること
${NUMBER_RULE}
・日本語で100〜150文字程度（厳守）
・絵文字は1つまで使用可（任意）
・出力はコメント本文のみ。説明や見出し、鉤括弧は付けない`;
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

// 送信元データから「使ってよい数値」を単位ごとに列挙（画面の実測値のみを許可）
function buildAllowedAmounts(d) {
  const costDiffMan = Math.abs(Number(d.costDiffMan) || 0);
  const monthlyBillSaving = Math.abs(Math.round(Number(d.monthlyBillSaving) || 0));
  const monthlyTotalMerit = Math.abs(Math.round(Number(d.monthlyTotalMerit) || 0));
  const monthlyElectricBill = Math.abs(Number(d.monthlyElectricBill) || 0);
  const warrantyYears = Number(d.warrantyYears) || 20;
  const selfConsumptionRate = Math.round(Number(d.selfConsumptionRate) || 0);
  return {
    '万円': new Set([costDiffMan]),
    '円': new Set([monthlyBillSaving, monthlyTotalMerit, monthlyElectricBill]),
    '年': new Set([warrantyYears]),
    '%': new Set([selfConsumptionRate]),
  };
}

// AI出力に、渡していない数値（架空の削減額・コスト差など）が混入していないか検証
function hasHallucinatedNumbers(comment, d) {
  const allowed = buildAllowedAmounts(d);
  return extractAmountTokens(comment).some(t => {
    const set = allowed[t.unit];
    if (!set || set.size === 0) return true; // 許可していない単位・数値は不正とみなす
    return ![...set].some(v => Math.abs(v - t.value) < 0.5);
  });
}

// AIが数値の整合性を保てなかった場合の、数値だけは確実に正しいフォールバック文
function buildFallbackComment(d, isNegative) {
  const warrantyYears = d.warrantyYears || 20;
  const costDiffMan = Number(d.costDiffMan) || 0;
  if (isNegative) {
    return `⚠️【スタッフ向け注意】${warrantyYears}年間のコスト差が約${Math.abs(costDiffMan)}万円のマイナス（電力会社より高くなる試算）です。プラン内容やシステム構成の見直しをご検討のうえ、お客様には数値を断定せず、前提条件次第で結果が変わる旨を丁寧にご説明ください。`;
  }
  const family = d.familyComposition ? `${d.familyComposition}の皆さまの暮らしに寄り添う` : '毎日の暮らしに寄り添う';
  const selfConsumptionRate = Math.round(Number(d.selfConsumptionRate) || 0);
  const selfConsumptionNote = selfConsumptionRate >= HIGH_SELF_CONSUMPTION_THRESHOLD
    ? `自家消費率${selfConsumptionRate}%と、自分の屋根で作った電気をしっかり自宅で使い切れている「地消地産」のクリーンなシステムです。`
    : '';
  return `${family}じぶん電気。${warrantyYears}年間で約${costDiffMan}万円、電力会社よりおトクになる見込みです。${selfConsumptionNote}地域でつくり、地域で活かす暮らしを、この機会にぜひご検討ください。`;
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
    const prompt = buildPrompt(d);
    const clean = (text) => (text || '').trim().replace(/^[「"']|[」"']$/g, '');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    let comment = clean(message.content[0].text);
    if (!comment) throw new Error('AI応答が空です');

    // 渡していない数値（架空の削減額・コスト差など）が混じっていたら、一度だけ厳格な指示で再生成
    if (hasHallucinatedNumbers(comment, d)) {
      console.warn('[generate-comment] 数値の不一致を検知、再生成します');
      const retryMessage = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `${prompt}\n\n【再生成の注意】前回の出力には、ここで指定していない数値が含まれていました。文中に数値を書く場合は上記に記載した数値だけを、記載どおりの桁でそのまま使い、他の数値は一切書かないでください。`,
        }],
      });
      const retryComment = clean(retryMessage.content[0].text);
      comment = (retryComment && !hasHallucinatedNumbers(retryComment, d))
        ? retryComment
        : buildFallbackComment(d, isNegative);
    }

    if (isNegative && !comment.startsWith('⚠️')) comment = `⚠️【スタッフ向け注意】${comment}`;

    return res.status(200).json({ comment, isNegative });
  } catch (err) {
    console.error('[generate-comment] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: 'コメントを生成できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}
