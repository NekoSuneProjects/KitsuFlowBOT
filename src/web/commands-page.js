// Public /commands/<channel> page listing the channel's enabled global and custom commands.
export function registerCommandsPage(app, { db, globalCommands }) {
  const { globalListing } = globalCommands;
  app.get('/commands/:login', (req, res) => {
    const login = String(req.params.login || '').toLowerCase();
    const ch = db.prepare('SELECT id,login FROM channels WHERE LOWER(login)=?').get(login);
    if (!ch) return res.status(404).send('Channel not found');
    const escape = s =>
      String(s).replace(
        /[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
      );
    const custom = db
      .prepare('SELECT name,level,response FROM commands WHERE channel=? ORDER BY name')
      .all(ch.id);
    const globals = globalListing(ch.id).filter(x => x.enabled);
    const lines = [
      ...globals.map(x => ({ name: x.name, level: x.level, description: x.description })),
      ...custom.map(x => ({ name: x.name, level: x.level, description: x.response }))
    ];
    res
      .type('html')
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
          escape(ch.login) +
          ' commands • KitsuFlowBOT</title><style>body{font:16px system-ui;background:#0b111b;color:#f2f7fd;margin:0;padding:32px}main{max-width:850px;margin:auto}h1{color:#48e4c2}section{padding:16px;border:1px solid #304354;background:#151f2d;border-radius:12px;margin:10px 0}small{color:#a9bdca}</style><main><h1>' +
          escape(ch.login) +
          ' commands</h1><p>Enabled global and custom commands for this channel.</p>' +
          lines
            .map(
              x =>
                '<section><strong>!' +
                escape(x.name) +
                '</strong> <small>(' +
                escape(x.level) +
                ')</small><p>' +
                escape(x.description) +
                '</p></section>'
            )
            .join('') +
          '</main></html>'
      );
  });
}
