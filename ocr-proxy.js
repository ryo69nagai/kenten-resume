/* APIキーはNetlify管理画面の環境変数「OCR_API_KEY」から取得。
   設定場所: Netlify → Site settings → Environment variables → OCR_API_KEY */
const OCR_API_KEY = process.env.OCR_API_KEY || '';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!OCR_API_KEY) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'OCR_API_KEY環境変数が設定されていません' } }) };
  }
  try {
    const body = JSON.parse(event.body);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': OCR_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: body.model || 'claude-haiku-4-5-20251001',
        max_tokens: body.max_tokens || 4096,
        messages: body.messages
      })
    });
    const data = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: data
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
  }
};
