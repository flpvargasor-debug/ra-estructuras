# RA Estructuras — visor de realidad aumentada sin conexión

La app superpone una estructura proyectada sobre la existente usando la cámara del celular (Chrome en Android con ARCore).

## 1. Publicarla una vez (GitHub Pages, gratis)
1. Crea una cuenta en https://github.com (si no tienes).
2. Crea un repositorio nuevo, **público**, llamado `ra-estructuras` y marca "Add a README file".
3. En el repositorio: **Add file → Upload files**. Arrastra **todo el contenido** de esta carpeta (index.html, app.js, sw.js, manifest.webmanifest, demo.glb y las carpetas `icons` y `vendor`). Luego pulsa **Commit changes**.
4. Ve a **Settings → Pages**. En "Branch", elige `main` y carpeta `/ (root)`, luego **Save**.
5. Espera 1 a 2 minutos. La app queda en: `https://TU-USUARIO.github.io/ra-estructuras/`

En el repositorio solo queda la app y el modelo de ejemplo. **Tus modelos no se suben a ninguna parte**: se abren directamente desde el almacenamiento del celular.

## 2. Instalarla en el celular
1. Instala o actualiza **"Servicios de Google Play para RA"** desde Play Store.
2. Abre la dirección anterior en **Chrome**, con internet.
3. Menú ⋮ → **Agregar a pantalla de inicio** (o "Instalar app").
4. Desde ahí funciona **sin conexión**. El último modelo abierto queda guardado en el teléfono.

## 3. Preparar el modelo (SketchUp u otro)
- Formato recomendado: **Collada (.dae)**. También sirven .glb/.gltf y .obj (+.mtl).
- **Origen (0,0,0)** en un punto físico reconocible = **punto A** (p. ej. la esquina de una columna existente a nivel de piso).
- **Punto B**: cualquier punto real sobre el eje **+X (rojo)**, idealmente a varios metros de A.
- Pon **EXISTENTE** en el nombre de los grupos, componentes o materiales de la estructura existente. Se verán en celeste semitransparente, como referencia de calce. El texto que se busca se puede cambiar en "Opciones".
- Elimina lo que no aporta (pernos, textos, cotas) para que el modelo sea liviano.
- Si exportas texturas, selecciona el .dae junto con sus imágenes al abrirlo.

## 4. Uso en terreno
1. **Abrir modelo…** → elige el archivo en el celular.
2. **Iniciar realidad aumentada** → apunta al piso y muévete lento hasta que aparezca el círculo.
3. Apunta la cruz al punto A real → **Fijar A**. Luego al punto B real → **Fijar B**.
4. Afina el calce con **Girar / Mover** (pasos de 1 mm a 10 cm). En **Vista** ajustas las opacidades o dejas solo las aristas.
5. Si en Opciones ingresas la distancia A–B del modelo, la app la compara con la medida en terreno (sirve para chequear el seguimiento).

Precisión esperable sin marcadores: del orden de centímetros cerca de A, y la deriva crece al alejarse. Es para revisión visual y detección de interferencias gruesas, no para replanteo.

## 5. Oclusión (que lo real tape al modelo)
En la pestaña **Vista**:
- **Existente: oclusión**: la estructura existente del modelo se vuelve invisible, pero tapa lo proyectado que queda detrás de ella. Es preciso si el calce es bueno. Úsalo después de calzar en modo "referencia".
- **Profundidad cámara**: si el celular entrega profundidad (ARCore Depth), cualquier objeto real (personas, equipos, cañerías) tapa al modelo. Es aproximado: bordes irregulares y alcance útil de unos 5 a 8 m.

## 6. Modo gafas VR (visor tipo Cardboard)
1. Calza el modelo en modo normal (A, B y ajuste fino).
2. Activa la **rotación automática** del teléfono y gíralo a horizontal.
3. Toca **Gafas VR** (arriba). La pantalla se divide en dos, una imagen por ojo.
4. Pon el teléfono en el visor. Para volver al modo normal, toca la pantalla o el botón del visor.

En Opciones puedes ajustar la separación de ojos (64 mm por defecto) y el zoom. Si la imagen de la cámara aparece de cabeza, activa "Imagen de cámara invertida".
El teléfono tiene una sola cámara, así que el fondo real se ve plano (sin 3D) y solo el modelo tiene profundidad. Requiere que el equipo entregue la imagen de la cámara a Chrome ("camera-access").

## 7. Foto 360
1. Toca **Foto 360** y elige la foto (una esfera completa 2:1 o una franja panorámica).
2. Ingresa dónde se tomó, en coordenadas del modelo: **Cámara X, Y** (m, respecto del origen A) y **Altura del lente** (m).
3. Gira el **Rumbo** hasta que una columna o arista conocida coincida. Si la foto quedó torcida, corrige la **Inclinación** o el **Alabeo**.
4. Arrastra con un dedo para mirar alrededor y pellizca para acercar. **Giroscopio** te deja mirar moviendo el teléfono, y **Gafas VR** divide la pantalla.
5. **Guardar imagen** descarga una captura en PNG para tus informes.
La foto y el calce quedan guardados en el teléfono y se reabren con el botón Foto 360.
