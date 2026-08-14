const ALLOWED = [
  'api.bcb.gov.br',
  'servicodados.ibge.gov.br',
  'dados.cvm.gov.br',
  'balanca.mdic.gov.br',
  'apidatalake.tesouro.gov.br'
];

export const handler = async (event) => {
  const raw = event.queryStringParameters?.url;
  if (!raw) return { statusCode: 400, body: 'URL ausente' };
  let url;
  try { url = new URL(raw); } catch { return { statusCode: 400, body: 'URL inválida' }; }
  if (url.protocol !== 'https:' || !ALLOWED.includes(url.hostname)) return { statusCode: 403, body: 'Fonte não permitida' };
  try {
    const start = Number(event.queryStringParameters?.start);
    const end = Number(event.queryStringParameters?.end);
    const ranged = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end - start <= 2_500_000;
    const headers = { 'User-Agent': 'RotaDadosBrasil/2.0' };
    if (ranged) headers.Range = `bytes=${start}-${end}`;
    const upstream = await fetch(url.toString(), { headers });
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!upstream.ok) return { statusCode: upstream.status, body: `Fonte respondeu ${upstream.status}` };
    const bytes = Buffer.from(await upstream.arrayBuffer());
    return {
      statusCode: upstream.status,
      isBase64Encoded: true,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.length),
        ...(upstream.headers.get('content-range') ? { 'Content-Range': upstream.headers.get('content-range') } : {}),
        ...(upstream.headers.get('etag') ? { ETag: upstream.headers.get('etag') } : {}),
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=86400',
        'Netlify-CDN-Cache-Control': 'public, durable, max-age=86400, stale-while-revalidate=604800'
      },
      body: bytes.toString('base64')
    };
  } catch (error) {
    return { statusCode: 502, body: 'A fonte não respondeu.' };
  }
};
