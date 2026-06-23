module.exports = async function handler(req, res) {
  try {
    const url = process.env.APPS_SCRIPT_URL + '?action=readAll';
    await fetch(url);
  } catch (_) {}
  res.status(200).json({ ok: true });
};
