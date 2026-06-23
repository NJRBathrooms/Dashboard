// Aquece a função e a autenticação Google (troca refresh_token por access_token)
// enquanto o usuário digita a senha, para a 1ª chamada real sair mais rápida.
// Faz só uma leitura de metadados (timezone) — não expõe nenhum dado da planilha.
// (redeploy: aplica as variáveis de ambiente Google recém-adicionadas)
const { sheetsApi, SPREADSHEET_ID } = require('./_google');

module.exports = async function handler(req, res) {
  try {
    await sheetsApi().spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'properties.timeZone',
    });
  } catch (_) {}
  res.status(200).json({ ok: true });
};
