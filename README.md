# Motor Genealógico

<img width="1885" height="940" alt="image" src="https://github.com/user-attachments/assets/e90ce2da-5cb1-48ea-938d-cc05d6feb4b2" />


Editor visual de árboles genealógicos que corre en el navegador, sin framework ni paso de compilación. Los nodos (personas y uniones) y las conexiones (parentesco y pareja) se dibujan sobre un lienzo infinito con zoom y desplazamiento. Los datos se sincronizan en tiempo real con **Firebase Firestore** y se respaldan en `localStorage`.

## Tecnologías

| Capa | Tecnología |
|---|---|
| Lógica | JavaScript vanilla (módulos ES nativos) |
| Interfaz | HTML5 + CSS3 (variables CSS, `@media`, `:has()`, `dvh`) |
| Gráficos | DOM para nodos, **SVG** para aristas, **Canvas 2D** para el minimapa |
| Gestos | Pointer Events (ratón, táctil y lápiz con el mismo código) |
| Nube | Firebase Firestore (SDK modular cargado por CDN, caché persistente en IndexedDB) |

## Estructura

```
motor-genealogico/
├── index.html
├── style.css
├── README.md
└── js/
    ├── config.js     Constantes y configuración de Firebase
    ├── state.js      Estado único, bus de eventos y utilidades puras
    ├── model.js      Normalización, validación, CRUD, generaciones y ramas
    ├── history.js    Deshacer / rehacer por instantáneas
    ├── sync.js       Firestore + respaldo local + estado de sincronización
    ├── render.js     Reconciliación DOM/SVG y actualización parcial de aristas
    ├── view.js       Pan/zoom, animaciones, encuadre y foco familiar
    ├── gestures.js   Pointer Events: pan, arrastre, conexión y pinch
    ├── panel.js      Panel de detalles (lateral / drawer móvil)
    ├── minimap.js    Minimapa de navegación
    ├── layout.js     Auto-organización por niveles
    ├── exporter.js   Exportación a PNG / SVG
    ├── search.js     Buscador rápido
    ├── stats.js      Modal de estadísticas
    └── main.js       Cableado de la barra, atajos y arranque
```

## Configuración y despliegue

### 1. Ejecutar en local

Los módulos ES **no funcionan abriendo `index.html` con doble clic** (`file://`). Sirve la carpeta por HTTP:

```bash
cd motor-genealogico
python3 -m http.server 8080      # o: npx serve .
# abre http://localhost:8080
```

### 2. Preparar Firestore (una sola vez)

1. En la [consola de Firebase](https://console.firebase.google.com/) abre el proyecto `genciel-ee18b`.
2. **Build → Firestore Database → Create database** (modo producción; elige la región más cercana).
3. En la pestaña **Rules** publica unas reglas. Mientras no haya autenticación, estas limitan el acceso a la colección y al tamaño del documento:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /trees/{treeId} {
      allow read: if true;
      allow create, update: if request.resource.data.nodes is list
                            && request.resource.data.edges is list
                            && request.resource.size < 900 * 1024;
      allow delete: if false;
    }
  }
}
```

> **Seguridad.** La `apiKey` de Firebase para web no es un secreto, pero **estas reglas permiten que cualquiera que conozca la URL lea y escriba el árbol**. Para uso real añade [Firebase Authentication](https://firebase.google.com/docs/auth) (p. ej. acceso anónimo o Google) y restringe con `request.auth != null`, idealmente con un campo `ownerUid` en cada documento. En la consola, además, restringe la API key a tus dominios (*Google Cloud → APIs y servicios → Credenciales*).

### 3. Desplegar

Es un sitio estático; sirve cualquier hosting estático:

- **GitHub Pages:** sube la carpeta, en *Settings → Pages* elige la rama y la raíz.
- **Firebase Hosting:** `firebase init hosting` (directorio público `.`) y `firebase deploy`.
- Netlify, Cloudflare Pages, etc.: arrastra la carpeta.

Añade el dominio publicado en *Authentication → Settings → Authorized domains* si más adelante activas Auth.

### 4. Varios árboles

El árbol activo se identifica con el parámetro `?tree=`:

- `https://tu-sitio/` → árbol `principal`
- `https://tu-sitio/?tree=familia-garcia` → documento `trees/familia-garcia`

El id se recuerda en el navegador. Cada árbol tiene su propio respaldo local.

## Arquitectura

### Principios

1. **Un único estado.** `state.js` exporta el objeto `state` (`graph`, `selection`, `focus`, `scale`, `pan`…) y los índices derivados `nodeMap`, `unionsOf` y `edgesOf`. Los índices se reconstruyen en `reindex()` y nunca se guardan.
2. **El modelo no conoce el DOM.** `model.js` y `history.js` mutan el grafo y emiten eventos; solo `render.js`, `panel.js`, `minimap.js` y `exporter.js` tocan la interfaz.
3. **Sin dependencias circulares: comunicación por eventos.** Un bus (`EventTarget`) desacopla los módulos.

| Evento | Emisor | Receptores | Significado |
|---|---|---|---|
| `render` | modelo, panel | `render.js` | Reconciliar el DOM con el grafo |
| `rendered` | `render.js` | `minimap.js` | El DOM está al día |
| `graph:changed` | `history.js`, panel | `sync.js` | El contenido cambió → persistir |
| `graph:replaced` | undo/redo, import, nube | `panel.js`, `main.js` | Se sustituyó el grafo entero |
| `view` | `view.js` | `minimap.js`, `sync.js` | Cambió pan/zoom |
| `nodemoved` | `gestures.js` | `minimap.js` | Un nodo se mueve en vivo |
| `panel:close` | modelo, historial, sync | `panel.js` | Cerrar el panel |
| `sync:status` | `sync.js` | — | Cambió el estado de sincronización |

### Modelo de datos

```jsonc
{
  "nodes": [
    { "id": "p_x1", "type": "person", "position": { "x": 0, "y": 0 },
      "data": { "firstName": "", "lastName": "", "gender": "M|F|O", "birthPlace": "",
                "birthDate": "YYYY-MM-DD", "deathDate": "", "description": "", "img": "" } },
    { "id": "u_x2", "type": "union", "position": { "x": 0, "y": 120 },
      "data": { "status": "active|separated|divorced", "startDate": "", "endDate": "" } }
  ],
  "edges": [
    { "id": "e_1", "source": "p_x1", "target": "u_x2" },                          // persona → unión = pareja
    { "id": "e_2", "source": "u_x2", "target": "p_x3", "relationType": "blood" }  // unión → persona = hijo/a
  ]
}
```

`relationType`: `blood`, `adopted` o `stepchild`. `normalizeGraph()` depura cualquier dato entrante (JSON importado, nube o respaldo local): ids duplicados, aristas huérfanas, tipos desconocidos.

### Render y rendimiento

- `render()` **reconcilia por id**: crea, actualiza o elimina elementos sin recrear los existentes ni sus listeners.
- Los nodos se posicionan con `transform: translate()` (compositor de la GPU), no con `left/top`, así que moverlos no provoca reflow.
- **Arrastre a 60 FPS.** Los `pointermove` se agrupan con `requestAnimationFrame`. En cada frame solo se actualiza el transform del nodo y `updateEdgesOf(id)`, que recorre únicamente las aristas incidentes (índice `edgesOf`). El estilo de las aristas y el resto del grafo no se tocan hasta soltar el nodo. El coste por frame es O(grado del nodo), no O(total de aristas).
- El minimapa se redibuja como máximo una vez por frame.

### Persistencia, historial y validación

- **Historial:** instantáneas JSON (máx. 100). `commit()` se llama tras cada acción y no añade nada si el estado no cambió.
- **Validación de conexiones:** bloquea ciclos, duplicados, unión→unión y más de 2 integrantes por unión. Avisa (sin bloquear) de diferencias de edad incoherentes o ascendencia múltiple.
- **Generaciones:** `computeLevels()` asigna niveles por relajación (pareja = mismo nivel, hijo = fuente + 1); lo usan las estadísticas y el auto-layout.

## Integración con Firebase

### Modelo en Firestore

```
trees (colección)
└── {treeId} (documento)
    ├── schemaVersion : number
    ├── nodes         : array de mapas
    ├── edges         : array de mapas
    ├── updatedAt     : number (epoch ms)
    └── updatedBy     : string (id de la pestaña que escribió)
```

Se usa **un documento por árbol**: la escritura es atómica y un solo listener basta. El límite de Firestore es 1 MiB por documento (miles de personas); si un árbol se acerca, el siguiente paso sería pasar a subcolecciones `nodes/` y `edges/`.

La vista (pan/zoom) es por dispositivo y solo vive en `localStorage`.

### Flujo de sincronización

1. **Arranque:** se carga el respaldo local y se pinta de inmediato. En paralelo `sync.js` importa dinámicamente el SDK y abre `onSnapshot` sobre `trees/{treeId}` con caché persistente multi-pestaña.
2. **Escritura:** cada `graph:changed` incrementa `localVersion`, guarda el respaldo local (300 ms) y programa `setDoc` (800 ms de *debounce*). Solo hay una escritura en vuelo; los cambios intermedios se colapsan.
3. **Confirmación:** `savedVersion` avanza únicamente cuando el servidor confirma el `setDoc`. `isDirty()` (`localVersion !== savedVersion`) indica cambios sin sincronizar.
4. **Cambios remotos:** un snapshot confirmado por el servidor con `updatedBy` distinto reemplaza el grafo local. Entra en el historial de deshacer pero no se vuelve a subir.
5. **Primera sincronización:**
   - La nube no tiene el árbol y hay datos locales → se **suben** (migración desde `localStorage`).
   - La nube tiene datos y hay cambios locales sin subir de la sesión anterior → **ganan los locales** (edición sin conexión).
   - En cualquier otro caso → **gana la nube**.
6. **Conflictos:** *last-write-wins* sobre el documento completo. Si hay cambios locales sin subir cuando llega un cambio remoto, prevalece lo local.

### Indicador de estado

| Estado | Texto | Significado |
|---|---|---|
| `connecting` | Conectando… | Esperando el primer dato del servidor |
| `saving` | Guardando… | Hay cambios locales sin confirmar |
| `saved` | Guardado en la nube | Servidor y local coinciden |
| `offline` | Sin conexión · cambios en cola | Sin red; las escrituras se encolan en IndexedDB y suben al volver |
| `local` | Solo local | El SDK no cargó; la app sigue con `localStorage` |
| `error` | Error de sincronización | Reglas denegadas u otro fallo (ver aviso) |

### Protector de cierre

`beforeunload` muestra el diálogo del navegador **solo si `isDirty()`** (cambios sin confirmar por la nube). En modo solo local no se muestra, porque los datos ya están en el respaldo.

### Versión del SDK

`config.js` define `FIREBASE_VERSION` (`13.0.0`). Si esa versión no existe en el CDN, la app cae a modo local y lo avisa; cámbiala por una versión publicada (consulta las [notas de versión](https://firebase.google.com/support/release-notes/js)).

## Guía de uso

### Lienzo

| Acción | Cómo |
|---|---|
| Desplazar | Arrastrar el fondo |
| Zoom | Rueda del ratón o pellizco con dos dedos |
| Mover un nodo | Arrastrarlo |
| Conectar | Arrastrar desde el **puerto azul** inferior de un nodo hasta otro |
| Editar | Clic o toque sobre un nodo o una línea |
| Eliminar conexión | Doble clic sobre la línea, o botón *Eliminar* en su panel |

Convención de conexiones: **Padre/Madre → Unión** (pareja) y **Unión → Hijo/a**. El color de la línea indica el tipo (ver la leyenda).

### Funciones

- **Auto-organizar:** reordena el árbol por generaciones (padres arriba, unión debajo, hijos más abajo). Es una acción de historial: *Ctrl+Z* la deshace.
- **Foco familiar:** abre una persona y pulsa *Ascendentes*, *Descendientes* o *Ambos*. Se ocultan las demás ramas (también en el minimapa y en la exportación). Cambia el modo o sal desde la barra inferior o con *Esc*.
- **Minimapa:** muestra el árbol y tu posición. Pulsa o arrastra sobre él para moverte.
- **Exportar imagen:** *Imagen ▾* → PNG (2×, hasta 8192 px) o SVG vectorial. Exporta el árbol completo (o la rama enfocada), independientemente del zoom. Los avatares remotos requieren CORS; si no, se usa el avatar genérico.
- **Buscar:** `Ctrl+K`, escribe y elige con flechas + *Enter* (sin distinguir acentos ni mayúsculas).
- **Estadísticas:** miembros, vivos/fallecidos, generaciones, edad media y uniones.
- **JSON:** exporta o importa el árbol completo (importar se puede deshacer).

### Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl/⌘ + K` | Buscar persona |
| `Ctrl/⌘ + Z` | Deshacer |
| `Ctrl/⌘ + Y` · `Ctrl/⌘ + Shift + Z` | Rehacer |
| `0` | Centrar vista |
| `L` | Auto-organizar |
| `M` | Mostrar / ocultar minimapa |
| `Esc` | Cierra, por orden: estadísticas → menús → panel → foco familiar |
| `Enter` / `Espacio` sobre un nodo enfocado | Abrir su panel |

Los atajos de una sola tecla se ignoran mientras escribes en un campo.

### Móvil (< 768 px)

- La barra se compacta: *+ Persona*, *+ Unión*, indicador de sincronización y menú **☰** con el resto de acciones; el buscador ocupa su propia fila.
- El panel de detalles es un **drawer inferior flotante**: arrastra el asa hacia abajo para cerrarlo. Si el nodo queda tapado, el lienzo se desplaza para mostrarlo.
- Los campos usan 16 px (evita el zoom automático de iOS) y los objetivos táctiles miden ≥ 44 px.
- El minimapa empieza oculto; actívalo con el botón *Minimapa* del menú.

### Accesibilidad

Contrastes ≥ 4.5:1 en texto, foco visible con teclado, enlace *Saltar al lienzo*, nodos accesibles con `Tab` y `Enter`, combobox ARIA en el buscador, estado de sincronización anunciado (`aria-live`) con texto además de color, panel oculto fuera del árbol de accesibilidad (`inert`) y respeto de `prefers-reduced-motion`.

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| Pantalla en blanco y error de CORS / módulos | Abriste `index.html` con `file://`; sírvelo por HTTP |
| Estado «Solo local» | El SDK no cargó (sin red, bloqueador o versión inexistente en `FIREBASE_VERSION`) |
| Aviso «Firestore denegó…» | Reglas de seguridad no publicadas o demasiado restrictivas |
| La exportación PNG muestra avatares genéricos | Las imágenes remotas no envían cabeceras CORS |
| Árbol distinto en dos dispositivos | Usan distinto `?tree=` |
