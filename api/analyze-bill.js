import { formidable } from 'formidable';
import { readFileSync, unlinkSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

export const config = { api: { bodyParser: false } };

const ALLOWED_ORIGINS = new Set([
  'https://azumanakazono-gif.github.io',
]);

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const PROMPT = `この電気料金明細書から情報を抽出してください。
JSONのみ返してください（説明不要）。

【重要】季節区分（春季/夏季/秋季/冬季、平日/休日など）が含まれる場合は
同じ時間帯の使用量をすべて合算してください。
例: 昼間（春季/平日）150kWh + 昼間（夏季/平日）200kWh + 昼間（休日）80kWh → tou0=430

時間帯の割り当て:
・季時別/おひさま系プラン → tou0=昼間合計, tou1=朝夕(リビング/シフト)合計, tou2=夜間合計
・電化でナイト系プラン   → tou0=平日デイ合計, tou1=休日デイ合計, tou2=夜間合計
・時間帯区分なし         → tou0/tou1/tou2はnull

12ヶ月分ある場合:
{"months":[{"bill":円整数,"kwh":合計kWh整数,"tou0":kWh整数orNull,"tou1":kWh整数orNull,"tou2":kWh整数orNull},... 計12件]}

1ヶ月分の場合:
{"single":{"bill":円整数,"kwh":合計kWh整数,"tou0":kWh整数orNull,"tou1":kWh整数orNull,"tou2":kWh整数orNull}}

kwhは全時間帯の合計kWh（tou0+tou1+tou2と一致させること）。不明はnull。`;

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[analyze-bill] ANTHROPIC_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーが発生しました' });
  }

  const form = formidable({ maxFileSize: MAX_FILE_SIZE, maxFiles: 1 });
  let filePath;

  try {
    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) return res.status(400).json({ error: 'ファイルが見つかりません' });
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return res.status(400).json({ error: 'PDF・JPG・PNG のみ対応しています' });
    }

    filePath = file.filepath;
    const base64 = readFileSync(filePath).toString('base64');

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const mediaBlock = file.mimetype === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: base64 } };

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: PROMPT }] }],
    });

    const text = message.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI応答にJSONが含まれていません');

    return res.status(200).json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[analyze-bill] error:', err?.status, err?.message ?? err);
    if (err?.status === 401) return res.status(500).json({ error: 'API認証エラー: ANTHROPIC_API_KEYを確認してください' });
    if (err?.status === 400) return res.status(400).json({ error: '解析できませんでした' });
    return res.status(500).json({ error: 'サーバーエラーが発生しました' });
  } finally {
    if (filePath) {
      try { unlinkSync(filePath); } catch {}
    }
  }
}
