import { healthCheck, getModelInfo, type PredictResult, type Detection, API_URL } from "./api";
import { translateClass } from "./detector-utils";

export class MonitorController {
  private lastToastTime = 0;
  private lastSoundTime = 0;

  constructor() {
    this.init();
  }

  private init() {
    this.startHealthCheck();
    this.loadModel();
    this.startLiveClock();
    window.addEventListener("ppe:result", (e: any) => this.onPpeResult(e.detail));
    this.initActionHandlers();
  }

  private initActionHandlers() {
    // Manejador global de acciones de historial (WhatsApp, Copiar)
    // Escucha en el documento para capturar eventos de botones de historial de cualquier monitor
    document.addEventListener("click", async (e: any) => {
      const target = e.target as HTMLElement;
      
      // --- WHATSAPP ---
      const btnReport = target.closest(".btn-report") as HTMLElement;
      if (btnReport) {
        const { class: cls, time } = btnReport.dataset;
        const phone = (document.getElementById("report-phone") as HTMLInputElement)?.value.replace(/\D/g, '');
        const label = translateClass(cls || "");
        const message = `🚨 *ALERTA EPP*\n\n• *Tipo:* ${label}\n• *Hora:* ${time}\n\n_Generado por Deep Horizon._`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
      }

      // --- COPY IMAGE ---
      const btnCopy = target.closest(".btn-copy") as HTMLElement;
      if (btnCopy) {
        const img = btnCopy.closest(".history-item")?.querySelector("img");
        if (img?.src) {
          const canvas = document.createElement('canvas');
          const tempImg = new Image();
          tempImg.src = img.src;
          await tempImg.decode();
          canvas.width = tempImg.width; canvas.height = tempImg.height;
          canvas.getContext('2d')?.drawImage(tempImg, 0, 0);
          canvas.toBlob(blob => {
            if (blob) navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          }, "image/png");
          btnCopy.classList.add("text-green-400");
          setTimeout(() => btnCopy.classList.remove("text-green-400"), 2000);
        }
      }
    });
  }

  private startLiveClock() {
    const clockEl = document.getElementById("live-clock");
    setInterval(() => {
      if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();
    }, 1000);
  }

  private async startHealthCheck() {
    const check = async () => {
      const apiLabel = document.getElementById("api-label");
      const apiDot = document.getElementById("api-dot");
      if (!apiLabel) return;

      try {
        const ok = await healthCheck();
        if (ok) {
          apiLabel.textContent = "API OK";
          apiDot?.classList.remove("text-yellow-400", "text-red-400");
          apiDot?.classList.add("text-green-400");
          
          const mModel = document.getElementById("m-model");
          if (mModel && (mModel.textContent === "…" || mModel.textContent === "error" || mModel.textContent === "")) {
            this.loadModel();
          }
        } else {
          apiLabel.textContent = "OFF";
          apiDot?.classList.remove("text-yellow-400", "text-green-400");
          apiDot?.classList.add("text-red-400");
        }
      } catch {
        console.warn(`[Monitor] API inalcanzable en ${API_URL}. Verifica que el servidor esté corriendo y la IP sea accesible.`);
        apiLabel.textContent = "OFF";
      }
    };

    check();
    setInterval(check, 10000);
  }

  public async loadModel() {
    try {
      const m = await getModelInfo();
      const els = {
        model: document.getElementById("m-model"),
        device: document.getElementById("m-device"),
        classes: document.getElementById("m-classes"),
        pills: document.getElementById("m-pills"),
        filterList: document.getElementById("filter-list")
      };

      if (els.model) els.model.textContent = m.model;
      if (els.device) els.device.textContent = m.device;
      if (els.classes) els.classes.textContent = m.total_classes.toString();

      if (els.pills) {
        els.pills.innerHTML = Object.values(m.classes || {}).map(c => `
          <span class="px-2 py-1 text-[9px] bg-white/5 border border-white/10 rounded">${c}</span>
        `).join("");
      }
      
      // Notificar que el modelo cargó para que el FilterController renderice los filtros
      window.dispatchEvent(new CustomEvent("ppe:modelLoaded", { detail: m }));
    } catch (err) {
      console.error("[Monitor] LoadModel Error:", err);
    }
  }

  private onPpeResult(data: PredictResult & { thumbnail?: string, cameraName?: string }) {
    this.updateStats(data);
    
    // Notificación flotante en móvil cuando se detectan infracciones
    if (data.violations && data.violations.length > 0) {
      const now = Date.now();
      // Throttling de sonido para evitar saturación (mínimo cada 2 segundos)
      if (now - this.lastSoundTime > 2000) {
        this.playAlertSound();
        this.lastSoundTime = now;
      }

      if (window.innerWidth < 1024) { // Mostrar toast solo en móvil
        this.showViolationToast(data.violations, data.cameraName || "Cámara");
      }
    }
  }

  private updateStats(data: any) {
    const total = data.stats?.total_objects ?? 0;
    const viol = data.stats?.total_violations ?? 0;
    
    const els = {
      total: document.getElementById("s-total"),
      safe: document.getElementById("s-safe"),
      warn: document.getElementById("s-warn"),
      ms: document.getElementById("inf-ms"),
      dev: document.getElementById("inf-dev"),
      res: document.getElementById("inf-res"),
      ts: document.getElementById("inf-ts"),
      liveClasses: document.getElementById("live-classes")
    };

    if (els.total) els.total.textContent = total;
    if (els.safe) els.safe.textContent = (total - viol).toString();
    if (els.warn) els.warn.textContent = viol;
    if (els.ms) els.ms.textContent = data.inference?.milliseconds ?? "—";
    if (els.dev) els.dev.textContent = data.device ?? "—";
    if (els.res) els.res.textContent = data.image ? `${data.image.width}×${data.image.height}` : "—";
    if (els.ts) els.ts.textContent = new Date().toLocaleString();

    if (els.liveClasses) {
      const uniq = [...new Set((data.detections || []).map((d: any) => d.class_name))];
      els.liveClasses.innerHTML = uniq.map(c => `
        <span class="px-1.5 py-0.5 text-[8px] bg-white/5 border border-white/10 rounded text-gray-400">${translateClass(c)}</span>
      `).join("");
    }

    // Actualizar resumen en el handle móvil
    const handleSummary = document.getElementById("handle-summary");
    const handleDot = document.getElementById("handle-status-dot");
    if (handleSummary && handleDot) {
      handleSummary.textContent = viol > 0 ? `${viol} VIOLACIONES DETECTADAS` : "SISTEMA SEGURO";
      handleSummary.classList.toggle("text-red-500", viol > 0);
      handleDot.classList.toggle("bg-red-500", viol > 0);
      handleDot.classList.toggle("bg-green-500", viol === 0);
    }
  }

  private showViolationToast(violations: Detection[], cameraName: string) {
    const now = Date.now();
    // Evitar spam: máximo una notificación cada 5 segundos
    if (now - this.lastToastTime < 5000) return;

    const container = document.getElementById("notification-container");
    if (!container) return;

    const toast = document.createElement("div");
    // Estilo: Rojo intenso, glassmorphism con blur, bordes suaves y animación de entrada lateral
    toast.className = "bg-red-600/90 backdrop-blur-lg text-white p-3 rounded-2xl shadow-2xl border border-white/20 flex items-center gap-3 animate-in fade-in slide-in-from-left-4 duration-500 pointer-events-auto cursor-pointer active:scale-95 transition-transform";
    
    const classes = [...new Set(violations.map(v => v.class_name))];
    const label = classes.length > 1 ? "Múltiples Infracciones" : translateClass(classes[0]);

    toast.innerHTML = `
      <div class="shrink-0 w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <div class="flex flex-col pr-1">
        <span class="text-[8px] font-black uppercase tracking-widest text-white/60">${cameraName} • ALERTA</span>
        <span class="text-[11px] font-bold font-mono leading-tight">${label}</span>
      </div>
    `;

    toast.onclick = () => toast.remove();
    container.appendChild(toast);
    this.lastToastTime = now;

    // Desaparecer automáticamente después de 8 segundos con una transición suave
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-20px)';
      toast.style.transition = 'all 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 8000);
  }

  private playAlertSound() {
    const toggle = document.getElementById("toggle-sound") as HTMLInputElement;
    if (!toggle?.checked) return;

    const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
    const volume = volumeSlider ? parseFloat(volumeSlider.value) : 0.1;

    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {}
  }

  public clearHistory() {
    // El historial ahora se gestiona de forma autónoma en cada DetectorController (Panel lateral del monitor)
  }

  public clearStats() {
    const ids = ["s-total", "s-safe", "s-warn", "inf-ms", "live-classes"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = id.startsWith("inf") ? "—" : (id.startsWith("s-") ? "0" : "");
    });
  }

  public setupCollapsibles() {
    document.querySelectorAll('.collapsible-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const targetId = (header as HTMLElement).getAttribute('data-target');
        const content = targetId ? document.getElementById(targetId) : null;
        const chevron = header.querySelector('.chevron') as HTMLElement;
        if (content && chevron) {
          const isHidden = content.classList.toggle('hidden');
          chevron.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
        }
      });
    });
  }
}