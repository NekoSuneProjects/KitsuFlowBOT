import express from 'express';
import path from 'node:path';

// Login/dashboard pages, build info, and the static public/ folder (registered last).
export function registerPages(app) {
  app.get('/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    return req.session.uid
      ? res.sendFile(path.resolve('public/dashboard.html'))
      : res.redirect('/login');
  });
  app.get('/login', (req, res) =>
    req.session.uid ? res.redirect('/dashboard') : res.sendFile(path.resolve('public/login.html'))
  );
  app.get('/api/build-info', (req, res) =>
    res.set('Cache-Control', 'no-store').json({
      version: process.env.GITHUB_SHA || process.env.APP_VERSION || 'local',
      providers: ['twitch', 'kick', 'vpzone', 'nekolive', 'beam']
    })
  );
  app.use(
    express.static('public', {
      index: 'index.html',
      redirect: false,
      setHeaders: (res, file) => {
        // Studio modules and the dashboard shell must never be served stale after a deploy.
        if (/[\\/]studio[\\/].+\.js$|dashboard\.html$/.test(file))
          res.setHeader('Cache-Control', 'no-store, max-age=0');
      }
    })
  );
}
