# Mis Finanzas

App de finanzas personales que **guarda todo en tu hoja de Google "Control de Finanzas Personales"**. Funciona sin internet, se instala en el celular y la computadora, y se actualiza sola cada vez que subes cambios a GitHub.

```
Celular / PC (app instalada)  ──►  Apps Script dentro de tu hoja  ──►  Movimientos, Cuentas, Metas…
   copia local + cola de cambios       escribe solo columnas amarillas        tus fórmulas siguen igual
```

- **Sin señal:** registras normal; los cambios quedan en cola y se envían solos al volver la conexión.
- **Tu hoja manda:** lo que edites directo en Sheets también aparece en la app en la siguiente sincronización.
- **Tres diseños:** Libro, Bolsillo y Consola. Se cambian en Ajustes.
- **El repositorio no lleva tus datos.** Tus números viven en tu hoja y en la memoria del equipo.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `sw.js` | Hace que abra sin internet y detecta versiones nuevas |
| `manifest.webmanifest`, `icons/` | Permite instalarla como aplicación |
| `apps-script/Code.gs` | Conector que vive dentro de tu hoja |
| `apps-script/appsscript.json` | Zona horaria y permisos del conector |

---

## Paso 1 · Conectar tu hoja (una sola vez, 10 minutos)

1. Abre tu hoja en Google Sheets → **Extensiones → Apps Script**.
2. Borra lo que haya en `Código.gs` y pega todo el contenido de `apps-script/Code.gs`.
3. En **Configuración del proyecto** (engranaje) marca *Mostrar el archivo de manifiesto "appsscript.json"*. Abre ese archivo y reemplázalo con `apps-script/appsscript.json`.
4. Arriba, elige la función **`configurar`** y pulsa **Ejecutar**. Autoriza los permisos (es tu propia cuenta).
   - Esto agrega la columna **R "ID app"** en Movimientos, la columna **N "Cuenta vinculada"** en Metas, el ámbito **Negocio** y te muestra tu **código de acceso** en el registro de ejecución. Cópialo.
5. **Implementar → Nueva implementación → Tipo: Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario** (la app no puede iniciar sesión de Google; la protección es tu código de acceso)
6. Copia la **URL** que termina en `/exec`.

> Opcional: ejecuta también **`repararFormulasMetas`**. Varias filas de tu hoja Metas apuntan a la fila de abajo (por ejemplo `H6` usa `$A7`) y por eso algunos totales salen vacíos.

**Cuando cambies `Code.gs`**: Implementar → Administrar implementaciones → editar (lápiz) → Versión: *Nueva versión*. Así la URL no cambia.

## Paso 2 · Publicar en GitHub Pages

1. Crea un repositorio (por ejemplo `mis-finanzas`) y sube **todo el contenido de esta carpeta**.
2. En el repositorio: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. En 1 o 2 minutos queda en `https://TU-USUARIO.github.io/mis-finanzas/`.

## Paso 3 · Instalar y conectar

1. Abre esa dirección:
   - **Android (Chrome):** menú ⋮ → *Instalar app*.
   - **iPhone (Safari):** Compartir → *Agregar a inicio*.
   - **PC (Chrome/Edge):** ícono de instalar en la barra de direcciones.
2. En la app: **Ajustes → Conectar mi hoja**, pega la URL y el código de acceso → **Conectar**.

Repite el paso 3 en cada equipo. Todos leen y escriben la misma hoja.

## Actualizar la app

1. Cambia los archivos.
2. Sube el número de versión en **dos lugares**: `const CACHE = 'mis-finanzas-vX.Y.Z'` en `sw.js` y `const VERSION` en `app.js`.
3. `git push`. Al abrir la app aparece **"Hay una versión nueva · Actualizar"**.

Si no subes el número en `sw.js`, los equipos seguirán usando la versión guardada.

## Cómo se mapea con tu hoja

| App | Hoja | Columnas que escribe |
|---|---|---|
| Movimientos | Movimientos | A–D, F–L y R (ID). No toca E ni M–Q (fórmulas) |
| Cuentas | Cuentas | A–C (no pisa un saldo inicial con fórmula si no cambió) |
| Metas | Metas | A–E y N |
| Deudas | Deudas | A–F |
| Pagos fijos | Pagos fijos | A–F y los meses G–R ("Pagado") |
| Presupuesto | Presupuesto | B |
| Categorías | Categorias | A–C y las listas E/G/M |
| Notas | Notas | A–F y G (ID) |

- Al **eliminar** un movimiento, se vacían sus celdas amarillas; la fila y sus fórmulas quedan listas para reutilizarse.
- Al **renombrar** una cuenta, meta o deuda desde la app, el nombre se cambia también en todos los movimientos.
- Límite actual: 2,998 movimientos (filas 5 a 3002). Si te acercas, extiende las fórmulas de Movimientos y cambia `MOV.last` en `Code.gs`.

## Privacidad

- El repositorio es solo código. `.gitignore` bloquea `.xlsx` y copias `.json`.
- La URL del conector y tu código se guardan solo en cada equipo, nunca en GitHub.
- Si crees que alguien vio tu código: borra la propiedad `TOKEN` (Configuración del proyecto → Propiedades del script), ejecuta `configurar` de nuevo y pega el código nuevo en tus equipos.

## Actualizar el conector de tu hoja (cuando la app lo pida)

El conector v3 es universal: guarda en la hoja **AppData** cualquier dato nuevo de la app (ajustes compartidos entre equipos y funciones futuras). Una vez instalado, las mejoras de la app ya no necesitan cambiar Apps Script. La Agenda usa además las columnas H a K de **Notas** (tipo, hora, color y fijada).

1. Abre tu hoja → **Extensiones → Apps Script**.
2. Reemplaza todo `Código.gs` con `apps-script/Code.gs` de este repositorio y guarda.
3. **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar.** La URL no cambia.

## Bloc de notas y agenda

- **Agenda** (actividades, pendientes y notas cortas): hoja **Notas**.
- **Bloc de notas** (cuadernos, secciones, páginas, fotos y dibujos): hoja **AppData**, que crea sola el conector v3. Las fotos se comprimen (≈1100 px) y se guardan en trozos; en cada equipo quedan en caché para abrir rápido.
- **PDF**: botón PDF → elige página, sección, cuaderno o agenda → en la ventana de impresión, **Guardar como PDF**.
- No edites a mano la hoja AppData.

## Vehículos

Sección **Vehículos** (y tarjeta en Inicio) para llevar cada vehículo por separado:

- **Kilometraje:** toca el número grande para anotarlo; también se actualiza al cargar gasolina o registrar un mantenimiento.
- **Plan de mantenimiento:** cada tarea va "cada X km o cada X meses, lo que llegue primero". Al crear el vehículo se carga un plan sugerido (moto o carro) que puedes editar. Los avisos salen en la campanita.
- **Mantenimiento:** checklist con lo que toca. Marcas cada cosa como cambiado, ajustado, revisado, reparado o limpiado, con precio, detalle y fotos de la factura. Al guardar, la app pregunta si lo registra como gasto (y si lo saca del fondo).
- **Gasolina:** total, precio por galón y km; calcula km/galón y avisa si el rendimiento baja.
- **Documentos:** circulación, seguro, licencia; aviso 30 días antes del vencimiento.
- **Presupuesto:** mensual de mantenimiento y de gasolina por vehículo, más un fondo (meta) para piezas grandes. También calcula el **costo por km**.

Se guarda en la hoja AppData (conector v3).
- **Talleres y tiendas:** directorio con nombre, tipo, contacto, teléfono, WhatsApp, dirección, enlace de Maps, horario, especialidad y notas. Botones para llamar, escribir por WhatsApp y ver el mapa. Cada lugar muestra cuántas veces fuiste y cuánto has gastado ahí (servicios hechos ahí y piezas "compradas en").
