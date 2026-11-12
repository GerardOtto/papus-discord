# Arquitectura objetivo de la Plaza

## Principio

La Plaza 3D es una segunda interfaz del servidor de Discord, no un servidor paralelo. Discord y la Plaza deben consultar y ejecutar las mismas reglas de negocio. El backend central es la fuente de verdad para identidad, XP, nivel, cuota, monedas, inventario, ruleta, pesca y mercado.

El aislamiento de ramas, previews y despliegues es una medida de seguridad operativa. No define el modelo funcional del producto.

## Estado actual en `feature/plaza-beta`

Hay dos puentes deliberadamente distintos:

- `mundo`: conecta el Worker principal con los servicios reales de Discord. Sus handlers usan `LevelService`, `RouletteService`, `CoinService` y `MercadoService`.
- `mundoPreview`: conecta el Worker de preview con un D1 separado. Las lecturas iniciales parten de SQLite en modo solo lectura y las acciones escriben en `EconomiaPlazaPreview`, un ledger sandbox con CAS.

Esto permite probar mecánicas sin afectar saldos reales, pero no constituye la arquitectura final de sincronización. En particular, un ledger que conserva una copia inicial no puede garantizar que cada cambio posterior hecho desde Discord se refleje inmediatamente en ese ledger.

## Arquitectura objetivo

1. **Una sola autoridad de negocio.** Los servicios del bot conservan las reglas y los datos canónicos. La interfaz 3D no calcula ni mantiene una segunda economía.
2. **Acciones compartidas.** Cada interacción de la Plaza se convierte en un comando tipado con usuario, acción, datos validados e identificador idempotente. El backend ejecuta la misma operación que usaría Discord.
3. **Eventos de salida.** Los cambios confirmados emiten eventos persistentes (XP, nivel, monedas, inventario, tiradas, premios, estado de actividades). La Plaza consume esos eventos y actualiza su representación.
4. **Lecturas actuales.** Los perfiles, saldos y estados de las zonas se obtienen del estado canónico; los snapshots son una optimización con versión/fecha, no una fuente de verdad alternativa.
5. **Recuperación segura.** Las acciones deben tener idempotencia de extremo a extremo. Si el proceso cae entre el commit de negocio y la respuesta al navegador, la repetición del mismo identificador devuelve el resultado original sin volver a cobrar ni conceder recompensas.
6. **Tiempo real con degradación controlada.** WebSocket distribuye presencia, posiciones y eventos a los clientes conectados. Si se pierde conexión, el cliente vuelve a solicitar un snapshot/versionado y continúa desde el último cursor confirmado.

## Reglas de consistencia

- La Plaza nunca modifica directamente la base de datos de negocio desde el navegador.
- El Worker valida identidad, permisos, forma y tamaño del comando; el backend de Discord valida de nuevo y ejecuta la regla de negocio.
- Una respuesta visual de éxito solo se envía después de confirmar la transacción.
- La cola de eventos es durable, ordenada por cursor y deduplicable.
- Los eventos de presencia/movimiento pueden ser efímeros; los eventos económicos y de progresión no.
- Las compras, premios, consumibles, regalos y capturas deben ser atómicos respecto de sus efectos y del registro de idempotencia.
- No se sincronizan secretos, tokens de OAuth, cuotas privadas de otros usuarios ni datos no públicos.

## Migración sin duplicar sistemas

1. Mantener el preview actual para validar interfaz, sesiones, movimiento y concurrencia sin tocar producción.
2. Extraer contratos de comandos/eventos compartidos y añadir pruebas de contrato para ambos transportes.
3. Sustituir progresivamente los handlers económicos sandbox por llamadas al mismo servicio de aplicación que usa Discord; no copiar reglas a Worker.
4. Añadir idempotencia persistente a las operaciones de negocio antes de habilitar escrituras reales desde la Plaza.
5. Conectar snapshots/eventos de la Plaza al estado canónico y comprobar convergencia tras reconexiones y reinicios.
6. Habilitar el modo integrado solo mediante configuración explícita y despliegue revisado. No reutilizar automáticamente el D1 de producción ni desplegarlo desde el flujo de preview.

## Criterios de aceptación

- Una acción iniciada en Discord se refleja en la Plaza sin recargar la página.
- Una acción iniciada en la Plaza produce el mismo resultado y las mismas reglas que su equivalente de Discord.
- Dos acciones simultáneas no duplican compras, XP, premios ni consumibles.
- Una respuesta perdida o un reinicio no duplican efectos al reintentar.
- Tras desconectar y reconectar, el cliente converge al estado canónico.
- Los datos privados solo se entregan al propio usuario.
- Los tests y el preview no escriben en producción.
