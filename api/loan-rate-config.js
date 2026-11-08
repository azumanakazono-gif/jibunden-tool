// Vercel server-side config endpoint. Never expose secrets here; the URL is a public read/write API endpoint.
export default function handler(req, res) {
  const endpoint = process.env.JIBUNDEN_LOAN_RATE_GAS_URL;
  if (!endpoint || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, error: 'loan-rate endpoint is not configured' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  return res.status(200).send('window.JIBUNDEN_LOAN_RATE_GAS_URL = ' + JSON.stringify(endpoint) + ';');
}
