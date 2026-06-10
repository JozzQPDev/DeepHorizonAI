// Normalizamos la URL eliminando la barra final si existe para evitar rutas como //health o //predict
export const API_URL = (
  import.meta.env.PUBLIC_API_URL || "https://jhonqp-deeporizon-ppe-api.hf.space/"
).replace(/\/$/, "");

console.log("[PPE Monitor] API_URL resolved to =", API_URL);

/* ==========================================
   TIPOS
========================================== */

export interface Detection {
  class_id: number;
  class_name: string;
  confidence: number;

  bbox_xyxy: [number, number, number, number];

  bbox_xywh?: [number, number, number, number];

  center?: {
    x: number;
    y: number;
  };

  width?: number;
  height?: number;

  is_violation: boolean;
}

export interface PredictResult {
  success: boolean;

  timestamp: string;
  device: string;

  image: {
    width: number;
    height: number;
  };

  settings: {
    confidence: number;
    iou: number;
    imgsz: number;
  };

  inference: {
    seconds: number;
    milliseconds: number;
  };

  stats: {
    total_objects: number;
    total_violations: number;
    by_class: Record<string, number>;
  };

  violations: Detection[];
  detections: Detection[];
}

export interface ModelInfo {
  model: string;
  device: string;
  total_classes: number;
  classes: Record<string, string>;
}

export interface PredictOptions {
  conf?: number;
  iou?: number;
  imgsz?: number;
  timeout?: number;
}

/* ==========================================
   UTILIDADES
========================================== */

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 15000,
) {
  const controller = new AbortController();

  const id = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(id);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `API Error ${response.status}`;
  let body = "";

  try {
    const data = await response.json();
    if (data.detail) {
      body = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    }
  } catch {
    try {
      body = await response.text();
    } catch {}
  }

  if (body) {
    message += ` - ${body}`;
    // Log extendido para depuración en consola
    console.group(`[PPE API Error] ${response.status} en ${response.url}`);
    console.error("Detalle del servidor:", body);
    console.dir(response);
    console.groupEnd();
  }

  throw new Error(message);
}

/* ==========================================
   HEALTH
========================================== */
export async function healthCheck(): Promise<boolean> {
  // Ponemos /health primero ya que es el estándar de tu API
  const candidates = ["/health", "/", "/model-info"];

  for (const path of candidates) {
    const url = `${API_URL}${path}`;
    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          cache: "no-store"
        },
        3000, // Timeout más agresivo para la detección inicial
      );

      if (response.ok) {
        console.log(`[Monitor] API detected at ${path}`);
        return true;
      }
      
      // Si recibimos 401/403 la API está ahí, solo requiere permisos
      if (response.status === 401 || response.status === 403) return true;
    } catch (err) {
      // Fallo de conexión o CORS
      continue;
    }
  }

  return false;
}

/* ==========================================
   INFO DEL MODELO
========================================== */

export async function getModelInfo(): Promise<ModelInfo> {
  const url = `${API_URL}/model-info`;
  
  const response = await fetchWithTimeout(url, {
    cache: 'no-store'
  });

  if (!response.ok) {
    await parseError(response);
  }

  let data = await response.json();
  
  // Si la API devuelve un string JSON en lugar de un objeto (común en malas configs de FastAPI)
  if (typeof data === 'string' && data.startsWith('{')) {
    try { data = JSON.parse(data); } catch(e) {}
  }
  
  // Verificación de integridad de datos
  if (!data || typeof data !== 'object') {
    throw new Error("Respuesta de modelo inválida");
  }
  
  return data as ModelInfo;
}

/* ==========================================
   DETECCIÓN DE FRAME
========================================== */

export async function sendFrame(
  blob: Blob,
  options: PredictOptions = {},
): Promise<PredictResult> {
  const { conf = 0.25, iou = 0.45, imgsz = 640, timeout = 15000 } = options;

  // Log mínimo para debug de conectividad
  // (no spamear cada frame si está muy activo; limitamos a cada ~5s)

  const formData = new FormData();

  formData.append("file", blob, "frame.jpg");

  formData.append("conf", conf.toString());

  formData.append("iou", iou.toString());

  formData.append("imgsz", imgsz.toString());

  const url = `${API_URL}/predict`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      body: formData,
    },
    timeout,
  );

  if (!response.ok) {
    await parseError(response);
  }

  return response.json();
}

/* ==========================================
   VIDEO → FRAME → API
========================================== */

export async function videoFrameToBlob(
  video: HTMLVideoElement,
  quality = 0.9,
): Promise<Blob> {
  const canvas = document.createElement("canvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("No se pudo obtener el contexto del canvas");
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo generar la imagen"));
          return;
        }

        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/* ==========================================
   OBTENER TODAS LAS CLASES DETECTADAS
========================================== */

export function getDetectedClasses(result: PredictResult): string[] {
  return [...new Set(result.detections.map((d) => d.class_name))];
}

/* ==========================================
   FILTRAR DETECCIONES
========================================== */

export function filterDetections(
  detections: Detection[],
  classes: string[],
): Detection[] {
  if (!classes.length) {
    return detections;
  }

  return detections.filter((d) => classes.includes(d.class_name));
}

/* ==========================================
   SOLO VIOLACIONES
========================================== */

export function getViolations(detections: Detection[]): Detection[] {
  return detections.filter((d) => d.is_violation);
}

/* ==========================================
   ESTADÍSTICAS
========================================== */

export function countByClass(detections: Detection[]): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const detection of detections) {
    stats[detection.class_name] = (stats[detection.class_name] || 0) + 1;
  }

  return stats;
}
