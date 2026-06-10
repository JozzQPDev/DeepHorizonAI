export class FilterController {
  private filterListEl: HTMLElement | null;
  private toggleBtnEl: HTMLElement | null;

  constructor() {
    this.filterListEl = document.getElementById("filter-list");
    this.toggleBtnEl = document.getElementById("btn-toggle-filters");
    this.init();
  }

  private init() {
    // Escuchar cambios en cualquier checkbox de la lista
    this.filterListEl?.addEventListener("change", () => this.handleFilterChange());

    // Escuchar clic en el botón de alternar todos
    this.toggleBtnEl?.addEventListener("click", (e) => {
      e.stopPropagation(); // Evita que se colapse la sección al hacer clic en el botón
      this.toggleAll();
    });
    
    // Escuchar cuando el modelo carga para renderizar los filtros dinámicos
    window.addEventListener("ppe:modelLoaded", (e: any) => {
      const classes = Object.values(e.detail.classes || {}) as string[];
      this.render(classes);
    });
  }

  public render(classes: string[]) {
    if (!this.filterListEl) return;

    const savedFilters = JSON.parse(localStorage.getItem("ppe_filters") || "null");
    
    this.filterListEl.innerHTML = classes.map(c => `
      <label class="flex items-center gap-3 py-1.5 cursor-pointer group transition-all font-sans">
        <input type="checkbox" ${(!savedFilters || savedFilters.includes(c)) ? 'checked' : ''} value="${c}" class="class-filter w-4 h-4 rounded bg-white/5 border-white/20 accent-blue-500" />
        <span class="text-[10px] text-slate-400 group-hover:text-slate-200 transition-colors truncate uppercase tracking-tight">${c}</span>
      </label>
    `).join("");

    this.updateToggleText();
    this.dispatchFilters();
  }

  private handleFilterChange() {
    this.updateToggleText();
    this.dispatchFilters();
  }

  private toggleAll() {
    const checkboxes = this.filterListEl?.querySelectorAll(".class-filter") as NodeListOf<HTMLInputElement>;
    if (!checkboxes || checkboxes.length === 0) return;
    const anyUnchecked = Array.from(checkboxes).some(cb => !cb.checked);
    checkboxes.forEach(cb => cb.checked = anyUnchecked);
    this.handleFilterChange();
  }

  private updateToggleText() {
    if (!this.toggleBtnEl) return;
    const checkboxes = this.filterListEl?.querySelectorAll(".class-filter") as NodeListOf<HTMLInputElement>;
    this.toggleBtnEl.textContent = (checkboxes && checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked)) ? "Ninguno" : "Todos";
  }

  private dispatchFilters() {
    const checked = Array.from(this.filterListEl?.querySelectorAll(".class-filter:checked") || []) as HTMLInputElement[];
    const values = checked.map(cb => cb.value);
    localStorage.setItem("ppe_filters", JSON.stringify(values));
    window.dispatchEvent(new CustomEvent("ppe:setFilters", { detail: values }));
  }
}