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
