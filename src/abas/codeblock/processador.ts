import {
	MarkdownRenderChild,
	MarkdownRenderer,
	type App,
	type MarkdownPostProcessorContext,
} from "obsidian";
import { BarraDeAbas } from "../barra-de-abas";
import type { DadosAbas, ModoExibicao } from "../dados";
import { lerViewsDoArquivo, preencherCacheBase, resolverArquivoBase } from "../leitor-base";

/** Config parseada de um bloco ```base-tabs. */
interface ConfigBloco {
	base: string | null;
	views: string[];
	/** se false, não mostra a barra de abas (só o conteúdo da base). Padrão: true. */
	abas: boolean;
}

/**
 * Processa o bloco de código ```base-tabs. Sintaxe:
 *   base: Caminho/Da/Base            (ou "Base.base"; sem extensão o plugin adiciona)
 *   views: view A, view B, view C    (lista separada por vírgula, na ordem desejada)
 *
 * Renderiza o embed NATIVO da base (![[...]]) e aplica as abas curadas por cima, mostrando só as
 * views listadas. A base é a nativa do Obsidian — o plugin só cura as abas.
 */
export class ProcessadorBaseTabs {
	constructor(
		private app: App,
		private getDados: () => DadosAbas,
		private escolherIcone: (caminhoBase: string | null, nomeView: string) => void,
		private definirModo: (caminhoBase: string | null, nomeView: string, modo: ModoExibicao) => void,
		/** registra um ouvinte de re-render (ex.: troca de ícone) e devolve a função para removê-lo. */
		private registrarOuvinteReescan: (ouvinte: () => void) => () => void
	) {}

	async processar(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		const cfg = parseConfig(source);
		if (!cfg.base) {
			el.createEl("div", { cls: "base-tabs-erro", text: "base-tabs: informe `base:` no bloco." });
			return;
		}
		const caminhoBase = cfg.base.endsWith(".base") ? cfg.base : `${cfg.base}.base`;

		const child = new EmbedCurado(
			this.app,
			el,
			caminhoBase,
			cfg.views,
			cfg.abas,
			this.getDados,
			this.escolherIcone,
			this.definirModo,
			ctx.sourcePath,
			this.registrarOuvinteReescan
		);
		ctx.addChild(child); // o Obsidian gerencia load/unload (limpeza automática ao sair da tela).
	}
}

/**
 * MarkdownRenderChild que renderiza o embed nativo da base e liga a barra de abas curada.
 * Ao ser descarregado (bloco sai da tela), o Obsidian chama onunload → desconecta o observer.
 */
class EmbedCurado extends MarkdownRenderChild {
	private observer: MutationObserver | null = null;
	private barra: BarraDeAbas | null = null;
	private removerOuvinte: (() => void) | null = null;
	private containerInterno: HTMLElement | null = null;
	private caminhoResolvido: string | null = null;
	private timerAplicar: number | null = null;
	/** enquanto true, ignoramos mutações — são as que NÓS causamos ao injetar a barra. */
	private mexendoNoDom = false;

	constructor(
		private appRef: App,
		containerEl: HTMLElement,
		private caminhoBase: string,
		private views: string[],
		private mostrarAbas: boolean,
		private getDados: () => DadosAbas,
		private escolherIcone: (caminhoBase: string | null, nomeView: string) => void,
		private definirModo: (caminhoBase: string | null, nomeView: string, modo: ModoExibicao) => void,
		private sourcePath: string,
		private registrarOuvinteReescan: (ouvinte: () => void) => () => void
	) {
		super(containerEl);
	}

	async onload(): Promise<void> {
		const container = this.containerEl.createDiv({ cls: "base-tabs-embed-curado" });
		this.containerInterno = container;

		// 1) a base existe? (resolve como o ![[...]] faz — acha pelo nome mesmo sem a pasta).
		const arquivo = resolverArquivoBase(this.appRef, this.caminhoBase, this.sourcePath);
		if (!arquivo) {
			this.erro(container, `Base não encontrada: "${this.caminhoBase}". Confira o nome do arquivo .base (pode incluir a pasta, ex.: Pasta/Nome).`);
			return;
		}

		// 2) carrega as views do arquivo e valida os nomes pedidos ANTES de renderizar.
		await preencherCacheBase(this.appRef, arquivo.path);
		this.caminhoResolvido = arquivo.path;
		const todas = lerViewsDoArquivo(this.appRef, arquivo.path);
		const nomesExistentes = new Set(todas.map((v) => v.nome));
		const pedidasValidas = this.views.filter((v) => nomesExistentes.has(v));

		if (this.views.length > 0 && pedidasValidas.length === 0) {
			const nomes = todas.map((v) => `"${v.nome}"`).join(", ") || "(nenhuma)";
			this.erro(
				container,
				`Nenhuma das views informadas existe nessa base. Você pediu: ${this.views.map((v) => `"${v}"`).join(", ")}. ` +
					`As views dessa base são: ${nomes}. Os nomes precisam ser iguais (maiúsculas e acentos contam).`
			);
			return;
		}

		// renderiza o embed nativo da base dentro do nosso container (this = Component owner).
		await MarkdownRenderer.render(this.appRef, `![[${arquivo.path}]]`, container, this.sourcePath, this);

		// `abas: não` → esconde a barra/toolbar inteira, mostrando só o conteúdo da base.
		if (!this.mostrarAbas) {
			container.classList.add("base-tabs-sem-barra");
			return;
		}

		// Toggle geral desligado no painel: o embed nativo (já renderizado acima) fica, mas sem a
		// barra curada — a base aparece com o menu suspenso do Obsidian. Assim desligar as abas não
		// faz sumir o conteúdo das notas que usam este bloco. Nem observer, nem ouvinte: com as
		// abas desligadas não há o que reaplicar.
		if (!this.getDados().ativo) return;

		// Observa a .bases-view surgir e (re)aplica a barra curada. FILTRA as mutações: só reage quando
		// (a) uma .bases-view/.bases-toolbar entra/sai, ou (b) o atributo data-view-name da .bases-view
		// muda (troca de view — precisa reaplicar pra mover o sublinhado "ativo" pra aba certa).
		// NÃO reage às mutações internas da base (cada card/linha que a base renderiza). Sem esse filtro,
		// uma base grande (milhares de cards) dispararia o observer milhares de vezes, cada uma varrendo
		// o container inteiro → layout thrashing e travamento (mesma classe de bug das partes 6/7, aqui
		// no caminho do embed curado). O data-view-name muda 1x por troca de view, então observá-lo é
		// barato e não reintroduz o travamento.
		this.observer = new MutationObserver((mutacoes) => this.aoMutar(mutacoes, container));
		this.observer.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["data-view-name"],
		});
		this.aplicar(container);

		// re-render externo (ex.: troca de ícone pelo modal).
		this.removerOuvinte = this.registrarOuvinteReescan(() => {
			if (this.containerInterno) this.aplicar(this.containerInterno);
		});
	}

	/**
	 * Filtra as mutações do observer: só reage quando uma .bases-view/.bases-toolbar entra/sai, ou
	 * quando o data-view-name de uma .bases-view muda (troca de view). Ignora as mutações internas da
	 * base (cada card/linha renderizada) — que numa base grande seriam milhares — e as que NÓS causamos
	 * ao injetar a barra (guard mexendoNoDom). Debounce agrupa rajadas de mutação num único re-aplicar.
	 */
	private aoMutar(mutacoes: MutationRecord[], container: HTMLElement): void {
		if (this.mexendoNoDom) return;
		for (const m of mutacoes) {
			// (b) troca de view: o data-view-name da .bases-view mudou.
			if (
				m.type === "attributes" &&
				m.attributeName === "data-view-name" &&
				m.target instanceof HTMLElement &&
				m.target.matches(".bases-view")
			) {
				this.agendarAplicar(container);
				return;
			}
			// (a) uma .bases-view/.bases-toolbar entrou ou saiu.
			const nos = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)];
			for (const no of nos) {
				if (!(no instanceof HTMLElement)) continue;
				if (
					no.matches?.(".bases-view, .bases-toolbar") ||
					no.querySelector?.(".bases-view, .bases-toolbar")
				) {
					this.agendarAplicar(container);
					return;
				}
			}
		}
	}

	private agendarAplicar(container: HTMLElement): void {
		if (this.timerAplicar !== null) return;
		this.timerAplicar = window.setTimeout(() => {
			this.timerAplicar = null;
			this.aplicar(container);
		}, 200);
	}

	private aplicar(container: HTMLElement): void {
		const baseEl = container.querySelector<HTMLElement>(".bases-view");
		if (!baseEl) return;
		const caminho = this.caminhoResolvido ?? this.caminhoBase;
		// Enquanto injetamos a barra, ignoramos as mutações que nós mesmos causamos (senão o observer
		// dispara de volta). Solta o guard no próximo tick, depois das mutações já enfileiradas.
		this.mexendoNoDom = true;
		try {
			if (!this.barra) {
				this.barra = new BarraDeAbas(this.appRef, baseEl, this.getDados(), {
					caminhoBase: () => caminho,
					escolherIcone: this.escolherIcone,
					definirModo: this.definirModo,
					filtrarViews: () => this.views,
				});
			}
			this.barra.atualizar(this.getDados());
		} finally {
			window.setTimeout(() => (this.mexendoNoDom = false), 0);
		}
	}

	/** Mostra uma mensagem de erro amigável no lugar do embed. */
	private erro(container: HTMLElement, texto: string): void {
		container.empty();
		container.createEl("div", { cls: "base-tabs-erro", text: `base-tabs — ${texto}` });
	}

	onunload(): void {
		this.observer?.disconnect();
		this.observer = null;
		if (this.timerAplicar !== null) {
			window.clearTimeout(this.timerAplicar);
			this.timerAplicar = null;
		}
		this.barra?.destruir();
		this.barra = null;
		this.removerOuvinte?.();
		this.removerOuvinte = null;
		this.containerInterno = null;
	}
}

/** Parse simples de `chave: valor` por linha. `views` é uma lista separada por vírgula. */
function parseConfig(source: string): ConfigBloco {
	const cfg: ConfigBloco = { base: null, views: [], abas: true };
	for (const linhaBruta of source.split("\n")) {
		const linha = linhaBruta.trim();
		if (!linha || linha.startsWith("#")) continue;
		const sep = linha.indexOf(":");
		if (sep === -1) continue;
		const chave = linha.slice(0, sep).trim().toLowerCase();
		const valor = linha.slice(sep + 1).trim();
		if (chave === "base") cfg.base = valor.replace(/^\[\[|\]\]$/g, "").trim() || null;
		else if (chave === "views" || chave === "visualizações" || chave === "visualizacoes") {
			cfg.views = valor
				.split(",")
				.map((v) => v.trim())
				.filter((v) => v.length > 0);
		} else if (chave === "abas") {
			// abas: nao / não / false / 0 / off  → esconde a barra de abas.
			cfg.abas = !/^(n[aã]o|nao|false|0|off|no)$/i.test(valor);
		}
	}
	return cfg;
}
