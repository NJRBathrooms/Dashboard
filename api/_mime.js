// ============================================================
// Montagem da mensagem de e-mail (MIME) enviada pelo Gmail.
// Sem dependências, para ser testada fora da Vercel (scripts/test-email-mime.js).
//
// Por que existe: em 26/10/2026 um aviso de material ao Nilmar caiu no spam do
// iCloud. A mensagem era aceita pelo Gmail, mas somava sinais fracos de spam:
//   - remetente sem nome (só "adminnjrbathrooms@gmail.com");
//   - só versão HTML, sem versão em texto simples;
//   - corpo sem quebra de linha garantida (o relatório de pagamento chega a uma
//     linha só, acima do limite de 998 caracteres da norma de e-mail).
// Agora: remetente "NJR Bathrooms", multipart/alternative (texto + HTML) e cada
// parte em base64 com linhas de 76 caracteres.
// ============================================================

const NOME_REMETENTE = 'NJR Bathrooms';
const REMETENTE_PADRAO = 'adminnjrbathrooms@gmail.com';

// Cabeçalho com acento ou emoji vai codificado (RFC 2047); ASCII puro vai como está.
function codificarCabecalho(txt) {
  const s = String(txt == null ? '' : txt);
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

// base64 em linhas de 76 caracteres (limite da norma para essa codificação)
function base64Linhas(txt) {
  return Buffer.from(String(txt == null ? '' : txt), 'utf8').toString('base64').replace(/.{76}/g, m => m + '\r\n');
}

// Versão em texto simples a partir do HTML dos e-mails do sistema. Não precisa
// ser bonita — precisa ser legível em quem não mostra HTML e existir para o filtro.
function htmlParaTexto(html) {
  let s = String(html == null ? '' : html);
  s = s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '');
  // como no navegador: quebra de linha do código-fonte não é quebra de linha
  s = s.replace(/\s+/g, ' ');
  // link: "texto (endereço)", ou só o endereço quando o texto já é ele
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => {
    const h = href.replace(/&amp;/g, '&');
    const t = txt.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    return t && t !== h ? t + ' (' + h + ')' : h;
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ');
  s = s.replace(/<hr[^>]*>/gi, '\n----\n');
  s = s.replace(/<\/(td|th)>/gi, ' · ');
  s = s.replace(/<\/(p|div|h[1-6]|tr|ul|ol|table|blockquote)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim().replace(/^·\s*|\s*·$/g, '').trim()).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Mensagem completa, pronta para o Gmail (ele acrescenta Date e Message-ID).
// opts: { from, boundary } — só para teste; em produção usa o padrão.
function montarMensagem(to, subject, body, html, opts = {}) {
  const from = opts.from || process.env.GMAIL_FROM || REMETENTE_PADRAO;
  const topo = [
    'From: ' + codificarCabecalho(NOME_REMETENTE) + ' <' + from + '>',
    'To: ' + to,
    'Subject: ' + codificarCabecalho(subject),
    'MIME-Version: 1.0',
  ];
  if (!html) {
    return topo.concat([
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Linhas(body),
    ]).join('\r\n');
  }
  // "_" não existe no alfabeto base64: o separador nunca colide com o conteúdo
  const b = opts.boundary || ('=_njr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
  return topo.concat([
    'Content-Type: multipart/alternative; boundary="' + b + '"',
    '',
    '--' + b,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(htmlParaTexto(body)),
    '--' + b,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Linhas(body),
    '--' + b + '--',
    '',
  ]).join('\r\n');
}

module.exports = { montarMensagem, htmlParaTexto, codificarCabecalho, base64Linhas, NOME_REMETENTE, REMETENTE_PADRAO };
