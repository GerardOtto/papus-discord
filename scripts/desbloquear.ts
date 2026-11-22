// Le da a un Papu todos los objetos del catálogo (pedido de GyroP, 13 nov. 2026: «desbloquéame toda la tienda, solo a
// mi usuario, no a mi rol»). Solo adorno (regla 1): no da monedas, XP ni cuota. Lo que ya tenía no se toca.
// Uso (en la nube, donde está la base): nube\nube.cmd npm desbloquear <id de usuario de Discord>
//      sin id: el dueño (OWNER_USER_ID de .env).
import path from "node:path";
import { loadConfig, loadDotEnv } from "../src/config";
import { CoinService } from "../src/coins/service";
import { loadCatalog, loadCoinSettings } from "../src/coins/rules";
import { openDb } from "../src/db/database";

loadDotEnv();
const config = loadConfig();
const userId = process.argv[2]?.trim() || config.ownerId;
if (!userId || !/^\d{15,22}$/.test(userId)) throw new Error("Falta el id de Discord del Papu (o OWNER_USER_ID en .env)");
const db = openDb(path.join(config.dataDir, "papus.sqlite"));
const catalog = loadCatalog();
const coins = new CoinService({ db, settings: loadCoinSettings(), catalog, timeZone: config.quotaTimeZone });
let nuevos = 0;
for (const o of catalog) if (coins.grant(userId, o.id, "desbloqueo de GyroP")) nuevos++;
db.close();
console.log(`${userId}: ${nuevos} objetos nuevos (ya tenía ${catalog.length - nuevos}; ${catalog.length} en el catálogo)`);
