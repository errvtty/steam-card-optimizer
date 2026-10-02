# Steam Card Optimizer — V3

## Inicio rápido (3 pasos)

1. Instala Node.js 18+ desde https://nodejs.org
2. Doble clic en `iniciar.bat` (Windows) o ejecuta `./iniciar.sh` (Mac/Linux). Instala dependencias y arranca.
3. Abre http://localhost:3000

El `.env` incluido trae `DEMO_MODE=true`, así que funciona de inmediato con datos de ejemplo.

### Para usar tu cuenta real
1. Consigue tu API Key en https://steamcommunity.com/dev/apikey
2. En `.env`: `STEAM_API_KEY=TU_KEY` y `DEMO_MODE=false`
3. Reinicia. Tu perfil e inventario en Steam deben estar en **público**.


Proyecto listo para ejecutar como aplicación Node/Express.

## Publicar como web (Render, gratis)

1. Sube esta carpeta a un repositorio de GitHub (el `.gitignore` ya excluye `.env`).
2. En https://render.com → New → Blueprint → elige tu repo (usa `render.yaml`).
3. Render te pedirá 3 variables. Con la URL que te asigne (ej. `https://mi-app.onrender.com`):
   - `STEAM_API_KEY` = tu key de https://steamcommunity.com/dev/apikey
   - `STEAM_REALM` = `https://mi-app.onrender.com/`
   - `STEAM_RETURN_URL` = `https://mi-app.onrender.com/auth/steam/return`
   (Si no sabes la URL aún: despliega, copia la URL, rellena las variables y redeploya.)
4. Abre la URL: el botón "Iniciar sesión con Steam" ya funciona para cualquier visitante.

Notas: en el plan gratis la app se "duerme" tras inactividad y tarda ~30 s en despertar, y las sesiones se pierden al reiniciar. Funciona igual en Railway, Fly.io o un VPS con `npm start` detrás de HTTPS. Para dominio propio, añádelo en Render y actualiza `STEAM_REALM` y `STEAM_RETURN_URL`.

## APIs conectadas

1. **Steam OpenID**
   - `https://steamcommunity.com/openid`
   - Login sin pedir la contraseña de Steam.
   - Obtiene SteamID64.

2. **Steam Web API**
   - `ISteamUser/GetPlayerSummaries`
   - `IPlayerService/GetSteamLevel`
   - `IPlayerService/GetOwnedGames`

3. **Steam Community Inventory**
   - `https://steamcommunity.com/inventory/{steamid}/753/6`
   - Filtra objetos de tipo Trading Card.

4. **Steam Market**
   - Link exacto: `/market/listings/753/{market_hash_name}`
   - Consulta server-side de `market/priceoverview` con cache.
   - El endpoint de precios es una ruta pública no documentada oficialmente; puede cambiar o limitar solicitudes.

## Multiusuario

Cada usuario que inicia sesión recibe una sesión independiente. La app utiliza el SteamID64 de esa sesión para consultar su propio perfil, juegos e inventario. No hay una cuenta Steam global compartida.

El proyecto no guarda contraseñas de Steam.

## Instalación

Node.js 18+ recomendado.

```bash
npm install
```

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

En Windows:

```powershell
copy .env.example .env
```

Configura:

```env
STEAM_API_KEY=TU_API_KEY
STEAM_RETURN_URL=http://localhost:3000/auth/steam/return
STEAM_REALM=http://localhost:3000/
SESSION_SECRET=una-clave-larga
```

Ejecuta:

```bash
npm start
```

Abre:

`http://localhost:3000`

## DEMO

Para probar sin API Key:

```env
DEMO_MODE=true
```

## Hosting

Este proyecto tiene backend Express, por lo que no debe publicarse solamente como sitio estático en Netlify.

Puedes usar cualquier hosting Node.js que permita variables de entorno y HTTPS.

En producción:

```env
NODE_ENV=production
STEAM_RETURN_URL=https://TU-DOMINIO.com/auth/steam/return
STEAM_REALM=https://TU-DOMINIO.com/
SESSION_SECRET=CLAVE_ALEATORIA_LARGA
DEMO_MODE=false
```

## Importante sobre inventarios privados

Si Steam no permite consultar un inventario/perfil debido a privacidad, la aplicación no puede saltarse esa configuración. El usuario debe hacer su información necesaria visible en Steam.

## Sobre "todas las APIs"

Valve no proporciona una API oficial única que devuelva "todos los sets de cromos + progreso + precio de cada cromo". La Web API oficial documentada cubre interfaces concretas, mientras que el Market tiene rutas públicas no documentadas. Por eso este proyecto separa:
- APIs oficiales para identidad/perfil/juegos/nivel.
- Community Inventory para objetos.
- Market para listings/precios, con cache y manejo de fallos.

Para calcular exactamente los cromos faltantes de cada juego hace falta además un catálogo de sets de cromos. No se inventa esa información ni se presenta como una API oficial de Valve.
