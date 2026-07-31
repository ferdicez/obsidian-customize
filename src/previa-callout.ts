import { setIcon } from "obsidian";
import { gerarCssPrevia, type EstiloCallout } from "./callouts";

/**
 * Um callout de exemplo dentro do painel de configurações, que reflete as mudanças ao vivo.
 *
 * ── Por que reconstruir o DOM à mão em vez de renderizar markdown ────────────────────────
 *
 * `MarkdownRenderer.render()` daria o callout de verdade, mas: (a) é assíncrono, o que
 * atrapalha a atualização a cada movimento de slider; (b) o resultado dependeria do tipo
 * existir, e aqui queremos previsualizar estilos que ainda estão sendo criados. Montar as
 * quatro divs é trivial e nos dá controle total.
 *
 * ── Por que cada prévia tem seu próprio <style> ──────────────────────────────────────────
 *
 * As regras precisam ser escopadas (`#id .callout`) para não vazarem para as notas. Como há
 * uma prévia por bloco de configuração, cada uma carrega o seu.
 *
 * O ícone é resolvido com `setIcon` no JS: a variável `--callout-icon` só funciona no
 * pipeline de render do Obsidian, que não roda aqui.
 */

let contador = 0;

export class PreviaCallout {
	private el: HTMLElement;
	private styleEl: HTMLStyleElement;
	private iconeEl: HTMLElement;
	private readonly id: string;

	constructor(pai: HTMLElement, private textoTitulo = "Exemplo") {
		this.id = `customize-previa-${++contador}`;

		this.el = pai.createDiv({ cls: "customize-previa" });
		this.el.id = this.id;
		this.styleEl = this.el.createEl("style");

		const callout = this.el.createDiv({ cls: "callout" });
		const titulo = callout.createDiv({ cls: "callout-title" });
		this.iconeEl = titulo.createDiv({ cls: "callout-icon" });
		titulo.createDiv({ cls: "callout-title-inner", text: this.textoTitulo });
		callout
			.createDiv({ cls: "callout-content" })
			.createEl("p", { text: "Assim vai ficar o conteúdo do callout." });
	}

	/**
	 * Redesenha com o estilo dado. `estilo` já deve vir com a herança resolvida — a prévia
	 * mostra o resultado final.
	 */
	atualizar(estilo: EstiloCallout, cor?: string, icone?: string): void {
		this.styleEl.textContent = gerarCssPrevia(this.id, estilo, cor, icone);
		// `lucide-pencil` é o ícone que o Obsidian usa como padrão para tipos sem regra.
		setIcon(this.iconeEl, icone?.trim() || "lucide-pencil");
	}
}
