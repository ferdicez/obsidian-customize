import { Menu, setIcon } from "obsidian";
import { iconeDaView, modoDaView, type DadosAbas, type ModoExibicao } from "./dados";
import { lerViewsDoArquivo, type ViewDoArquivo } from "./leitor-base";
import { abrirConfigNativaDaView, encontrarToolbar, nomeViewAtiva, trocarPara } from "./seletor-nativo";
import type { App } from "obsidian";

/** Ícone Lucide padrão por tipo de view, quando a usuária não escolheu um. */
const ICONE_POR_TIPO: Record<string, string> = {
	table: "table",
	cards: "layout-grid",
	list: "list",
	map: "map",
	calendar: "calendar",
	gallery: "layout-grid",
};
const ICONE_FALLBACK = "layout-grid";

export interface CallbacksBarra {
	/** caminho do arquivo .base desta view (ou null se desconhecido). */
	caminhoBase: () => string | null;
	/** abre o fluxo de escolher ícone para (caminhoBase, nomeView). */
	escolherIcone: (caminhoBase: string | null, nomeView: string) => void;
	/** define o modo de exibição da aba (ícone+nome / só ícone / só nome) e persiste. */
	definirModo: (caminhoBase: string | null, nomeView: string, modo: ModoExibicao) => void;
	/**
	 * (Fase 2) Lista de nomes de views a mostrar, na ordem desejada. Se undefined/null, mostra todas
	 * as views do arquivo. Se definido, filtra e reordena por essa lista (nomes inexistentes ignorados).
	 */
	filtrarViews?: () => string[] | null;
}

/**
 * Barra de abas de UMA Base. Lê as views do arquivo .base, injeta uma barra própria na toolbar nativa,
 * renderiza uma aba por view (ícone Lucide + nome), marca a ativa (via data-view-name) e liga o clique
 * à troca de view nativa. Idempotente: só re-renderiza quando o "hash" muda, evitando flicker.
 *
 * Sem medição de overflow (mantido simples e leve — a medição em bases grandes travava o app).
 * Se as abas não couberem, a toolbar nativa já lida com o espaço; excesso simplesmente transborda.
 */
export class BarraDeAbas {
	private barraEl: HTMLElement | null = null;
	private hashAtual = "";

	constructor(
		private app: App,
		private basesViewEl: HTMLElement,
		private dados: DadosAbas,
		private callbacks: CallbacksBarra
	) {}

	atualizar(dados: DadosAbas): void {
		this.dados = dados;
		try {
			const toolbar = encontrarToolbar(this.basesViewEl);
			if (!toolbar) return;

			const caminho = this.callbacks.caminhoBase();
			const todas = lerViewsDoArquivo(this.app, caminho);
			if (todas.length === 0) return; // cache do .base ainda não preenchido; próximo escaneamento resolve.

			const views = this.aplicarFiltro(todas);
			if (views.length === 0) return; // filtro não casou com nenhuma view; nada a mostrar.
			const curado = !!this.callbacks.filtrarViews?.();

			const ativa = nomeViewAtiva(this.basesViewEl) ?? "";
			const hash =
				views
					.map(
						(v) =>
							`${v.nome}:${iconeDaView(this.dados, caminho, v.nome) ?? ""}:${modoDaView(this.dados, caminho, v.nome)}`
					)
					.join("|") +
				"#" + ativa + (curado ? "@curado" : "");
			if (hash === this.hashAtual && this.barraEl?.isConnected) return;
			this.hashAtual = hash;

			toolbar.classList.add("base-tabs-ativo");
			// no embed curado, a toolbar fica "só pra visualizar" (esconde config, deixa só a lupa).
			toolbar.classList.toggle("base-tabs-em-embed", curado);
			this.render(toolbar, views, ativa, caminho);
		} catch (e) {
			console.warn("[base-tabs] falha ao atualizar barra:", e);
		}
	}

	/**
	 * Aplica o filtro de views da Fase 2: se `filtrarViews()` devolver uma lista, mantém só as views
	 * cujos nomes estão nela, na ordem da lista. Se não houver filtro, devolve todas.
	 */
	private aplicarFiltro(todas: ViewDoArquivo[]): ViewDoArquivo[] {
		const filtro = this.callbacks.filtrarViews?.();
		if (!filtro || filtro.length === 0) return todas;
		const porNome = new Map(todas.map((v) => [v.nome, v]));
		return filtro.map((nome) => porNome.get(nome)).filter((v): v is ViewDoArquivo => !!v);
	}

	private render(toolbar: HTMLElement, views: ViewDoArquivo[], nomeAtiva: string, caminho: string | null): void {
		if (this.barraEl) this.barraEl.remove();
		// remove qualquer barra órfã já presente nesta toolbar (garante uma única barra por toolbar).
		toolbar.querySelectorAll(":scope > .base-tabs-barra").forEach((el) => el.remove());

		const barra = document.createElement("div");
		barra.className = "base-tabs-barra";
		views.forEach((view) => barra.appendChild(this.criarAba(view, nomeAtiva, caminho)));

		toolbar.prepend(barra);
		this.barraEl = barra;
	}

	/** Cria uma aba (ícone/nome conforme o modo + cliques + menu de contexto). */
	private criarAba(view: ViewDoArquivo, nomeAtiva: string, caminho: string | null): HTMLElement {
		const aba = document.createElement("button");
		aba.className = "base-tabs-aba";
		aba.type = "button";
		if (view.nome === nomeAtiva) aba.classList.add("is-active");

		const modo = modoDaView(this.dados, caminho, view.nome);

		if (modo !== "so-nome") {
			const iconeEl = aba.createSpan({ cls: "base-tabs-aba-icone" });
			const icone = iconeDaView(this.dados, caminho, view.nome) ?? ICONE_POR_TIPO[view.tipo] ?? ICONE_FALLBACK;
			setIcon(iconeEl, icone);
		}
		if (modo !== "so-icone") {
			aba.createSpan({ cls: "base-tabs-aba-nome", text: view.nome });
		}
		if (modo === "so-icone") aba.setAttribute("aria-label", view.nome);

		aba.addEventListener("click", () => {
			if (view.nome !== nomeViewAtiva(this.basesViewEl)) void trocarPara(this.basesViewEl, view.nome);
		});
		aba.addEventListener("contextmenu", (ev) => this.abrirMenuContexto(ev, view, caminho, modo));
		return aba;
	}

	private abrirMenuContexto(ev: MouseEvent, view: ViewDoArquivo, caminho: string | null, modo: ModoExibicao): void {
		ev.preventDefault();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Escolher ícone…")
				.setIcon("image")
				.onClick(() => this.callbacks.escolherIcone(caminho, view.nome))
		);
		menu.addSeparator();
		const opcoes: Array<{ modo: ModoExibicao; titulo: string; icone: string }> = [
			{ modo: "ambos", titulo: "Ícone e nome", icone: "layout-list" },
			{ modo: "so-icone", titulo: "Só ícone", icone: "image" },
			{ modo: "so-nome", titulo: "Só nome", icone: "type" },
		];
		for (const op of opcoes) {
			menu.addItem((item) =>
				item
					.setTitle(op.titulo)
					.setIcon(op.icone)
					.setChecked(modo === op.modo)
					.onClick(() => this.callbacks.definirModo(caminho, view.nome, op.modo))
			);
		}
		menu.addSeparator();
		// devolve o acesso às ações nativas da view (renomear, duplicar, excluir, etc.), que ficam
		// no menu do Obsidian escondido junto com o seletor.
		menu.addItem((item) =>
			item
				.setTitle("Configurar view (menu do Obsidian)…")
				.setIcon("settings-2")
				.onClick(() => {
					// troca para a view primeiro (o menu nativo age sobre a view atual), depois abre.
					if (view.nome !== nomeViewAtiva(this.basesViewEl)) {
						void trocarPara(this.basesViewEl, view.nome).then(() =>
							abrirConfigNativaDaView(this.basesViewEl, view.nome)
						);
					} else {
						void abrirConfigNativaDaView(this.basesViewEl, view.nome);
					}
				})
		);
		menu.showAtMouseEvent(ev);
	}

	destruir(): void {
		try {
			this.barraEl?.remove();
			const toolbar = encontrarToolbar(this.basesViewEl);
			toolbar?.classList.remove("base-tabs-ativo", "base-tabs-em-embed");
		} catch {
			/* nada a fazer */
		}
		this.barraEl = null;
		this.hashAtual = "";
	}
}
