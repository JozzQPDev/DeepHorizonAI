# Deep Horizon 🛡️👷‍♂️
### Sistema de Monitoreo Inteligente de EPP

**Deep Horizon** es una plataforma avanzada de monitoreo en tiempo real diseñada para garantizar la seguridad industrial mediante la detección automatizada de Equipos de Protección Personal (EPP). Utilizando modelos de visión artificial de última generación, el sistema identifica proactivamente el uso de cascos, guantes, chalecos y otros implementos críticos en entornos laborales.

## 🚀 Características Principales

- **Detección Multi-fuente Híbrida:** 
    - Soporte nativo para cámaras Web locales (Webcam).
    - Integración de cámaras IP/WiFi mediante protocolos de transmisión MJPEG.
    - Sistema de vinculación rápida mediante escaneo de códigos QR.
- **Análisis en Tiempo Real:** Interfaz de baja latencia con procesamiento de fotogramas optimizado mediante Canvas API.
- **Gestión de Infracciones:**
    - Historial inteligente con miniaturas dinámicas.
    - Sistema de alertas sonoras y visuales (Toasts).
    - Integración de reportes rápidos vía **WhatsApp**.
- **Filtros Personalizables:** Panel de control dinámico que permite filtrar detecciones por categorías (Casco, Guantes, Persona, etc.) con persistencia local.
- **Interfaz Industrial:** 
    - Diseño responsivo con estética "Dark Mode" de alta visibilidad.
    - Sidebar interactivo para gestión de dispositivos y estadísticas.
- **Capturas Manuales:** Funcionalidad de "Snapshot" para registro instantáneo de la escena.

## 🛠️ Stack Tecnológico

- **Frontend:** [Astro](https://astro.build/) + TypeScript.
- **Estilos:** Tailwind CSS con arquitectura de diseño moderna.
- **Procesamiento de Imagen:** HTML5 Canvas API para el renderizado de *Bounding Boxes* de alta performance.
- **Comunicación:** Fetch API con gestión avanzada de `AbortController` y timeouts para robustez de red.
- **Backend (Referencia):** API basada en FastAPI con modelos YOLOv8 para inferencia de alta precisión.

## 📂 Estructura del Proyecto

```text
src/
├── lib/
│   ├── api.ts                 # Cliente de integración con el servicio de IA.
│   ├── detector-controller.ts  # Orquestador del ciclo de vida del video y análisis.
│   ├── detector-utils.ts       # Funciones matemáticas de dibujo y normalización de coordenadas.
│   └── filter-controller.ts    # Gestión de estados y persistencia de filtros de usuario.
├── components/                 # Componentes de la interfaz (Astro).
├── styles/                     # Estilos globales y configuraciones de Tailwind.
└── pages/                      # Rutas principales del sitio.
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
