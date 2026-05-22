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

12ヶ月分ある場合: {"months":[{"bill":数値,"kwh":数値},... 計12件]}
1ヶ月分の場合: {"single":{"bill":数値,"kwh":数値}}

billは円（整数）、kwhはkWh（整数）。不明はnull。`;

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
    console.error('[analyze-bill]', err?.message ?? err);
    const status = err?.status === 400 ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? '解析できませんでした' : 'サーバーエラーが発生しました' });
  } finally {
    if (filePath) {
      try { unlinkSync(filePath); } catch {}
    }
  }
}
