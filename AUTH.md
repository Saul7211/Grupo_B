# Autenticación

El sistema usa **OAuth 2.0 con Google** para identificar al usuario y un **JWT propio** para mantener la sesión. El servidor no guarda estado de sesión (modelo *stateless*).

## Flujo

1. El usuario pulsa "Ingresar con Google" en `login.html` (`<a href="/auth/google">`).
2. `/auth/google` inicia el flujo de OAuth con Passport (`passport-google-oauth20`), pidiendo los scopes `profile` y `email`.
3. Google autentica al usuario y redirige a `/auth/google/callback`.
4. El backend llama a `loginOrRegisterGoogle()`: si el usuario existe lo loguea, si no lo crea en la BD.
5. Se genera un JWT firmado con `createAuthToken()` y se redirige a `oauth-callback.html` con los datos del usuario.
6. `oauth-callback.html` guarda el usuario y el token en `sessionStorage` y entra al lobby.

A partir de ahí, Google ya no interviene: cada acción se autoriza solo con el JWT.

## El JWT

El token va firmado con `JWT_SECRET`, contiene `userId` y `username`, y expira según `JWT_EXPIRES_IN` (2h por defecto). El servidor no recuerda nada: solo verifica la firma del token en cada petición.

Viaja por dos canales:

- **HTTP**: en el header `Authorization: Bearer <token>`. Lo valida `authMiddleware`.
- **Socket.IO**: dentro del payload del evento (`payload.token`). Lo valida `authenticateSocketPayload`, que además comprueba que el `userId` coincida con el del token.

Usar la misma credencial en ambos canales es lo que permite que un socket nuevo (al navegar entre páginas o reconectar) se vuelva a identificar sin re-loguearse.

## Archivos

| Archivo | Función |
|---|---|
| `backend/auth.js` | Configuración de la estrategia de Google (Passport). |
| `backend/middleware/authMiddleware.js` | Crear y verificar JWT; proteger rutas HTTP y eventos de socket. |
| `backend/main-server.js` | Rutas `/auth/google` y `/auth/google/callback`. |
| `backend/database.js` | `loginOrRegisterGoogle()`: login o alta del usuario de Google. |
| `frontend/login.html` | Botón "Ingresar con Google". |
| `frontend/oauth-callback.html` | Recibe el token y lo guarda en `sessionStorage`. |

## Variables de entorno

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
JWT_SECRET=
JWT_EXPIRES_IN=2h
```
