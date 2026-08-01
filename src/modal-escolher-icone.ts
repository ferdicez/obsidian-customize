import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";

/**
 * Busca de ícones Lucide no estilo da paleta de comandos do Obsidian.
 *
 * A busca fuzzy, o ranqueamento, a navegação por teclado e a rolagem virtualizada vêm todos de
 * `FuzzySuggestModal` — por isso a lista pode conter os ~1300 ícones sem corte: só o que está
 * visível é renderizado. (A versão anterior filtrava por substring e cortava em 120 resultados.)
 *
 * ── A diferença que importa aqui: o prefixo `lucide-` ────────────────────────────────────
 *
 * `getIconIds()` devolve os ids já prefixados (`lucide-star`). Os outros plugins tiram o prefixo
 * porque passam o valor para `setIcon`, que aceita as duas formas. Aqui o valor vai para
 * `--callout-icon`, que o Obsidian resolve contra o registro de ícones — e ali o prefixo é
 * parte do id. Por isso guardamos o id COMO ELE VEM, sem fatiar.
 *
 * A busca, porém, ignora o prefixo: quem digita "star" não quer competir com o "lucide-" que
 * está em todos os ids. Como `FuzzySuggestModal` casa contra o texto de `getItemText`, é ele que
 * devolve o nome sem prefixo — enquanto `onChooseItem` grava o id completo.
 */

const SEM_ICONE = "Sem ícone";

let idsCache: string[] | null = null;

/** Todos os ícones que o Obsidian suporta, com o id completo ("lucide-star"). */
function todosOsIcones(): string[] {
	if (!idsCache) idsCache = getIconIds();
	return idsCache;
}

/** O id sem o prefixo — o texto contra o qual a busca casa e que aparece na lista. */
function semPrefixo(id: string): string {
	return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

export class ModalEscolherIcone extends FuzzySuggestModal<string> {
	constructor(
		app: App,
		private contexto: string,
		private valorInicial: string | undefined,
		private onEscolher: (icone: string | undefined) => void,
	) {
		super(app);
		this.setPlaceholder(`Ícone — ${this.contexto} — busque por nome`);
		this.setInstructions([
			{ command: "↑↓", purpose: "navegar" },
			{ command: "↵", purpose: "escolher" },
			{ command: "esc", purpose: "cancelar" },
		]);
	}

	getItems(): string[] {
		// "Sem ícone" primeiro, e a lista inteira depois — sem slice: o modal só renderiza o visível.
		return [SEM_ICONE, ...todosOsIcones()];
	}

	getItemText(icone: string): string {
		// O que a busca fuzzy casa: o nome sem "lucide-", senão o prefixo polui todos os matches.
		return icone === SEM_ICONE ? icone : semPrefixo(icone);
	}

	async onOpen(): Promise<void> {
		await super.onOpen();
		// Abrir já com o ícone atual no campo mostra onde o callout está antes de trocar.
		if (this.valorInicial) {
			this.inputEl.value = semPrefixo(this.valorInicial);
			this.inputEl.trigger("input");
		}
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass("customize-icon-suggestion");
		const nome = el.createSpan();
		nome.setText(this.getItemText(match.item));
		if (match.item === SEM_ICONE) {
			el.addClass("cm-em");
			return;
		}
		setIcon(el.createSpan(), match.item);
	}

	onChooseItem(icone: string): void {
		// Grava o id COMPLETO (com "lucide-"), que é o que `--callout-icon` precisa.
		this.onEscolher(icone === SEM_ICONE ? undefined : icone);
	}
}
