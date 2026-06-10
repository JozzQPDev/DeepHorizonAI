import { sendFrame, type PredictResult, type Detection } from "./api";
import { drawDetections, translateClass } from "./detector-utils";

export interface DetectorElements {
  videoEl: HTMLVideoElement;
  ipImgEl: HTMLImageElement;
  canvasEl: HTMLCanvasElement;
  container: HTMLElement | null;
  emptyState: HTMLElement | null;
  cameraSelect: HTMLSelectElement | null;
  liveInd: HTMLElement | null;
  modeText: HTMLElement | null;
  flashEl: HTMLElement | null;
  violBannerEl: HTMLElement | null;
  nameInputEl: HTMLInputElement | null;
  historyListEl: HTMLElement | null;
  qrOverlayEl?: HTMLElement | null;     // Contenedor del QR
  qrContainerEl?: HTMLElement | null;   // Donde se dibuja el QR
  resolutionEl?: HTMLElement | null;    // Elemento para mostrar la resolución
}

export class DetectorController {
  private els: DetectorElements;
  private peer: any = null;
  private currentCall: any = null; // Guardar referencia a la llamada activa
  private isCamera = false;
  private currentStream: MediaStream | null = null;
  private loopRunning = false; // Nueva bandera para controlar el bucle
  private isProcessing = false;
  private isIpCam = false;
  private isScanningQR = false;
  private lastViolationsKey = "";
  private disposed = false;
  private lastLog = { classes: new Set<string>(), time: 0 };
  private facingMode: 'user' | 'environment' = 'environment';
  private historyFilter: string | null = null; // New property for history filter
  private allHistoryItems: {
    violation?: Detection; // Optional for snapshots
    thumbnail: string | null;
    timestamp: string;
    type: 'violation' | 'snapshot';
    class_name_display: string; // Store the class name for filtering/display
  }[] = []; // New array to store all history items
  
  private idPrefix: string; // Add idPrefix to the class
  // Estado de detección
  public conf = 0.25;
  public iou = 0.45;
  public activeFilters: string[] | null = null;
  public selectedDeviceId: string | null = null;

  constructor(elements: DetectorElements, idPrefix: string = '') {
    this.els = elements;
    this.idPrefix = idPrefix; // Initialize idPrefix
    console.log(`[DetectorController v1.1] Constructor received idPrefix: '${this.idPrefix}'`);
    this.initPeer();
    this.initGlobalListeners();

    // Actualizar resolución cuando carguen los metadatos del video o la imagen IP
    this.els.videoEl.addEventListener('loadedmetadata', () => this.updateUI());
    this.els.videoEl.addEventListener('resize', () => this.updateUI());
    this.els.ipImgEl.onload = () => this.updateUI();
  }

  private initGlobalListeners() {
    window.addEventListener('ppe:setConf', (e: any) => { this.conf = e.detail; });
    window.addEventListener('ppe:setIou', (e: any) => { this.iou = e.detail; });
    window.addEventListener('ppe:setFilters', (e: any) => { this.activeFilters = e.detail; });
    // Evento específico para esta instancia de monitor
    window.addEventListener(`ppe:flipCamera:${this.idPrefix}`, () => { if(this.isCamera) this.flipCamera(); });

  }

  /**
   * Inicializa la conexión PeerJS para recibir video del móvil
   */
  private initPeer() {
    const Peer = (window as any).Peer;
    if (!Peer) {
      setTimeout(() => this.initPeer(), 1000);
      return;
    }

    if (this.peer) return; // Evitar doble inicialización

    let finalIdPart = '';
    if (this.idPrefix) {
      // Si el prefijo es 'det1-', tomamos '1'. Si es 'det-fallback-random-', tomamos 'fallback-random-'.
      finalIdPart = (this.idPrefix.match(/\d+/)?.[0]) || this.idPrefix.replace(/[^a-zA-Z0-9]/g, '');
    }

    if (!finalIdPart) {
      console.warn("[DetectorController] idPrefix vacío. Generando ID temporal para evitar colisión.");
      finalIdPart = `fallback-${Math.random().toString(36).substring(7)}`;
    }
    const peerId = `ppe-monitor-${finalIdPart}`;

    console.log("[DetectorController] Iniciando PeerJS:", peerId);
    this.peer = new Peer(peerId);

    this.peer.on('call', (call: any) => {
      console.log("[DetectorController] Recibiendo llamada remota en:", peerId);
      this.currentCall = call;
      call.answer();

      call.on('stream', (remoteStream: MediaStream) => {
        console.log("[DetectorController] Stream remoto conectado con éxito");
        this.hideQR();
        this.connectRemoteStream(remoteStream);
      });
    });

    this.peer.on('error', (err: any) => {
      if (err.type === 'unavailable-id') {
        console.error("[DetectorController] El ID de Peer ya está en uso. Reintenta o refresca.");
      }
    });
  }

  public connectRemoteStream(stream: MediaStream) {
    console.log(`[DetectorController ${this.idPrefix}] Conectando stream remoto: ${stream.id}`);
    this.stopSource();

    const video = this.els.videoEl;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;

    // Wait for metadata to load before attempting to play
    video.onloadedmetadata = () => {
      console.log(`[DetectorController ${this.idPrefix}] Video metadata loaded. Resolution: ${video.videoWidth}x${video.videoHeight}`);
      video.play().catch(e => {
        console.warn(`[DetectorController ${this.idPrefix}] Reproducción remota bloqueada por el navegador:`, e);
      });
      // Llamar a updateUI después de que el video haya tenido un momento para empezar a renderizar
      // Esto ayuda a que hasActiveSource() tenga un estado más preciso.
      setTimeout(() => this.updateUI(), 100); 
    };

    // If metadata is already loaded (e.g., stream is very fast), call onloadedmetadata manually
    if (video.readyState >= 1) { // HAVE_METADATA
      if (typeof video.onloadedmetadata === 'function') {
        (video.onloadedmetadata as any)(new Event('loadedmetadata'));
      }
    }
    
    this.isIpCam = false; // Un flujo WebRTC NO es una cámara IP (MJPEG)
    this.isCamera = true;
    this.startLoop();
  }

  private hideQR() {
    const overlay = document.getElementById(`${this.idPrefix}qr-overlay`);
    overlay?.classList.add('hidden');
    overlay?.classList.remove('flex');
    console.log(`[DetectorController ${this.idPrefix}] hideQR called. Overlay hidden: ${overlay?.classList.contains('hidden')}`);
  }

  public async startLoop() {
    if (this.loopRunning) return; // Evitar iniciar múltiples bucles
    this.loopRunning = true;

    const process = async () => {
      if (this.disposed || !this.loopRunning) { // Asegurarse de que el bucle se detenga
        this.loopRunning = false;
        return;
      }
      await this.processFrame();
      requestAnimationFrame(process);
    };
    requestAnimationFrame(process);
  }

  private async processFrame() {
    const { videoEl, ipImgEl, canvasEl, container } = this.els;
    
    // Verificación robusta de fuente activa
    const hasVideo = !!videoEl.srcObject || (videoEl.getAttribute('src') !== null && videoEl.getAttribute('src') !== "");
    const hasSource = this.isIpCam ? !!ipImgEl.src : hasVideo;
    
    let isReady = this.isIpCam 
      ? (ipImgEl.complete && ipImgEl.naturalWidth > 0)
      : (videoEl.videoWidth > 2 && videoEl.readyState >= 2); // Evitar el stub 2x2 de WebRTC

    const isPaused = this.isIpCam ? false : videoEl.paused;
    const isEnded = this.isIpCam ? false : videoEl.ended;

    if (isReady && !isPaused && !isEnded && !this.isProcessing && hasSource && !this.isScanningQR) { // Don't process frames if scanning QR
      this.isProcessing = true;
      try {
        const blob = await this.getFrameBlob();
        if (!blob) return;

        const result = await sendFrame(blob, { conf: this.conf, iou: this.iou });
        
        // Si mientras la API respondía se detuvo el controlador, abortamos el renderizado
        if (this.disposed || !this.hasActiveSource()) return;

        // Feedback visual de violaciones
        if (container) {
          const hasViolations = result.violations?.length > 0;
          container.classList.toggle('border-red-500/50', hasViolations);
          container.classList.toggle('shadow-[inset_0_0_40px_rgba(239,68,68,0.2)]', hasViolations);
        }

        this.renderLocalViolations(result.violations || []);

        // Aplicar filtros y procesar resultado
        this.filterAndEmit(result);

        // --- AUTO-AJUSTE DE RESOLUCIÓN Y ASPECT RATIO ---
        // Sincronizamos la resolución interna del canvas con la fuente original (Video o IP Cam).
        // Esto asegura que las coordenadas coincidan perfectamente sin importar el formato.
        const sourceWidth = this.isIpCam ? ipImgEl.naturalWidth : videoEl.videoWidth;
        const sourceHeight = this.isIpCam ? ipImgEl.naturalHeight : videoEl.videoHeight;

        if (canvasEl.width !== sourceWidth || canvasEl.height !== sourceHeight) {
          canvasEl.width = sourceWidth;
          canvasEl.height = sourceHeight;
          
          // Forzamos que el canvas se visualice con object-contain para alinearse al video
          canvasEl.style.width = "100%";
          canvasEl.style.height = "100%";
          canvasEl.style.objectFit = "contain";
        }

        // Limpiar el canvas antes de redibujar para evitar "fantasmas"
        const ctx = canvasEl.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        drawDetections(result, canvasEl);
      } catch (err) {
        console.error("[DetectorController] Error:", err);
      } finally {
        this.isProcessing = false;
      }
    }
  }

  public setDisposed(val: boolean) {
    this.disposed = val;
  }

  private hasActiveSource(): boolean {
    const { videoEl, ipImgEl } = this.els;
    // Verificamos contra la URL actual de la página para descartar fuentes vacías/reseteadas
    const hasVideo = !!videoEl.srcObject || (!!videoEl.src && videoEl.src !== window.location.href);
    const hasIp = this.isIpCam && !!ipImgEl.src && ipImgEl.src !== window.location.href;
    console.log(`[DetectorController ${this.idPrefix}] hasActiveSource: hasVideo=${hasVideo} (srcObject=${!!videoEl.srcObject}, src='${videoEl.src}'), hasIp=${hasIp}`);
    return hasVideo || hasIp;
  }

  private renderLocalViolations(violations: any[]) {
    const banner = this.els.violBannerEl;
    if (!banner) return;

    const isMobile = window.innerWidth < 1024;
    const key = violations.map(v => v.class_name).sort().join("|");
    if (key === this.lastViolationsKey) return;
    this.lastViolationsKey = key;
    
    // En móvil ocultamos el banner local para no duplicar con el Toast global
    banner.classList.toggle("hidden", violations.length === 0 || isMobile);
    banner.classList.toggle("flex", violations.length > 0 && !isMobile);
    banner.innerHTML = violations.map(v => `
      <div class="flex items-center gap-3 px-3 py-2 bg-red-600/90 backdrop-blur-md border border-white/20 rounded-xl shadow-xl animate-in fade-in slide-in-from-left-4 duration-300">
        <div class="w-1.5 h-1.5 rounded-full bg-white animate-pulse shadow-[0_0_8px_white]"></div>
        <div class="flex flex-col pr-2">
          <span class="text-[7px] font-black uppercase text-white/60 tracking-tighter leading-none mb-1">Infracción Detectada</span>
          <span class="text-[10px] font-bold text-white uppercase leading-none font-mono">${translateClass(v.class_name)}</span>
        </div>
      </div>
    `).join("");
  }

  private async getFrameBlob(): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    const source = this.isIpCam ? this.els.ipImgEl : this.els.videoEl;
    canvas.width = this.isIpCam ? this.els.ipImgEl.naturalWidth : this.els.videoEl.videoWidth;
    canvas.height = this.isIpCam ? this.els.ipImgEl.naturalHeight : this.els.videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise(r => canvas.toBlob(r, "image/jpeg", 0.8));
  }

  private addToHistory(violations: Detection[], thumbnail: string | null) {
    if (violations.length === 0 || !this.els.historyListEl) {
      this.lastLog = { classes: new Set(), time: 0 };
      return;
    }

    const now = Date.now();
    const currentClasses = new Set(violations.map(v => v.class_name));
    const hasNew = [...currentClasses].some(c => !this.lastLog.classes.has(c));

    if (hasNew || (now - this.lastLog.time > 4000)) {
      const timeStr = new Date().toLocaleTimeString();

      violations.forEach(v => {
        this.allHistoryItems.unshift({ // Add to the beginning of the array
          violation: v,
          thumbnail: thumbnail,
          timestamp: timeStr,
          type: 'violation',
          class_name_display: v.class_name // Store original class name for filtering
        });
      });

      this.lastLog = { classes: currentClasses, time: now };
      // Keep only the latest 20 items in the internal array
      if (this.allHistoryItems.length > 20) {
        this.allHistoryItems = this.allHistoryItems.slice(0, 20);
      }
      this.renderHistory(); // Re-render history after adding new items
    }
  }

  // New method to render history based on filter
  private renderHistory() {
    if (!this.els.historyListEl) return;

    this.els.historyListEl.innerHTML = ""; // Clear current display

    const filteredItems = this.allHistoryItems.filter(item => {
      if (this.historyFilter === null || this.historyFilter === 'all') {
        return true; // Show all if no filter or 'all' is selected
      }
      return item.class_name_display === this.historyFilter;
    });

    filteredItems.forEach(item => {
      const el = document.createElement("div");
      if (item.type === 'violation' && item.violation) {
        const v = item.violation;
        el.className = "history-item flex items-center justify-between gap-3 p-2 bg-white/[0.02] border border-white/5 rounded-xl text-[9px] font-mono animate-in fade-in slide-in-from-top-1 active:bg-white/[0.04] transition-all hover:border-red-500/30";
        el.innerHTML = `
          <div class="flex items-center gap-2 overflow-hidden">
            ${item.thumbnail ? `<img src="${item.thumbnail}" data-class="${v.class_name}" data-time="${item.timestamp}" class="w-10 h-10 object-cover rounded border border-white/5 cursor-zoom-in opacity-80 hover:opacity-100 transition-opacity" />` : ''}
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="text-red-500/70 font-bold truncate uppercase tracking-tighter">${translateClass(v.class_name)}</span>
              </div>
              <span class="text-[8px] text-slate-600">${item.timestamp}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-report p-1.5 text-slate-500 hover:text-green-500 transition-colors" data-class="${v.class_name}" data-time="${item.timestamp}">
              <i class="fa-brands fa-whatsapp text-sm"></i>
            </button>
          </div>
        `;
      } else if (item.type === 'snapshot') {
        el.className = "history-item flex items-center justify-between gap-2 px-3 py-3 bg-blue-500/10 border-l-4 border-blue-500 rounded-2xl text-[10px] font-mono animate-in zoom-in-95 shadow-lg mb-2";
        el.innerHTML = `
          <div class="flex items-center gap-2 overflow-hidden">
            <img src="${item.thumbnail}" data-class="Captura Manual" data-time="${item.timestamp}" class="w-12 h-12 object-cover rounded-lg border border-white/10 cursor-zoom-in" />
            <div class="flex flex-col min-w-0">
              <span class="text-blue-400 font-bold truncate uppercase tracking-tighter">Captura Manual</span>
              <span class="text-[9px] text-gray-500">${item.timestamp}</span>
            </div>
          </div>
          <button class="btn-report p-1 text-blue-400 hover:text-green-500 transition-colors" data-class="Captura Manual" data-time="${item.timestamp}">
            <i class="fa-brands fa-whatsapp text-sm"></i>
          </button>
        `;
      }
      this.els.historyListEl!.appendChild(el); // Append to maintain order after filtering
    });
  }

  public setHistoryFilter(filter: string | null) { // New public method
    this.historyFilter = filter;
    this.renderHistory();
  }

  private filterAndEmit(result: PredictResult) { // This method is fine
    if (this.activeFilters !== null) {
      result.detections = result.detections.filter((d: any) => this.activeFilters!.includes(d.class_name));
      result.violations = result.violations.filter((d: any) => this.activeFilters!.includes(d.class_name));
    }

    let thumbnail = null;
    if (result.violations?.length > 0) {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 400; 
      thumbCanvas.height = 300;
      const tCtx = thumbCanvas.getContext('2d');
      if (tCtx) {
        tCtx.drawImage(this.isIpCam ? this.els.ipImgEl : this.els.videoEl, 0, 0, 400, 300);
        drawDetections(result, thumbCanvas);
      }
      thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.5);
    }

    // Manejo de historial autónomo
    this.addToHistory(result.violations || [], thumbnail);

    const cameraName = this.els.nameInputEl?.value || "Cámara";
    window.dispatchEvent(new CustomEvent('ppe:result', { 
      detail: { ...result, thumbnail, cameraName },
      bubbles: true 
    }));
  }

  /**
   * Detiene permanentemente el controlador y sus procesos.
   */
  public dispose() {
    this.disposed = true;
    this.stopSource();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.renderLocalViolations([]);
  }

  public clearHistory() {
    this.allHistoryItems = []; // Clear internal array
    this.lastLog = { classes: new Set(), time: 0 };
    this.historyFilter = 'all'; // Reset filter
    this.renderHistory(); // Re-render to clear display
  }

  public stopSource() {
    if (this.els.videoEl) {
      this.els.videoEl.pause();
      this.els.videoEl.currentTime = 0; // Reiniciar la posición de reproducción del video
      // Revocar URL de objeto si existe antes de limpiar el src
      if (this.els.videoEl.src && this.els.videoEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.els.videoEl.src);
      }
      // Detener tracks del srcObject antes de anularlo
      if (this.els.videoEl.srcObject) {
        (this.els.videoEl.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
      this.els.videoEl.srcObject = null;
      this.els.videoEl.removeAttribute("src");
      this.els.videoEl.src = "";
      // No llamar a .load() aquí, ya que puede intentar cargar la URL de la página
      this.els.videoEl.onloadedmetadata = null; // Clear event listener
    }

    if (this.currentStream) {
      this.currentStream.getTracks().forEach(t => t.stop());
      this.currentStream = null;
    }

    if (this.currentCall) {
      this.currentCall.close();
      this.currentCall = null;
    }
    
    this.els.ipImgEl.src = "";
    this.isIpCam = false;
    this.isCamera = false;
    this.isProcessing = false;
    this.loopRunning = false; // Detener el bucle cuando la fuente se detiene
    this.isScanningQR = false; // Stop scanning if source is stopped
    this.lastViolationsKey = ""; // Reiniciar clave de banners

    // Limpiar el canvas de dibujos anteriores
    const ctx = this.els.canvasEl.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.els.canvasEl.width, this.els.canvasEl.height);

    this.updateUI();
    this.renderLocalViolations([]); // Limpiar banner al detener
  }

  /**
   * Alterna entre cámara frontal ('user') y trasera ('environment')
   */
  public async flipCamera() {
    if (!this.isCamera) return;
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    await this.startCamera();
  }

  public async startCamera(deviceId: string | null = null): Promise<boolean> { // Changed return type to boolean
    this.stopSource();
    this.disposed = false; // Resetear flag si se reusa el controlador
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId 
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } }
          : { facingMode: this.facingMode, width: { ideal: 1280 } }
      };
      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.els.videoEl.srcObject = this.currentStream;
      this.isCamera = true;
      this.startLoop(); // Asegurar que el loop corre
      this.updateUI();
      return true; // Indicate success
    } catch (err) {
      console.error("Camera error:", err);
      this.isCamera = false;
      this.updateUI(); // Update UI to reflect camera failure
      return false; // Indicate failure
    }
  }

  public connectIpCam(url: string) {
    this.stopSource();
    this.isIpCam = true;
    this.disposed = false;

    // Reset visual inmediato para evitar “heredar” el frame anterior
    const ctx = this.els.canvasEl.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this.els.canvasEl.width, this.els.canvasEl.height);

    this.lastViolationsKey = "";

    this.els.ipImgEl.src = url;
    this.startLoop();
    this.updateUI();
  }

  public toggleMode() {
    this.isCamera = !this.isCamera;
    if (this.isCamera) this.startCamera(this.selectedDeviceId);
    else this.stopSource();
    
    window.dispatchEvent(new CustomEvent('ppe:toggleMode', { detail: this.isCamera }));
  }

  /**
   * Realiza un escaneo de código QR utilizando el feed de video actual del monitor.
   */
  public async scanQR(loadJsQR: any, scanTextEl: HTMLElement | null): Promise<string | null> {
    try {
      const jsQR = await loadJsQR();
      this.isScanningQR = true;
      if (scanTextEl) scanTextEl.textContent = "BUSCANDO CÓDIGO...";
      
      if (!this.isCamera) await this.startCamera();

      const scan = (): Promise<string | null> => {
        if (!this.isScanningQR || this.disposed) return Promise.resolve(null);
        
        if (this.els.videoEl.readyState === this.els.videoEl.HAVE_ENOUGH_DATA) {
          const canvas = document.createElement("canvas");
          canvas.width = this.els.videoEl.videoWidth;
          canvas.height = this.els.videoEl.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(this.els.videoEl, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height);
            if (code) {
              this.isScanningQR = false;
              if (scanTextEl) scanTextEl.textContent = "¡VINCULADO!";
              return Promise.resolve(code.data);
            }
          }
        }
        return new Promise(r => requestAnimationFrame(() => r(scan())));
      };
      return await scan();
    } catch (err) {
      this.isScanningQR = false;
      if (scanTextEl) scanTextEl.textContent = "ERROR AL ESCANEAR";
      return null;
    }
  }

  public updateUI() {
    const { modeText, liveInd, cameraSelect, emptyState, videoEl, ipImgEl, resolutionEl } = this.els;
    
    if (modeText) modeText.textContent = this.isCamera ? "CERRAR CÁMARA" : (this.isIpCam ? "CERRAR MÓVIL" : "USAR CÁMARA");
    
    liveInd?.classList.toggle('hidden', !this.isCamera);
    liveInd?.classList.toggle('flex', this.isCamera);
    cameraSelect?.classList.toggle('hidden', !this.isCamera);

    const hasSource = this.hasActiveSource();

    // Mostrar resolución si hay una fuente activa
    console.log(`[DetectorController ${this.idPrefix}] updateUI: hasSource=${hasSource}, isIpCam=${this.isIpCam}, videoEl.hidden=${this.els.videoEl.classList.contains('hidden')}`);
    console.log(`[DetectorController ${this.idPrefix}] videoEl.srcObject=${!!this.els.videoEl.srcObject}, videoEl.src='${this.els.videoEl.src}'`);

    if (resolutionEl) {
      const w = this.isIpCam ? ipImgEl.naturalWidth : videoEl.videoWidth;
      const h = this.isIpCam ? ipImgEl.naturalHeight : videoEl.videoHeight;
      if (hasSource && w > 0) {
        resolutionEl.textContent = `${w}×${h}`;
        resolutionEl.parentElement?.classList.remove('hidden');
        resolutionEl.parentElement?.classList.add('flex');
        console.log(`[DetectorController ${this.idPrefix}] Resolution: ${w}x${h}`);
      } else {
        resolutionEl.parentElement?.classList.add('hidden');
        resolutionEl.parentElement?.classList.remove('flex');
      }
    }

    // Ocultamos el video si no tiene fuente activa o si estamos en modo IP (MJPEG)
    videoEl.classList.toggle('hidden', !hasSource || this.isIpCam);
    // Ocultamos el stream IP si no hay fuente o no estamos en modo IP
    ipImgEl.classList.toggle('hidden', !this.isIpCam || !hasSource);
    
    // Notificar si el modo cámara está activo para controles externos (como el botón Flip)
    window.dispatchEvent(new CustomEvent('ppe:toggleMode', { detail: this.isCamera }));

    if (emptyState) {
      emptyState.style.display = hasSource ? 'none' : 'flex';
    }

    console.log(`[DetectorController ${this.idPrefix}] UI Actualizada: hasSource=${hasSource}, videoHidden=${videoEl.classList.contains('hidden')}, emptyDisplay=${emptyState?.style.display}`);
  }


  public getIsIpCam() { return this.isIpCam; }

  /**
   * Obtiene la lista de cámaras disponibles y llena el select
   */
  public async enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      if (this.els.cameraSelect) {
        this.els.cameraSelect.innerHTML = videoDevices.map(d => 
          `<option value="${d.deviceId}">${d.label || 'Cámara ' + (this.els.cameraSelect!.length + 1)}</option>`
        ).join('');
      }
    } catch (err) {
      console.error("Error enumerating devices:", err);
    }
  }

  /**
   * Realiza una captura manual del frame actual
   */
  public async takeSnapshot() {
    const canvas = document.createElement("canvas");
    const source = this.isIpCam ? this.els.ipImgEl : this.els.videoEl;
    canvas.width = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    canvas.height = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) return;

    ctx.drawImage(source, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    
    // Disparar efecto de Flash visual
    if (this.els.flashEl) {
      this.els.flashEl.style.opacity = '1';
      setTimeout(() => { if(this.els.flashEl) this.els.flashEl.style.opacity = '0'; }, 150);
    }

    // Añadir captura al historial local
    if (this.els.historyListEl) {
      const timestamp = new Date().toLocaleTimeString();
      this.allHistoryItems.unshift({
        thumbnail: dataUrl, timestamp: timestamp, type: 'snapshot', class_name_display: 'Captura Manual'
      });
      if (this.allHistoryItems.length > 20) this.allHistoryItems = this.allHistoryItems.slice(0, 20);
      this.renderHistory();
    }

    window.dispatchEvent(new CustomEvent('ppe:snapshot', { 
      detail: { image: dataUrl, timestamp: new Date().toLocaleTimeString() },
      bubbles: true 
    }));
    if ('vibrate' in navigator) navigator.vibrate([30, 50, 30]);
  }
}
