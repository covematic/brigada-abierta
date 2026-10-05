// Punto de entrada: base de datos + migraciones + datos iniciales + servidor HTTP.
// Uso: npm run dev  →  http://localhost:5173
import { createServer } from 'node:http';
import { env, assertProductionConfig } from './api/config.js';
import { createDb } from './api/db.js';
import { migrate } from './api/migrate.js';
import { seed } from './api/seed.js';
import { createApp } from './api/app.js';

assertProductionConfig();

const db = await createDb();
await migrate(db, console.log);
await seed(db, { log: console.log });

const server = createServer(createApp({ db }));
server.listen(env.port, () => {
  console.log(`Brigada Abierta → http://localhost:${env.port}`);
  console.log(`Base de datos: ${db.kind} · Pagos: ${env.paymentsMode} · Cifras referenciales: ${env.demoData ? 'sí' : 'no'}`);
});

// Cierre ordenado (Render envía SIGTERM al redeplegar).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}
