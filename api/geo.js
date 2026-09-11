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

// IP do lead, lido da requisicao que chegou na Vercel — nunca de algo que o
// navegador mande. Precedencia:
//   1) x-real-ip           — e EXATAMENTE o header que o ipAddress() do
//                            @vercel/functions le (IP_HEADER_NAME = "x-real-ip").
//                            Nao usamos o helper porque ele chama headers.get(),
//                            metodo de Headers; aqui req.headers e objeto simples
//                            do Node e o helper lancaria TypeError. Alem disso
//                            exigiria uma dependencia nova, e o npm install do
//                            build ja quebrou o deploy uma vez.
//   2) x-vercel-forwarded-for — cadeia da propria Vercel
//   3) x-forwarded-for        — primeiro item (o cliente real)
// Valor cru: sem hash, sem mascara, sem converter IPv6 para IPv4.
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

function ipValido(s) {
  if (!s) return false;
  if (IPV4.test(s)) return s.split('.').every(o => Number(o) <= 255);
  // IPv6 precisa de ao menos um ':' e nao pode ser so pontuacao
  return IPV6.test(s) && s.includes(':') && /[0-9a-f]/i.test(s);
}

function clientIp(h) {
  const candidatos = [
    h['x-real-ip'],
    h['x-vercel-forwarded-for'],
    (h['x-forwarded-for'] || '').split(',')[0],   // primeiro = cliente real
  ];
  for (const bruto of candidatos) {
    if (typeof bruto !== 'string') continue;
    let ip = bruto.trim();
    // IPv4 as vezes chega com porta ("1.2.3.4:5678"); IPv6 pode vir em colchetes
    if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined);
    else if ((ip.match(/:/g) || []).length === 1) ip = ip.split(':')[0];
    if (ipValido(ip)) return ip;
  }
  return null;
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
    // IP cru do lead, para a Conversions API da Meta (user_data.client_ip_address)
    client_ip_address: clientIp(h),
  };

  res.statusCode = 200;
  return res.end(JSON.stringify(geo));
}
