# Deep Horizon 🛡️👷‍♂️
### Sistema de Monitoreo Inteligente de EPP

**Deep Horizon** es una plataforma avanzada de monitoreo en tiempo real diseñada para garantizar la seguridad industrial mediante la detección automatizada de Equipos de Protección Personal (EPP).

## 🚀 Características Principales

- **Detección Multi-fuente Híbrida:**
    - Soporte nativo para cámaras Web locales (Webcam).
    - Integración de cámaras IP/WiFi mediante protocolos de transmisión MJPEG.
    - Sistema de vinculación rápida mediante escaneo de códigos QR.
- **Análisis en Tiempo Real:** Interfaz de baja latencia con procesamiento optimizado y sincronización de hardware para evitar congelamientos.
- **Gestión de Infracciones:**
    - Historial dinámico con persistencia de sesión.
    - Sistema de alertas sonoras y visuales (Toasts).
    - **Alertas Bidireccionales:** Notificaciones instantáneas enviadas de vuelta al móvil vinculado mediante canales de datos.
    - Reportes instantáneos a través de **WhatsApp**.
- **Optimización Móvil:**
    - Interfaz adaptativa (Mobile-First).
    - **Resolución Inteligente:** Ajuste automático de resolución según cámara (frontal/trasera) para fluidez máxima.
    - **Monitoreo de Salud de Red:** Detección de pérdida de internet o desconexión del móvil mediante estados ICE de WebRTC.
    - Soporte para gestos táctiles en controles de navegación.
    - Notificaciones tipo Toast diseñadas para interacción con una sola mano.
- **Capturas Manuales:** Funcionalidad de "Snapshot" para registro instantáneo de la escena.

## 🏗️ Arquitectura del Software

- **Controladores Desacoplados:** Uso de clases especializadas (`DetectorController`, `MonitorController`) para separar la lógica de captura de la lógica de estadísticas.
- **Tipado Estricto:** Implementación integral de TypeScript para garantizar la integridad de los datos de inferencia desde la API hasta el renderizado.
- **Gestión de Memoria:** Reutilización de elementos Canvas y manejo de flujos de video para optimizar el rendimiento en dispositivos móviles.

## 🛠️ Stack Tecnológico

- **Frontend:** [Astro](https://astro.build/) + TypeScript.
- **Estilos:** Tailwind CSS con arquitectura de diseño moderna.
- **IA:** YOLOv11 vía API REST.

##  Uso en Móviles

Para una mejor experiencia en el navegador del celular:
1. Asegúrate de otorgar permisos de cámara.
2. Utiliza el **Sidebar táctil** deslizándolo desde la parte superior o lateral.
3. El sistema ajustará automáticamente la resolución de la detección para ahorrar datos y batería.

## 🚦 Comandos

| Comando | Acción |
| :--- | :--- |
| `npm install` | Instala las dependencias del proyecto |
| `npm run dev` | Inicia el servidor de desarrollo en `localhost:4321` |
| `npm run build` | Genera la versión de producción en `./dist/` |

---
*Desarrollado como proyecto de estudios en Visión Artificial aplicada.*

