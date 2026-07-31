import type { Plugin } from "obsidian";

/**
 * Injeta CSS gerado em runtime.
 *
 * Não existe API oficial do Obsidian para isto — o `styles.css` da pasta do plugin é estático.
 * O padrão da comunidade é um `<style>` no `<head>`, e é o que o próprio Callout Manager faz.
 *
 * Dois detalhes que importam:
 *
 * - **Atualizamos `textContent`, nunca recriamos o elemento.** Recriar causa flash visual e
 *   perde a posição na cascata (que é o que decide empates de especificidade).
 * - **Inserimos depois do último `<style>` do head**, para ficar depois do CSS do tema e dos
 *   snippets. Em empate de especificidade (nossas regras por tipo são 0,2,0, iguais às do
 *   Obsidian), quem vem por último vence.
 *
 * A limpeza usa `plugin.register()`, que roda no `onunload` automaticamente — menos chance de
 * vazar um `<style>` órfão do que lembrar de remover à mão.
 */
export class EstilosDinamicos {
	private el: HTMLStyleElement | null = null;

	constructor(private plugin: Plugin, private id: string) {}

	iniciar(): void {
		if (this.el) return;

		this.el = document.head.createEl("style", {
			attr: { "data-plugin-id": this.plugin.manifest.id, "data-customize-bloco": this.id },
		});
		this.irParaOFim();
		this.plugin.register(() => this.destruir());
	}

	aplicar(css: string): void {
		if (!this.el) this.iniciar();
		if (!this.el) return;
		if (this.el.textContent !== css) this.el.textContent = css;
		// Trocar de tema/snippet insere <style> novos depois do nosso; voltamos ao fim para
		// continuar ganhando os empates de especificidade.
		this.irParaOFim();
	}

	/** Move o nosso <style> para depois de todos os outros do head. */
	private irParaOFim(): void {
		const el = this.el;
		if (!el) return;
		const estilos = document.head.querySelectorAll("style");
		const ultimo = estilos.item(estilos.length - 1);
		if (ultimo && ultimo !== el) ultimo.insertAdjacentElement("afterend", el);
	}

	destruir(): void {
		this.el?.remove();
		this.el = null;
	}
}
