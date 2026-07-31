import { App, Modal, getIconIds, setIcon } from "obsidian";

/**
 * Modal de busca visual de ícones, no mesmo espírito do `modal-escolher-icone.ts` do base-tabs:
 * digitar filtra por substring e clicar escolhe.
 *
 * ── A diferença que importa aqui: o prefixo `lucide-` ────────────────────────────────────
 *
 * `getIconIds()` devolve os ids já prefixados (`lucide-star`). O base-tabs tira o prefixo
 * porque passa o valor para `setIcon`, que aceita as duas formas. Aqui o valor vai para
 * `--callout-icon`, que o Obsidian resolve contra o registro de ícones — e ali o prefixo é
 * parte do id. Por isso guardamos o id COMO ELE VEM, sem fatiar.
 *
 * A busca, porém, ignora o prefixo: quem digita "star" não quer competir com o "lucide-" que
 * está em todos os ids. Daí o par `id` (o que salvamos) + `busca` (o que casamos).
 */

interface Icone {
	/** Id completo, como o Obsidian conhece: "lucide-star". É o que vai para o CSS. */
	id: string;
	/** O mesmo id sem o prefixo, em minúsculo — o texto contra o qual a busca casa. */
	busca: string;
}

let cache: Icone[] | null = null;

function todosOsIcones(): Icone[] {
	if (!cache) {
		cache = getIconIds().map((id) => ({
			id,
			busca: (id.startsWith("lucide-") ? id.slice("lucide-".length) : id).toLowerCase(),
		}));
	}
	return cache;
}

const MAX_RESULTADOS = 120;

/**
 * Ícones mostrados antes de qualquer busca, para o modal não abrir vazio. São nomes Lucide
 * comuns em callouts; os que não existirem na versão instalada do Obsidian são filtrados.
 */
const SUGESTOES = [
	"lucide-star",
	"lucide-heart",
	"lucide-flame",
	"lucide-zap",
	"lucide-lightbulb",
	"lucide-info",
	"lucide-check",
	"lucide-check-circle",
	"lucide-x-circle",
	"lucide-alert-triangle",
	"lucide-help-circle",
	"lucide-calendar",
	"lucide-calendar-check",
	"lucide-clock",
	"lucide-bell",
	"lucide-bookmark",
	"lucide-book-open",
	"lucide-pencil",
	"lucide-pin",
	"lucide-flag",
	"lucide-target",
	"lucide-rocket",
	"lucide-trophy",
	"lucide-brain",
	"lucide-eye",
	"lucide-quote",
	"lucide-list-checks",
	"lucide-folder",
	"lucide-file-text",
	"lucide-link",
	"lucide-users",
	"lucide-message-circle",
	"lucide-dollar-sign",
	"lucide-trending-up",
	"lucide-bar-chart",
	"lucide-settings",
];

export class ModalEscolherIcone extends Modal {
	private inputEl!: HTMLInputElement;
	private resultadosEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private valor: string | undefined;

	constructor(
		app: App,
		private contexto: string,
		valorInicial: string | undefined,
		private onEscolher: (icone: string | undefined) => void,
	) {
		super(app);
		this.valor = valorInicial;
	}

	onOpen(): void {
		this.titleEl.setText(`Ícone — ${this.contexto}`);
		const wrap = this.contentEl.createDiv({ cls: "customize-icon-picker" });

		const linha = wrap.createDiv({ cls: "customize-icon-picker-topo" });
		this.previewEl = linha.createSpan({ cls: "customize-icon-picker-preview" });

		this.inputEl = linha.createEl("input", {
			type: "text",
			placeholder: "Buscar ícone (ex.: star, calendar, check)...",
			cls: "customize-icon-picker-busca",
		});

		const limpar = linha.createEl("button", { text: "Sem ícone" });
		limpar.addEventListener("click", () => this.escolher(undefined));

		this.statusEl = wrap.createEl("p", { cls: "setting-item-description" });
		this.resultadosEl = wrap.createDiv({ cls: "customize-icon-picker-grade" });

		this.renderPreview();
		this.renderResultados("");

		this.inputEl.addEventListener("input", () =>
			this.renderResultados(this.inputEl.value.trim().toLowerCase()),
		);
		// Enter escolhe o primeiro resultado — busca e escolha sem tirar a mão do teclado.
		this.inputEl.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter") return;
			const primeiro = this.resultadosEl.firstElementChild as HTMLElement | null;
			primeiro?.click();
		});

		window.setTimeout(() => this.inputEl.focus(), 0);
	}

	private escolher(icone: string | undefined): void {
		this.valor = icone;
		this.onEscolher(icone);
		this.close();
	}

	private renderPreview(): void {
		this.previewEl.empty();
		if (this.valor) setIcon(this.previewEl, this.valor);
	}

	private renderResultados(query: string): void {
		this.resultadosEl.empty();

		const todos = todosOsIcones();
		let matches: Icone[];

		if (!query) {
			// Sem busca, o modal mostra sugestões em vez de abrir vazio (ou de despejar os
			// ~1300 ícones da biblioteca, que travaria a rolagem sem ajudar ninguém).
			const disponiveis = new Set(todos.map((i) => i.id));
			matches = SUGESTOES.filter((id) => disponiveis.has(id)).map((id) => ({ id, busca: id }));
			this.statusEl.setText("Ícones comuns — digite para buscar entre todos.");
		} else {
			const todosMatches = todos.filter((i) => i.busca.includes(query));
			matches = todosMatches.slice(0, MAX_RESULTADOS);
			this.statusEl.setText(
				todosMatches.length > MAX_RESULTADOS
					? `${todosMatches.length} ícones encontrados, mostrando os primeiros ${MAX_RESULTADOS}.`
					: `${todosMatches.length} ${todosMatches.length === 1 ? "ícone" : "ícones"}.`,
			);
		}

		if (matches.length === 0) {
			this.resultadosEl.createEl("p", { cls: "customize-vazio", text: "Nenhum ícone encontrado." });
			return;
		}

		for (const icone of matches) {
			const cell = this.resultadosEl.createDiv({
				cls: "customize-icon-picker-cell",
				attr: { title: icone.id },
			});
			if (icone.id === this.valor) cell.addClass("is-atual");
			setIcon(cell, icone.id);
			cell.addEventListener("click", () => this.escolher(icone.id));
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
