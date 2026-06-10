import type { PredictResult, Detection } from "./api";

export const CLASS_COLORS: Record<string, string> = {
  'Helmet': '#f59e0b',
  'Gloves': '#06b6d4',
  'Vest': '#a855f7',
  'Boots': '#f97316',
  'Goggles': '#10b981',
  'Person': '#3b82f6',
  'no_helmet': '#ef4444',
  'no_goggle': '#ef4444',
  'no_gloves': '#ef4444',
  'no_boots': '#ef4444',
  'none': '#6b7280'
};

/**
 * Mapeo de traducción para las clases del modelo de IA.
 */
export const CLASS_LABELS: Record<string, string> = {
  'Helmet': 'Casco',
  'Gloves': 'Guantes',
  'Vest': 'Chaleco',
  'Boots': 'Botas',
  'Goggles': 'Lentes',
  'Person': 'Persona',
  'no_helmet': 'Alerta de Casco',
  'no_goggle': 'Alerta de Lentes',
  'no_gloves': 'Alerta de Guantes',
  'no_boots': 'Alerta de Botas'
};

export function translateClass(cls: string): string {
  return CLASS_LABELS[cls] || cls;
}

export function drawDetections(data: PredictResult, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !data.image || !data.detections) return;

  const scaleX = canvas.width / data.image.width;
  const scaleY = canvas.height / data.image.height;
  const baseScale = Math.max(canvas.width, canvas.height) / 1280; // Escala basada en el lado más largo

  data.detections.forEach((det: Detection) => {
    const [x1, y1, x2, y2] = det.bbox_xyxy;
    // Prioridad al rojo si es violación, sino el color de su clase
    const color = det.is_violation ? '#ef4444' : (CLASS_COLORS[det.class_name] || '#22c55e');
    const bx = x1 * scaleX, by = y1 * scaleY;
    const bw = (x2 - x1) * scaleX, bh = (y2 - y1) * scaleY;

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 2.5 * baseScale);
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6 * baseScale);
    ctx.stroke();
    
    ctx.fillStyle = `${color}15`;
    ctx.fill();

    const label = `${translateClass(det.class_name).toUpperCase()} ${(det.confidence * 100).toFixed(0)}%`;
    const fontSize = Math.max(8, 10 * baseScale);
    ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
    const metrics = ctx.measureText(label);
    const labelH = fontSize + 6, paddingH = 6 * baseScale;
    const lx = bx, ly = by > labelH + 5 ? by - labelH - 4 : by + 4;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(lx, ly, metrics.width + paddingH * 2, labelH, 4 * baseScale);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle'; // Asegura que el texto esté centrado verticalmente
    ctx.fillText(label, lx + paddingH, ly + labelH / 2 + 0.5);
  });
}