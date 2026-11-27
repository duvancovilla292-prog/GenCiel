# GenCiel · Árbol genealógico

<img width="1885" height="940" alt="image" src="https://github.com/user-attachments/assets/e90ce2da-5cb1-48ea-938d-cc05d6feb4b2" />

Editor visual de árboles genealógicos que corre en el navegador, sin framework ni paso de compilación. Su aspecto se inspira en los editores de flujos tipo **n8n**: un lienzo gris con puntos, tarjetas cuadradas con el nombre debajo, conexiones con puertos de entrada y salida, un **+** en cada tarjeta para seguir construyendo y controles del lienzo abajo a la izquierda.

Cada persona entra con su **cuenta de Google** y puede tener **varios árboles**. Se guardan en **Firebase Firestore**, se sincronizan en tiempo real entre sus dispositivos y además tienen respaldo en `localStorage`. **Sin sesión, GenCiel es solo de lectura**: se puede ver y recorrer, pero no agregar ni editar.

## Qué hace

| Vista | Qué muestra |
|---|---|
| **Inicio** | Tus árboles, como la lista de flujos de n8n: crear, abrir, renombrar, duplicar, eliminar, buscar y ordenar. Se entra por aquí. |
| **Árbol** | Lienzo infinito con zoom. De **izquierda a derecha** (estilo n8n) o de **arriba abajo**, con franjas por generación ("Generación I, II, III…"). |
| **Línea de tiempo** | Una barra por vida, desde el nacimiento hasta hoy o hasta su partida, con ♥ en el inicio de cada unión. |
| **Parentesco** | Eliges dos personas y te dice cómo son parientes y el camino que las une. |
| **Estadísticas** | Personas por generación, nacimientos por década, apellidos y lugares más comunes, género, uniones. |

**En el lienzo**
- **Tarjetas:** foto, o las iniciales en el color de su género. Debajo van el nombre completo (sin cortar), los años de vida y el lugar de nacimiento. Los fallecidos aparecen con borde punteado, ✝ y la foto atenuada.
- **El "+" de cada tarjeta** (al pasar el mouse, o siempre en celular) agrega **pareja, hijo/a, padres o hermano/a**. Los crea, los conecta, los ubica cerca y abre su ficha para escribir el nombre. Los hijos reciben el primer apellido de cada padre.
- **Barrita sobre la tarjeta:** abrir la ficha, ver su rama familiar o eliminar.
- **Al seleccionar a alguien** se resalta su familia y lo demás se atenúa.
- **Arrastrar desde el punto de salida** hasta otra tarjeta las conecta, con validación: no permite ciclos, uniones de más de 2 personas ni conexiones duplicadas, y avisa si las fechas no cuadran.
- **Botón + arriba a la derecha:** panel "Agregar al árbol" con buscador, con opciones para la persona seleccionada.
- **Controles abajo a la izquierda:** ver todo, acercar, alejar, 100 %, **Organizar** (auto-organiza por generaciones), minimapa y leyenda.
- **De lejos** las tarjetas solo muestran el nombre, más grande.

**Ficha de una persona** (como la vista de detalle de un nodo en n8n)
- **Izquierda, "Viene de":** padres y hermanos.
- **Centro:** datos y notas.
- **Derecha, "Continúa en":** parejas, con su unión, e hijos.
- Tocar a un pariente abre su ficha. Desde cada columna se puede agregar familia.
- Los cambios se guardan al momento. "Listo" solo cierra.
- **Foto:** se sube desde el dispositivo y se reduce a 160×160 px, o se pega un enlace.
- En celular la ficha ocupa la pantalla completa, con pestañas **Datos / Familia / Notas**.

**Otros**
- Buscador (Ctrl + K).
- Deshacer y rehacer (Ctrl + Z / Ctrl + Y).
- Modo claro y oscuro: se guarda en cada dispositivo y sigue el del sistema la primera vez.
- Exportar imagen PNG o SVG, exportar e importar respaldo JSON.

**Parentescos que reconoce**
- **Por sangre:** padre/madre, abuelo, bisabuelo, tatarabuelo (y al revés: hijo, nieto, bisnieto…), hermano y medio hermano, tío y tío abuelo, sobrino y sobrino nieto, primo hermano, segundo, tercero…, y los casos cruzados ("prima hermana de los padres de…", "hijo de un primo hermano de…").
- **Familia política:** pareja o expareja, suegro, yerno/nuera, cuñado, padrastro, hijastro, consuegro.

## Configuración de Firebase (una sola vez)

Proyecto: `genciel-ee18b` en la [consola de Firebase](https://console.firebase.google.com/).

1. **Activar el inicio de sesión con Google:** *Build → Authentication → Get started → Sign-in method → Google → Enable*. Elige el correo de soporte y guarda.
2. **Autorizar el dominio de la página:** *Authentication → Settings → Authorized domains → Add domain* y escribe el dominio donde está publicada (por ejemplo `tu-usuario.github.io`). `localhost` ya viene autorizado.
3. **Publicar las reglas de Firestore:** *Build → Firestore Database → Rules*. Pega esto y pulsa **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cada cuenta solo puede leer y escribir sus propios árboles
    match /users/{uid}/trees/{treeId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    // Versión anterior (pública): solo lectura con sesión, para migrar el árbol una vez
    match /trees/{treeId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

4. **Después de entrar la primera vez** y ver tu árbol, cierra por completo la versión anterior cambiando la regla de `trees` a `allow read, write: if false;`. Así nadie más puede leer el árbol viejo.

> La `apiKey` de Firebase para web no es un secreto: lo que protege los datos son las reglas. Opcional: en *Google Cloud → APIs y servicios → Credenciales* puedes restringir la API key a tu dominio.

### Cómo funciona la cuenta

- **Sin cuenta:** el árbol vive solo en ese dispositivo (`localStorage`). El indicador dice "Sin cuenta · solo en este dispositivo".
- **Al entrar con Google:** el árbol se guarda en `users/{uid}/trees/{treeId}` y se sincroniza en tiempo real.
- **Varios árboles:** cada uno es un documento `users/{uid}/trees/{id}` con su nombre (`name`). Abrir uno carga `?tree={id}`; el primero se llama `principal`.
- **Primera vez con una cuenta:**
  - Si la cuenta aún no tiene árbol, se sube lo que hay en el dispositivo.
  - Si el dispositivo está vacío, se trae el árbol de la versión anterior (`trees/{treeId}`). Esto solo pasa para la primera cuenta que entra en ese dispositivo.
  - Si la cuenta ya tenía árbol, gana el de la cuenta y lo del dispositivo se guarda como copia (`…:antes-de-iniciar`).
- **Otra cuenta en el mismo dispositivo:** nunca recibe el árbol de la anterior. Ese árbol se guarda aparte (`…:otra-cuenta`).
- **Cerrar sesión:** el árbol queda en el dispositivo. La opción "Cerrar sesión y borrar de este dispositivo" sirve para un equipo prestado.
- **Sin conexión:** los cambios quedan en cola y se suben al volver. Si cierras con cambios sin subir, al volver ganan los locales.
- **Conflictos entre dispositivos:** gana la última escritura (documento completo).
- **Tamaño:** el límite de Firestore es ~1 MB por árbol. Cada foto subida pesa ~8–15 KB; si el árbol se acerca al límite, la app avisa.

## Ejecutar en local

Los módulos ES no funcionan abriendo `index.html` con doble clic (`file://`). Sirve la carpeta por HTTP:

```bash
python3 -m http.server 8080
```

Abre http://localhost:8080. Para publicar, sirve con cualquier hosting estático, por ejemplo GitHub Pages: *Settings → Pages → rama `main`, raíz*. Hay varios árboles por cuenta con `?tree=nombre`.

## Estructura

```
genciel/
├── index.html        Barra superior, vistas, lienzo, panel "Agregar", ficha
├── style.css         Tema claro/oscuro (variables), lienzo, nodos, ficha, vistas, responsive
└── js/
    ├── config.js     Constantes, geometría de los nodos, colores del tema, Firebase
    ├── state.js      Estado único, bus de eventos, geometría según la dirección, utilidades
    ├── model.js      Normalización, validación, CRUD, generaciones, familia y "agregar rápido"
    ├── kinship.js    Cálculo de parentesco (sangre y política)
    ├── history.js    Deshacer / rehacer por instantáneas
    ├── sync.js       Cuenta de Google + Firestore + respaldo local + migración
    ├── render.js     Tarjetas, conexiones y franjas de generación (reconciliación por id)
    ├── view.js       Pan/zoom, encuadre, detalle según el zoom, foco familiar
    ├── gestures.js   Pointer Events: mover, arrastrar, conectar, pellizcar; botones de la tarjeta
    ├── panel.js      Ficha (columnas Viene de / datos / Continúa en)
    ├── layout.js     Organizar por generaciones (horizontal o vertical)
    ├── timeline.js   Línea de tiempo
    ├── kinview.js    Vista de parentesco
    ├── home.js       Inicio: lista de árboles de la cuenta
    ├── stats.js      Estadísticas
    ├── minimap.js    Minimapa
    ├── exporter.js   Imagen PNG / SVG con el estilo del tema
    ├── search.js     Buscador rápido
    └── main.js       Pestañas, controles, menús, cuenta, atajos y arranque
```

### Principios

1. **Un único estado** (`state.js`). Los índices `nodeMap`, `unionsOf` y `edgesOf` se reconstruyen en `reindex()` y nunca se guardan.
2. **El modelo no conoce el DOM:** `model.js`, `kinship.js` y `history.js` mutan o leen el grafo y emiten eventos.
3. **Sin dependencias circulares:** los módulos se comunican por un bus de eventos (`render`, `rendered`, `graph:changed`, `graph:replaced`, `view`, `nodemoved`, `panel:close`, `sync:status`, `auth`, `orient`, `addmenu`, `nodetool`, `goto:person`, `goto:tab`, `kin:from`).
4. **Arrastre fluido:** los nodos se mueven con `transform` y, por frame, solo se recalculan las conexiones del nodo que se mueve.

### Modelo de datos

```jsonc
{
  "orient": "h",            // "h" = izquierda→derecha · "v" = arriba→abajo (los árboles antiguos son "v")
  "nodes": [
    { "id": "p_x1", "type": "person", "position": { "x": 0, "y": 0 },     // position = centro de la caja
      "data": { "firstName": "", "lastName": "", "gender": "M|F|O", "birthPlace": "",
                "birthDate": "YYYY-MM-DD", "deathDate": "", "description": "", "img": "" } },   // img: enlace o data:image/jpeg
    { "id": "u_x2", "type": "union", "position": { "x": 150, "y": 0 },
      "data": { "status": "active|separated|divorced", "startDate": "", "endDate": "" } }
  ],
  "edges": [
    { "id": "e_1", "source": "p_x1", "target": "u_x2" },                          // persona → unión = pareja
    { "id": "e_2", "source": "u_x2", "target": "p_x3", "relationType": "blood" }  // unión → persona = hijo/a (blood | adopted | stepchild)
  ]
}
```

## Atajos de teclado

| Tecla | Acción |
|---|---|
| Ctrl + K | Buscar persona |
| N | Abrir "Agregar al árbol" |
| 0 | Ver todo el árbol |
| + / − | Acercar / alejar |
| L | Organizar por generaciones |
| M | Mostrar u ocultar el minimapa |
| Ctrl + Z / Ctrl + Y | Deshacer / rehacer |
| Enter | Abrir la ficha de la tarjeta enfocada |
| Esc | Cerrar menú, ficha, panel o foco |
| Doble clic en una línea | Eliminar esa conexión |

## Solución de problemas

| Mensaje | Qué hacer |
|---|---|
| "El inicio de sesión con Google aún no está activado" | Paso 1 de la configuración. |
| "Este dominio no está autorizado" | Paso 2: agrega el dominio de la página. |
| "La nube denegó el acceso" | Paso 3: publica las reglas. |
| "No se pudo cargar Firebase" | Sin conexión en la primera visita: la app sigue en modo local. |
