// api/geo.js
// Geolocalização aproximada do visitante a partir dos headers NATIVOS da Vercel.
// Nenhum serviço externo, nenhuma chave de API, nenhuma permissão pedida ao usuário.
//
// O navegador do próprio lead chama GET /api/geo, então os headers de geo que a
// Vercel injeta na requisição são os do IP dele — nunca de um SDR ou do CRM.
//
// Devolve os valores JÁ NORMALIZADOS para uso na Meta (Conversions API):
//   city    -> minúsculo, sem acento, sem espaço/pontuação   "São Paulo"  -> "saopaulo"
//   state   -> UF minúscula                                  "SP"         -> "sp"
//   zip     -> somente dígitos                               "01310-000"  -> "01310000"
//   country -> ISO de duas letras, minúscula                 "BR"         -> "br"
// Qualquer dado indeterminável vira null. Nunca inventa localização.
//
// ATENÇÃO: a resposta é por-visitante, então NÃO pode ser cacheada. Sem o
// no-store abaixo, a CDN poderia servir a cidade de um lead para outro.

const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Headers da Vercel vêm percent-encoded (ex.: "S%C3%A3o%20Paulo")
function decodeHeader(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  try { return decodeURIComponent(v); } catch { return v; }
}

// Vercel usa "1" como marcador de valor desconhecido em alguns headers
const indefinido = (s) => s === null || s === '' || s === '1';

function normTexto(v) {
  const bruto = decodeHeader(v);
  if (indefinido(bruto)) return null;
  const s = semAcento(bruto).toLowerCase().replace(/[^a-z0-9]/g, '');
  return s || null;
}

function normZip(v) {
  const bruto = decodeHeader(v);
  if (indefinido(bruto)) return null;
  const s = bruto.replace(/\D/g, '');
  return s || null;
}

function normCountry(v) {
  const bruto = decodeHeader(v);
  if (indefinido(bruto)) return null;
  const s = semAcento(bruto).toLowerCase().replace(/[^a-z]/g, '');
  return s.length === 2 ? s : null;   // só aceita ISO-3166-1 alpha-2
}

export default function handler(req, res) {
  // Resposta individual de cada visitante: nunca cachear em CDN ou navegador
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  }

  const h = req.headers || {};
  const geo = {
    city:    normTexto(h['x-vercel-ip-city']),
    state:   normTexto(h['x-vercel-ip-country-region']),
    zip:     normZip(h['x-vercel-ip-postal-code']),
    country: normCountry(h['x-vercel-ip-country']),
  };

  // ?debug=1 mostra os headers crus — útil para conferir o deploy sem adivinhar
  if (req.query?.debug === '1' || (req.url || '').includes('debug=1')) {
    geo.debug = {
      'x-vercel-ip-city':           h['x-vercel-ip-city']           ?? null,
      'x-vercel-ip-country-region': h['x-vercel-ip-country-region'] ?? null,
      'x-vercel-ip-postal-code':    h['x-vercel-ip-postal-code']    ?? null,
      'x-vercel-ip-country':        h['x-vercel-ip-country']        ?? null,
    };
  }

  res.statusCode = 200;
  return res.end(JSON.stringify(geo));
}
