import type { App, TFile } from "obsidian";
import { BarraDeAbas } from "./barra-de-abas";
import type { DadosAbas, ModoExibicao } from "./dados";
import { preencherCacheBase } from "./leitor-base";

/**
 * Cérebro do plugin. Observa o workspace, encontra cada Base renderizada (.bases-view) e mantém
 * uma BarraDeAbas por Base (via WeakMap, para não duplicar). Antes de renderizar, garante que o
 * conteúdo do arquivo .base está em cache (leitura assíncrona) — as views vêm do arquivo, não do DOM.
 */
const DEBOUNCE_MS = 200;

export class GerenciadorDeAbas {
	private observer: MutationObserver | null = null;
	private barras = new WeakMap<HTMLElement, BarraDeAbas>();
	private timer: number | null = null;
	private cacheEmAndamento = new Set<string>();
	/** enquanto true, ignoramos mutações — são as que NÓS causamos ao injetar a barra. */
	private mexendoNoDom = false;

	constructor(
		private app: App,
		private getDados: () => DadosAbas,
		private escolherIcone: (caminhoBase: string | null, nomeView: string) => void,
		private definirModo: (caminhoBase: string | null, nomeView: string, modo: ModoExibicao) => void
	) {}

	iniciar(): void {
		const raiz = this.app.workspace.containerEl;
		this.observer = new MutationObserver((mutacoes) => this.aoMutar(mutacoes));
		this.observer.observe(raiz, { childList: true, subtree: true });
		this.agendarEscaneamento();
	}

	/**
	 * Filtra as mutações: só reage quando uma .bases-view/.bases-toolbar realmente aparece ou some.
	 * Bases grandes (milhares de cards) geram muitas mutações irrelevantes — ignorá-las evita loop e
	 * travamento. Também ignoramos mutações causadas pela nossa própria injeção (guard mexendoNoDom).
	 */
	private aoMutar(mutacoes: MutationRecord[]): void {
		if (this.mexendoNoDom) return;
		for (const m of mutacoes) {
			// só nos interessam nós adicionados/removidos que sejam (ou contenham) uma base/toolbar.
			const nos = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
			for (const no of nos) {
				if (!(no instanceof HTMLElement)) continue;
				if (
					no.matches?.(".bases-view, .bases-toolbar") ||
					no.querySelector?.(".bases-view, .bases-toolbar")
				) {
					this.agendarEscaneamento();
					return;
				}
			}
		}
	}

	agendarEscaneamento(): void {
		if (this.timer !== null) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.escanear();
		}, DEBOUNCE_MS);
	}

	private escanear(): void {
		const dados = this.getDados();
		const bases = document.querySelectorAll<HTMLElement>(".bases-view");
		// enquanto injetamos/atualizamos as barras, ignoramos as mutações que nós mesmos causamos
		// (senão o MutationObserver dispara de volta e entra em loop). Solta no próximo tick.
		this.mexendoNoDom = true;
		try {
			bases.forEach((baseEl) => {
				// Ignora bases dentro de um embed curado (Fase 2): geridas pelo processador do bloco.
				if (baseEl.closest(".base-tabs-embed-curado")) return;

				// Ignora EMBEDS NATIVOS (![[base]]) e bases renderizadas dentro de notas: o plugin só age
				// na base aberta como ARQUIVO (leaf do tipo "bases"). Aplicar abas em embeds de bases
				// grandes travava o app — por decisão, embeds nativos ficam 100% nativos.
				if (baseEl.closest(".internal-embed, .markdown-preview-view, .markdown-rendered, .markdown-source-view")) return;

				// Ignora .bases-view em transição/ocultas (largura 0).
				if (baseEl.offsetParent === null || baseEl.getBoundingClientRect().width === 0) return;

				const caminho = this.caminhoDaBase(baseEl);
				if (caminho) this.garantirCache(caminho);

				let barra = this.barras.get(baseEl);
				if (!barra) {
					barra = new BarraDeAbas(this.app, baseEl, dados, {
						caminhoBase: () => this.caminhoDaBase(baseEl),
						escolherIcone: this.escolherIcone,
						definirModo: this.definirModo,
					});
					this.barras.set(baseEl, barra);
				}
				barra.atualizar(dados);
			});
		} finally {
			// solta o guard depois que as mutações da injeção já foram enfileiradas e ignoradas.
			window.setTimeout(() => (this.mexendoNoDom = false), 0);
		}
	}

	/** Lê o .base em background (uma vez por caminho) e reescaneia ao concluir. */
	private garantirCache(caminho: string): void {
		if (this.cacheEmAndamento.has(caminho)) return;
		this.cacheEmAndamento.add(caminho);
		preencherCacheBase(this.app, caminho).finally(() => {
			this.cacheEmAndamento.delete(caminho);
			this.agendarEscaneamento();
		});
	}

	/**
	 * Descobre o caminho do arquivo .base a partir do elemento .bases-view.
	 * 1) leaf do tipo "bases" cujo container contém este elemento → file.path.
	 * 2) embed: atributo src/data-path do container do embed.
	 */
	private caminhoDaBase(baseEl: HTMLElement): string | null {
		const leaves = this.app.workspace.getLeavesOfType("bases");
		for (const leaf of leaves) {
			const containerEl = (leaf.view as { containerEl?: HTMLElement }).containerEl;
			if (containerEl && containerEl.contains(baseEl)) {
				const file = (leaf.view as { file?: TFile }).file;
				if (file?.path) return file.path;
			}
		}
		const embed = baseEl.closest<HTMLElement>(".bases-embed, .internal-embed[src], [data-path], [src]");
		const src = embed?.getAttribute("src") ?? embed?.getAttribute("data-path");
		if (src) {
			// embeds podem ter forma "Arquivo.base" ou "Arquivo" — normaliza para .base.
			return src.endsWith(".base") ? src : `${src}.base`;
		}
		return null;
	}

	reescanear(): void {
		this.agendarEscaneamento();
	}

	destruir(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		document.querySelectorAll<HTMLElement>(".bases-view").forEach((baseEl) => {
			this.barras.get(baseEl)?.destruir();
		});
		this.barras = new WeakMap();
	}
}
