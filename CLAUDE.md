# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backend personal (no comercial) de una app de recordatorios y correos.

- **Backend**: NestJS + Prisma 7 + PostgreSQL (Supabase)
- **Frontend futuro**: React Native + Expo (aún no existe en este repo)
- ESM puro: `package.json` tiene `"type": "module"`, `tsconfig.json` usa `module`/`moduleResolution: "nodenext"`. **Todo import relativo debe terminar en `.js`** (ej. `import { AppService } from './app.service.js'`), aunque el archivo fuente sea `.ts`. Esto lo exige el propio compilador en modo nodenext, no es opcional.

## Comandos

```bash
npm run start:dev      # servidor con watch (desarrollo)
npm run build           # nest build -> dist/
npm run start:prod      # node dist/main (requiere build previo)
npm run lint             # oxlint src/ test/
npm run format           # prettier --write

npm test                 # vitest run (unit)
npm run test:watch       # vitest en modo watch
npm run test:cov         # vitest con cobertura
npm run test:e2e         # vitest run --config ./vitest.config.e2e.ts

npx prisma generate       # regenerar el cliente tras editar schema.prisma
npx prisma migrate dev    # crear/aplicar migración en desarrollo (usa DIRECT_URL)
npx prisma studio         # explorar la base de datos
```

Para correr un solo test con vitest: `npx vitest run ruta/al/archivo.spec.ts` (o `-t "nombre del test"`).

## Base de datos: Prisma 7 + Supabase

Prisma 7 cambió su arquitectura respecto a versiones anteriores — **no asumas el comportamiento de Prisma 5/6**:

- La configuración del CLI (migraciones, `db push`, `studio`) vive en **`prisma7.config.ts`** (no en `schema.prisma`). Ahí se lee `DIRECT_URL` para conectar directo a Postgres (las migraciones no funcionan bien a través de PgBouncer).
- `prisma/schema.prisma` **ya no acepta `url`/`directUrl` en el bloque `datasource`** (Prisma 7 lo rechaza con error de validación). Solo declara `provider = "postgresql"`.
- El cliente en runtime (`PrismaService`, en [src/prisma/prisma.service.ts](src/prisma/prisma.service.ts)) se conecta con un **driver adapter** (`@prisma/adapter-pg` + `pg`), pasando `DATABASE_URL` (la conexión *pooled* vía PgBouncer, puerto 6543) al constructor de `PrismaClient`. Este es el patrón oficial de Prisma 7 para Postgres — no hay motor de conexión implícito basado en la URL del schema.
- El cliente generado (`npx prisma generate`) se escribe como **TypeScript fuente** (no JS compilado) en `src/generated/prisma/` (ver `generator client { output = "../src/generated/prisma" }` en el schema). Esa carpeta está en `.gitignore` y debe regenerarse localmente tras clonar o tras cualquier cambio de schema.

### Variables de entorno (`.env`, ver `.env.example`)

- `DATABASE_URL`: Transaction pooler de Supabase (host `aws-0-<region>.pooler.supabase.com`, puerto 6543) — la usa la app en runtime vía el driver adapter.
- `DIRECT_URL`: Session pooler de Supabase (mismo host, puerto 5432) — la usa el CLI de Prisma para migraciones.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`: credenciales de la API de Supabase. `SUPABASE_URL` y `SUPABASE_JWKS_URL` los usa `SupabaseAuthGuard` (ver abajo) para validar JWTs. `SUPABASE_SECRET_KEY` no lo usa el código — es la clave admin de Supabase Auth, solo para operaciones administrativas manuales (crear/confirmar/borrar usuarios vía la Admin API), nunca debe usarse desde el cliente ni exponerse en un endpoint.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: credenciales de Web Push para notificaciones (ver sección Notificaciones push). Se generan una sola vez con `npx web-push generate-vapid-keys`.
- `GEMINI_API_KEY`: la usa `AsistenteService` para interpretar lenguaje natural en Vínculo (ver sección Asistente Vínculo). Gratis en Google AI Studio.

**Importante — por qué se usa el pooler y no la conexión directa**: `db.<project-ref>.supabase.co` (la conexión "directa" de Supabase) solo resuelve por **IPv6**; si la red no tiene salida IPv6 (caso común en muchas redes domésticas/ISP), Prisma falla con `P1001: Can't reach database server`. La solución es usar el pooler de Supabase (Supavisor), que sí es compatible con IPv4, con usuario en formato `postgres.<project-ref>` en vez de `postgres`. El host exacto (`aws-0-<region>...`) depende de la región del proyecto y se obtiene desde el dashboard de Supabase en **Project Settings → Database → Connection string**.

## Modelo de datos

Cinco modelos en [prisma/schema.prisma](prisma/schema.prisma). `Lista → Categoria → Recordatorio` forman la jerarquía principal (cascada de borrado: eliminar una Lista borra sus Categorias, eliminar una Categoria borra sus Recordatorios); `PushSubscription` y `CuentaGmail` son independientes (no cuelgan de un usuario — ver secciones Notificaciones push e Ingesta de correos):

- **Lista** (`id`, `nombre`) — ej. "Personal", "Trabajo".
- **Categoria** (`id`, `nombre`, `listaId`) — pertenece a una Lista.
- **Recordatorio** (`id`, `titulo`, `descripcion?`, `fechaLimite?`, `prioridad`, `estado`, `origen`, `monto?`, `banco?`, `notificadoEn?`, `categoriaId`) — pertenece a una Categoria.
- **PushSubscription** (`id`, `endpoint` único, `p256dh`, `auth`) — una fila por dispositivo/navegador suscrito a notificaciones push.
- **CuentaGmail** (`id`, `email` único, `refreshToken`) — una fila por cuenta de Gmail conectada a la ingesta de correos (ver sección Ingesta de correos).

`prioridad`, `estado` y `origen` son enums de Prisma (`Prioridad`, `EstadoRecordatorio`, `OrigenRecordatorio` en el schema) en vez de strings libres, para tener tipado fuerte de punta a punta (DTOs de NestJS incluidos). `origen` distingue si el recordatorio vino de `CORREO`, `VOZ` o `MANUAL`. Estos valores fueron una decisión de diseño al construir el proyecto — si no encajan con el uso real, es más simple ajustarlos ahora que después de tener datos.

`monto` (Float) y `banco` (String, texto libre) solo tienen sentido en recordatorios de pago — no hay un campo `tipo`/flag que distinga "recordatorio de pago" de uno normal; su sola presencia (no-null) es lo que indica que aplica. `monto` se valida como número positivo (`@IsPositive()` en el DTO).

## Arquitectura del backend

Un módulo de Nest por recurso, todos siguiendo el mismo patrón (`*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/create-*.dto.ts` + `dto/update-*.dto.ts` con `PartialType`):

- [src/prisma/](src/prisma/) — `PrismaModule` es `@Global()`; `PrismaService` extiende el `PrismaClient` generado y gestiona el ciclo de vida (`$connect`/`$disconnect` en `onModuleInit`/`onModuleDestroy`). Cualquier otro módulo puede inyectar `PrismaService` sin importarlo explícitamente.
- [src/listas/](src/listas/), [src/categorias/](src/categorias/), [src/recordatorios/](src/recordatorios/) — CRUD REST estándar (`POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`). `GET /categorias` acepta `?listaId=`, `GET /recordatorios` acepta `?categoriaId=` y `?estado=`.
- Los services validan la existencia del padre antes de crear/actualizar (ej. `CategoriasService` verifica que `listaId` exista, `RecordatoriosService` verifica que `categoriaId` exista) y lanzan `NotFoundException` si no.
- `main.ts` registra un `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`) — los DTOs con `class-validator` son la única superficie de validación de entrada.

## Autenticación

Toda la API está protegida por defecto por `SupabaseAuthGuard` ([src/auth/supabase-auth.guard.ts](src/auth/supabase-auth.guard.ts)), registrado como `APP_GUARD` global en [src/auth/auth.module.ts](src/auth/auth.module.ts). Valida el JWT del header `Authorization: Bearer <token>` contra el JWKS de Supabase (`SUPABASE_JWKS_URL`) usando `jose`, y verifica que el `issuer` sea `${SUPABASE_URL}/auth/v1`. Si es válido, adjunta el payload en `request.user`.

- Para exponer una ruta sin autenticación, usar el decorator `@Public()` ([src/auth/public.decorator.ts](src/auth/public.decorator.ts)) — así está marcado `GET /` (health check).
- No hay lógica de autorización por usuario todavía (los modelos no tienen `userId`): cualquier JWT válido de Supabase de este proyecto puede leer/escribir todos los recordatorios. Es aceptable para uso personal de un solo usuario; si se agregan más usuarios habría que añadir scoping por `userId` en los modelos y filtrar en los services.
- Para probar manualmente: crear un usuario en Supabase Auth y loguear vía `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` (header `apikey: <SUPABASE_PUBLISHABLE_KEY>`) para obtener un `access_token`, y usarlo como Bearer token.

## Documentación de la API (Swagger)

`GET /docs` sirve la UI de Swagger (`GET /docs-json` el spec OpenAPI crudo), configurado en `main.ts` con `DocumentBuilder`/`SwaggerModule`. El plugin de compilación `@nestjs/swagger` está habilitado en [nest-cli.json](nest-cli.json) (`compilerOptions.plugins`), así que **no hace falta decorar cada campo de los DTOs con `@ApiProperty`** — el plugin infiere los tipos desde las anotaciones de TypeScript al correr `nest build`/`nest start`. Ese plugin solo actúa en el build de Nest; los tests (Vitest) no pasan por él, pero tampoco lo necesitan.

## Ingesta de correos (Gmail)

[src/gmail/](src/gmail/) revisa **todas las cuentas de Gmail conectadas** cada 5 minutos (`@Cron(CronExpression.EVERY_5_MINUTES)` en [src/gmail/gmail-ingest.service.ts](src/gmail/gmail-ingest.service.ts)) y crea un `Recordatorio` con `origen: 'CORREO'` por cada correo nuevo en la bandeja **Principal** de cada cuenta que el asistente clasifique como accionable (asunto → `titulo`, `snippet` de Gmail → `descripcion`). No hay heurística para adivinar `fechaLimite` desde el contenido del correo — queda sin definir y se ajusta a mano.

- **Multi-cuenta**: la tabla `cuentas_gmail` (modelo `CuentaGmail`, servicio [src/gmail/gmail-accounts.service.ts](src/gmail/gmail-accounts.service.ts)) guarda un `refreshToken` por cuenta conectada (personal, corporativa, la que sea), identificada por su `email`. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` siguen siendo un único registro de app OAuth en `.env`, compartido por todas las cuentas — lo que es por-cuenta es el refresh_token, no el client id. Cada ciclo del cron llama a `GmailAccountsService.listar()` y procesa cada cuenta de forma independiente (label, deduplicación, barrido inicial y clasificación son todos por-cuenta); si una cuenta falla (token revocado, etc.) se loguea y se sigue con las demás, no se corta el ciclo entero. `GmailApiService` ya no guarda un solo `accessToken` de instancia — cachea uno por `refreshToken` en un `Map`.
- **Cómo conectar una cuenta**: abrir `http://localhost:3000/auth/gmail` en el navegador, loguearse con esa cuenta y aceptar el consentimiento. `GmailAuthController` identifica el email de la cuenta recién autorizada (`GmailApiService.getUserEmail()`, vía `GET https://www.googleapis.com/oauth2/v2/userinfo` con el access token) y hace un `upsert` en `cuentas_gmail` — no hay que copiar nada a mano ni reiniciar el servidor. Se puede repetir para conectar cuantas cuentas se quiera (ej. una vez para la personal, otra para la corporativa). El scope pedido es `gmail.modify openid email` (el `openid email` se agregó junto con el soporte multi-cuenta, para poder identificar automáticamente de qué cuenta se trata).
- **Migración desde el `.env` legacy**: antes de multi-cuenta, el único `refresh_token` vivía en `GOOGLE_REFRESH_TOKEN`. Si ese env var sigue presente, `GmailIngestService.onModuleInit()` intenta migrarlo solo a `cuentas_gmail` en cada arranque (idempotente, `upsert` por email). Un refresh_token viejo (emitido antes del scope `email`) **no se puede identificar automáticamente** — Google devuelve 401 en `userinfo` porque el token no tiene ese scope — y la migración falla con un warning explicando que hay que reabrir `/auth/gmail` una vez para reconectar esa cuenta con el scope nuevo. No es un bug, es esperado para cuentas conectadas antes de este cambio.
- **Categoría destino, ahora por cuenta**: cada cuenta cae en su propia Categoria (nombrada con su email) dentro de la Lista "Correos" compartida — así se distingue de un vistazo qué recordatorio vino de la cuenta personal vs. la corporativa. Antes de multi-cuenta todo caía en una única Categoria "Sin clasificar"; los recordatorios viejos que quedaron ahí no se migran solos, pero se pueden mover a mano vía `PATCH /recordatorios/:id`.

- **Filtro `category:primary`, no siempre disponible**: la query base (`queryBase()` en `gmail-ingest.service.ts`) es `in:inbox category:primary` por defecto — excluye a propósito las pestañas Promociones/Social/Actualizaciones de Gmail. Es un filtro nativo de Gmail, no una clasificación por contenido; solo hace un primer recorte grueso, la clasificación real ocurre después con el LLM (ver punto siguiente). **Ojo**: varias cuentas de Google Workspace tienen las pestañas del inbox deshabilitadas por política del administrador, y ahí `category:primary` no devuelve NUNCA resultados aunque el inbox tenga correos — así se descubrió el bug la primera vez que se conectó una cuenta corporativa (`in:inbox` solo: 201 resultados; `in:inbox category:primary`: 0). Por eso `CuentaGmail.filtrarPorPrincipal` (default `true`) se detecta una sola vez al conectar la cuenta (`GmailApiService.tieneCategoriaPrimaria()`, compara ambas queries) y, si da `false`, esa cuenta usa `in:inbox` a secas en todos los ciclos futuros.
- **Gestionar cuentas desde la app**: `GmailCuentasController` (`GET /gmail/cuentas`, `DELETE /gmail/cuentas/:id`, protegido por el guard normal — a diferencia de `/auth/gmail*` que es público) expone las cuentas conectadas al frontend (sin el `refreshToken`, vía `GmailAccountsService.listarPublico()`) para listarlas y desconectarlas desde Perfil. Conectar una cuenta nueva sigue siendo un flujo de navegador aparte (`/auth/gmail`), no algo que se pueda hacer solo con estos endpoints.
- **Filtro por LLM (`accionable`)**: `category:primary` deja pasar bastante ruido (notificaciones informativas, confirmaciones de algo ya resuelto, correos "normales" sin nada pendiente), así que antes de crear el Recordatorio se llama a `AsistenteService.esAccionable(asunto, snippet)` (mismo cliente Gemini que Vínculo, ver sección Asistente Vínculo), que devuelve `{ accionable: boolean }` con salida JSON forzada por schema. Si es `false` el correo se descarta (no se crea Recordatorio) pero **igual se marca con el label `Recordatorio-creado`**, para no volver a evaluarlo en cada ciclo. Si `GEMINI_API_KEY` no está configurada o la llamada a Gemini falla, `esAccionable` devuelve `true` por defecto (fail-safe: se prefiere un falso positivo — un recordatorio de más que hay que borrar a mano — a perder silenciosamente un correo que sí requería acción).
- **Deduplicación**: en vez de guardar estado en la base de datos, se usa el propio Gmail: cada correo procesado recibe la label `Recordatorio-creado`, y la query de polling excluye `-label:Recordatorio-creado`. Si se quiere que un correo se reprocese, basta con quitarle esa label a mano en Gmail.
- **Barrido inicial (crítico, no tocar sin entender por qué existe)**: la primera vez que se activa la ingesta, el label `Recordatorio-creado` no existe todavía. `GmailApiService.getOrCreateLabelId()` devuelve `{ id, created: true }` en ese caso, y `GmailIngestService.getLabelId()` dispara `marcarInboxExistenteComoProcesado()`: pagina TODO el inbox que matchea `QUERY_BASE` (con `listAllMessageIds`, sin límite de 25) y le aplica el label en bloque (`batchAddLabel`, hasta 1000 ids por llamada) **sin crear ningún Recordatorio**. Recién después de eso el ciclo normal empieza a considerar "nuevo" solo lo que llegue de ahí en adelante. Sin este paso, el primer ciclo real intentaría convertir *todo el historial de la bandeja* (miles de correos, no docenas) en recordatorios — así se descubrió el bug la primera vez que se activó esto. Como el trigger es "¿el label ya existía?", esto corre una sola vez por cuenta de Gmail; si el label se borra a mano, se vuelve a disparar el barrido completo en el siguiente ciclo.
- **`gmailFetch` debe tolerar cuerpo vacío**: varios endpoints de escritura de Gmail (`batchModify` en particular) devuelven 200/204 sin body. `GmailApiService.gmailFetch()` lee la respuesta como texto y solo hace `JSON.parse` si no está vacía — un `res.json()` directo revienta con `Unexpected end of JSON input` en esos casos (así se descubrió el segundo bug).
- **Gmail API sin la librería `googleapis`**: [src/gmail/gmail-api.service.ts](src/gmail/gmail-api.service.ts) llama a la API REST de Gmail directamente con `fetch` (refresh de access token, `messages.list`, `messages.get`, labels) para evitar la dependencia pesada del SDK oficial — solo se necesitan un puñado de endpoints.
- **Habilitado/deshabilitado automático**: si faltan `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` en `.env`, `GmailIngestService.onModuleInit()` deja la ingesta deshabilitada (loggea un warning) en vez de fallar — el resto de la API funciona igual sin esto configurado. Con esos dos presentes pero cero cuentas conectadas en `cuentas_gmail`, el cron corre pero no hace nada (lista vacía).

### Cómo obtener las credenciales de Google (una sola vez por proyecto de Google Cloud, no por cuenta de Gmail)

1. En [Google Cloud Console](https://console.cloud.google.com/), crear un proyecto (o usar uno existente) y habilitar **Gmail API** (APIs & Services → Library).
2. En **APIs & Services → OAuth consent screen**: tipo "External", agregar como *test users* cada cuenta de Gmail que se vaya a conectar (personal, corporativa, etc.) — mientras la app no esté publicada/verificada por Google, solo las cuentas listadas ahí pueden autorizarla. **Para una cuenta corporativa de Google Workspace**, además puede hacer falta que el administrador del workspace permita apps externas/no verificadas (Admin Console → Security → API controls) — si el consentimiento falla con un error de política de la organización, ese es el motivo más probable, y hay que pedirle al admin que lo habilite (no es algo que se resuelva desde este proyecto).
3. En **APIs & Services → Credentials → Create Credentials → OAuth client ID**: tipo "Web application", con **Authorized redirect URI** = el mismo valor que `GOOGLE_REDIRECT_URI` en `.env` (por defecto `http://localhost:3000/auth/gmail/callback`).
4. Copiar el **Client ID** y **Client Secret** generados a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` en `.env`, y reiniciar el servidor. Esto se hace una sola vez — es la app OAuth compartida, no algo por cuenta.
5. **Por cada cuenta de Gmail que se quiera conectar**: con el servidor corriendo, abrir `http://localhost:3000/auth/gmail` **en el navegador** (no automatizado — hay que loguearse con esa cuenta de Google y aceptar el consentimiento). `GmailAuthController` recibe el `code` en `/auth/gmail/callback`, lo canjea por tokens, identifica el email de la cuenta y la guarda en `cuentas_gmail`. La pantalla de confirmación lo dice explícitamente; no hay que copiar nada a mano ni reiniciar el servidor. Repetir este paso para cada cuenta adicional (ej. una vez para la personal, otra para la corporativa).

Las rutas `/auth/gmail*` están marcadas `@Public()` (no piden JWT de Supabase) porque las visita Google directamente durante el redirect, y `@ApiExcludeController()` (no aparecen en `/docs`) porque son un flujo de setup manual, no parte de la API de la app.

## Asistente Vínculo (LLM)

[src/asistente/](src/asistente/) — `POST /asistente/interpretar` (protegido, igual que el resto de la API) recibe `{ texto: string }` en lenguaje natural (escrito o transcrito de voz) y usa Gemini (`@google/genai`, modelo `gemini-3.5-flash-lite`) con **salida JSON forzada por schema** (`config.responseMimeType: 'application/json'` + `config.responseSchema`) para devolver datos estructurados: `titulo`, `descripcion?`, `fechaLimite?` (ISO, resuelta contra la fecha/hora actual que se le pasa al modelo en `systemInstruction`), `prioridad?`, `monto?`, `banco?`.

- **Por qué Gemini y no Claude**: para esta tarea (extracción corta de texto a JSON) el modelo no importa mucho — se eligió Gemini Flash-Lite específicamente por ser más barato que Claude Haiku 4.5. **Ojo con el "tier gratis"**: la cuenta de Google AI Studio de este proyecto tuvo que cargar $25 de crédito prepagado para que la API dejara de devolver `429 RESOURCE_EXHAUSTED — Your prepayment credits are depleted` — o sea que en la práctica **no corrió gratis sin más**, el tier gratis actual de Google parece depender de un balance de créditos prepagados por cuenta/proyecto, no ser ilimitado. Revisar el estado de facturación en `ai.studio/projects` si esto vuelve a pasar.
- **`gemini-2.5-flash-lite` ya no existe para cuentas nuevas** (404 `NOT_FOUND` al llamarlo, "no longer available to new users") — el modelo vigente es `gemini-3.5-flash-lite`. El error 404 de Google además recomendaba una "Interactions API" nueva en vez de `models.generateContent`; no se investigó ni se migró a eso — `models.generateContent` con `responseSchema` (lo que usa este código) sigue funcionando.
- Este endpoint **no crea el Recordatorio** — solo interpreta. El cliente (frontend) usa el resultado para mostrar una vista previa y, si el usuario confirma, llama a `POST /recordatorios` normalmente (ahí sí hace falta un `categoriaId` real, que el LLM no puede inventar).
- Si falta `GEMINI_API_KEY` en `.env`, `AsistenteService.onModuleInit()` deja el asistente deshabilitado (warning en el log) y el endpoint responde `503 Service Unavailable` en vez de fallar feo — igual patrón que Gmail y las notificaciones push.
- La API key se obtiene gratis en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con cualquier cuenta de Google — no requiere el mismo proyecto de Google Cloud que Gmail (puede ser el mismo o uno distinto).

## Notificaciones push (Web Push)

[src/notificaciones/](src/notificaciones/) — avisa al teléfono/navegador aunque la app esté cerrada, usando el estándar Web Push (VAPID), no Firebase ni un servicio de terceros.

- **Suscripción**: `POST /notificaciones/suscripcion` guarda `{ endpoint, keys: { p256dh, auth } }` (lo que devuelve `PushManager.subscribe()` en el navegador) vía `upsert` sobre `endpoint` (único). `DELETE /notificaciones/suscripcion` la borra. Ambas protegidas por el guard normal.
- **Envío**: `PushService` ([src/notificaciones/push.service.ts](src/notificaciones/push.service.ts)) envuelve la librería `web-push`, configurada con `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` en `onModuleInit()` (deshabilitado con warning si faltan, mismo patrón que Gmail/Asistente). Si el envío falla con `404`/`410` (el navegador revocó la suscripción), la borra sola de la base; cualquier otro error solo se loguea.
- **Disparo**: `RecordatoriosNotificadorService` ([src/notificaciones/recordatorios-notificador.service.ts](src/notificaciones/recordatorios-notificador.service.ts)) corre cada minuto (`@Cron(CronExpression.EVERY_MINUTE)`) y busca `Recordatorio` con `estado: PENDIENTE`, `notificadoEn: null` y `fechaLimite` ya cumplida; por cada uno, notifica a **todas** las suscripciones guardadas (no hay `userId` en el modelo, ver sección Autenticación) y marca `notificadoEn`. `notificadoEn` es la deduplicación — sin `userId` para filtrar, es lo único que evita reenviar el mismo aviso en cada tick.
- **Generar las VAPID keys** (una sola vez): `npx web-push generate-vapid-keys`. `VAPID_PUBLIC_KEY` no es secreta — también va en el frontend (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) para que el navegador pueda suscribirse.
- `ScheduleModule.forRoot()` vive en `AppModule` (no en `GmailModule`, donde estaba antes de agregar este cron) — es infraestructura compartida entre ambos módulos con `@Cron`, así que se registra una sola vez a nivel de la app.

## Tests

- Unit tests (`*.spec.ts` junto a cada archivo, ej. [src/listas/listas.service.spec.ts](src/listas/listas.service.spec.ts)): mockean `PrismaService` por completo (sin red ni base de datos), cubren la lógica de negocio de cada service (validación de padres, `NotFoundException`, filtros).
- El test del guard ([src/auth/supabase-auth.guard.spec.ts](src/auth/supabase-auth.guard.spec.ts)) mockea `jwtVerify` de `jose` con `vi.mock` para no depender de la red del JWKS de Supabase.
- Tests e2e (`test/*.e2e-spec.ts`): importan el `AppModule` real completo, **incluida la conexión real a Supabase** (no hay base de datos de test separada) — al correr `npm run test:e2e` se conecta de verdad vía `DATABASE_URL`. [test/auth.e2e-spec.ts](test/auth.e2e-spec.ts) verifica los códigos 401/200 del guard sin necesitar un JWT real.
