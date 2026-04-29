const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'auvo-social-webhook-2026';

function igPost(path, params) {
  return new Promise((resolve) => {
    const query = new URLSearchParams(params).toString();
    console.log(`[igPost] POST /v21.0/${path}`);
    console.log(`[igPost] token prefix: ${(params.access_token||'').substring(0,20)}`);
    console.log(`[igPost] token length: ${(params.access_token||'').length}`);
    const options = { hostname: 'graph.facebook.com', path: `/v21.0/${path}?${query}`, method: 'POST' };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        console.log(`[igPost] response: ${d}`);
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: 'inválido' }); }
      });
    });
    req.on('error', (e) => { console.log(`[igPost] request error: ${e.message}`); resolve({ error: 'falhou' }); });
    req.end();
  });
}

async function gerarResposta(text, username) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const prompt = `Você é o agente de Instagram da Auvo Tecnologia, software B2B de gestão de equipes externas e serviços de campo.\n\nComentário:\nUsuário: @${username}\nTexto: "${text}"\n\nResponda em JSON:\n{"confianca":"alta"|"baixa","resposta":"texto (máx 200 chars, profissional, caloroso, 1 emoji máximo)"}\n\nRegras: elogio→agradecer; reclamação→empatia+convida DM; jurídico/ofensivo→confianca baixa.\nResponda APENAS o JSON.`;
  const body = JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] });
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { const p = JSON.parse(d); resolve(JSON.parse((p.content?.[0]?.text||'').replace(/```json|```/g,'').trim())); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.status(403).send('Verificação falhou');
});

app.post('/webhook', async (req, res) => {
  res.status(200).json({ status: 'ok' });
  const body = req.body;
  if (body.object !== 'instagram') return;
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  for (const entry of (body.entry || [])) {
    for (const change of (entry.changes || [])) {
      if (change.field === 'comments') {
        const { id: commentId, text, from } = change.value || {};
        if (!commentId || !text || from?.id === accountId) continue;
        console.log(`Comentário de @${from?.username}: ${text}`);
        const resposta = await gerarResposta(text, from?.username || 'usuario');
        if (!resposta) { console.log('IA sem resposta'); continue; }
        if (resposta.confianca === 'alta') {
          const r = await igPost(`${commentId}/replies`, {
            message: resposta.resposta,
            access_token: process.env.INSTAGRAM_ACCESS_TOKEN
          });
          if (r.error) console.log('Erro:', JSON.stringify(r.error));
          else console.log(`Respondido: ${resposta.resposta}`);
        } else {
          console.log(`Baixa confiança — não respondido automaticamente`);
        }
      }
    }
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
