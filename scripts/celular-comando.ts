// Comando de punto de entrada del celular de Neru (PLAN §3.15): `/celular` abre la Actividad de la app de Neru.
// Es un comando GLOBAL de tipo 4 (PRIMARY_ENTRY_POINT) con handler 2 (DISCORD_LAUNCH_ACTIVITY): Discord abre la
// Actividad solo, sin que el bot responda. Los demás comandos de los bots son del servidor (applicationGuildCommands),
// así que este no se pisa al reiniciar.  npm run celular:comando
import { REST, Routes } from "discord.js";
import { loadConfig, loadDotEnv } from "../src/config";

loadDotEnv();
const config = loadConfig();
const token = config.tokens.neru;
const rest = new REST().setToken(token);
const app = (await rest.get(Routes.currentApplication())) as { id: string };

const cuerpo = {
  name: "celular",
  description: "Abre el celular de Neru: Vocaloidle, Silueta, tu tarjeta y más.",
  type: 4,
  handler: 2,
  integration_types: [0],
  contexts: [0],
};

const globales = (await rest.get(Routes.applicationCommands(app.id))) as { id: string; name: string; type: number }[];
const actual = globales.find((c) => c.type === 4);
if (actual) {
  await rest.patch(Routes.applicationCommand(app.id, actual.id), { body: cuerpo });
  console.log(`✔ comando de entrada actualizado: /${cuerpo.name} (antes /${actual.name})`);
} else {
  await rest.post(Routes.applicationCommands(app.id), { body: cuerpo });
  console.log(`✔ comando de entrada creado: /${cuerpo.name}`);
}
