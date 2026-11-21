import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';

// Express app with body parsers (raw body kept for signed webhooks) and SQLite-backed sessions.
export function createExpressApp(BASE) {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, res, buffer) => {
        if (req.path === '/webhooks/kick' || req.path.startsWith('/webhooks/payments/patreon/'))
          req.rawBody = Buffer.from(buffer);
      }
    })
  );
  const Store = SQLiteStoreFactory(session);
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use(
    session({
      store: new Store({ db: 'sessions.sqlite', dir: 'data' }),
      name: 'sn.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: BASE.startsWith('https:'),
        maxAge: 86400000
      }
    })
  );
  return app;
}

// Session guard, same-origin CSRF check and async error wrapper used by most routes.
export function createHttpGuards(BASE) {
  const withUser = (req, res, next) =>
    req.session.uid ? next() : res.status(401).json({ error: 'Login required' });
  const csrf = (req, res, next) => {
    if (req.get('origin') !== BASE) return res.status(403).json({ error: 'Origin mismatch' });
    next();
  };
  const safe = fn => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(e => res.status(400).json({ error: e.message }));
  return { withUser, csrf, safe };
}
