import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate, requireRole, HttpError, createUser } from './auth.js';
import { get } from './db.js';
import { initPush } from './realtime.js';
import { startJobs } from './jobs.js';
import common from './routes/common.js';
import { establishmentsRouter, establishmentGuard, coreRouter } from './routes/r-core.js';
import invoices from './routes/r-invoices.js';
import foodcost from './routes/r-foodcost.js';
import haccp from './routes/r-haccp.js';
import team from './routes/r-team.js';
import { ordersRouter, marketingRouter, contactRouter, supportRouter } from './routes/r-misc.js';
import collaborateur from './routes/collaborateur.js';
import comptable from './routes/comptable.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(authenticate);

const api = express.Router();
api.use(common);

// Espace restaurateur
const r = express.Router();
r.use(requireRole('restaurateur'));
r.use('/establishments', establishmentsRouter);
r.use(contactRouter);
const est = express.Router({ mergeParams: true });
est.use(establishmentGuard);
for (const sub of [coreRouter, invoices, foodcost, haccp, team, ordersRouter, marketingRouter]) est.use(sub);
r.use('/e/:estId', est);
api.use('/r', r);

api.use('/c', requireRole('collaborateur'), collaborateur);
api.use('/comptable', requireRole('comptable'), comptable);
api.use('/support', requireRole('support'), supportRouter);
api.use((_req, _res, next) => next(new HttpError(404, 'Ressource introuvable.')));
app.use('/api', api);

// Application web (build Vite)
const dist = process.env.MIZU_CLIENT_DIST || path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, {
    index: false,
    setHeaders: (res, file) => {
      if (file.endsWith('sw.js') || file.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Fichier trop volumineux (15 Mo maximum).' });
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur.' : err.message });
});

// Premier démarrage : création du premier compte comptable à partir des variables d'environnement.
if (!get('SELECT id FROM users LIMIT 1')) {
  const { MIZU_ADMIN_EMAIL: email, MIZU_ADMIN_PASSWORD: password } = process.env;
  if (email && password) {
    createUser({ email, password, first_name: process.env.MIZU_ADMIN_NAME || 'Comptable', role: 'comptable', company: process.env.MIZU_ADMIN_COMPANY || null });
    console.log(`Compte comptable créé : ${email}`);
  } else {
    console.log('Base vide : lancez « npm run seed » (démonstration) ou définissez MIZU_ADMIN_EMAIL et MIZU_ADMIN_PASSWORD pour créer le premier compte comptable.');
  }
}

initPush();
startJobs();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Mizu écoute sur http://localhost:${port}`));
