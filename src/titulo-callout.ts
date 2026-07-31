import type { MarkdownPostProcessorContext } from "obsidian";

/**
 * Faz o texto depois do `|` virar o título do callout:
 *
 *     > [!demandas|Reunião com cliente]
 *
 * mostra "Reunião com cliente" no lugar de "Demandas", mantendo `demandas` como o tipo
 * (que é quem carrega a cor e o ícone).
 *
 * ── Por que é necessário ─────────────────────────────────────────────────────────────────
 *
 * O Obsidian já guarda o que vem depois do `|` em `data-callout-metadata`, sem normalizar
 * nada (preserva maiúsculas, acentos e espaços). Mas nada no core lê esse atributo para
 * renderizar — é só um gancho para CSS/plugins. O título default vem do TIPO capitalizado:
 * `t.type.replace(/-/g," ").toLowerCase()` + primeira letra maiúscula.
 *
 * Não dá para resolver só com CSS: `attr()` em `content` só lê atributos do próprio
 * elemento, e o metadata está no `.callout` pai, não no `.callout-title-inner`.
 *
 * ── Regra de precedência que respeitamos ─────────────────────────────────────────────────
 *
 * Texto escrito depois do `]` vence o metadata:
 *
 *     > [!demandas|Reunião] Meu título    →  título "Meu título"
 *
 * O Obsidian já resolve isso antes de nós; para saber se o título é o default (e portanto
 * substituível), comparamos com o tipo capitalizado da mesma forma que ele faz. Se o título
 * for outra coisa, foi a usuária que escreveu — não mexemos.
 *
 * ── Idempotência ─────────────────────────────────────────────────────────────────────────
 *
 * Em Live Preview o post-processor roda a cada reconstrução do widget (scroll, edição,
 * cursor entrando/saindo do bloco), muito mais vezes que em modo leitura. Marcamos o
 * elemento com um data-attribute para não reprocessar. Nada de MutationObserver: o
 * post-processor já é chamado em toda renderização, e observar mutações que nós mesmos
 * causamos convidaria um loop.
 */

/** Reproduz o título default do Obsidian: tipo com hífens virando espaço, 1ª letra maiúscula. */
function tituloDefaultDoTipo(tipo: string): string {
	const t = tipo.trim().replace(/-/g, " ").toLowerCase();
	return t.charAt(0).toUpperCase() + t.slice(1);
}

export function processarTitulos(el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
	// `el` nunca é o próprio .callout (nem em leitura, nem em Live Preview) — sempre um
	// container acima. Por isso querySelectorAll, sem testar o próprio el.
	const callouts = el.querySelectorAll<HTMLElement>(".callout[data-callout-metadata]");

	for (const callout of Array.from(callouts)) {
		const metadata = callout.getAttribute("data-callout-metadata");
		if (!metadata) continue;

		const titulo = metadata.trim();
		if (!titulo) continue;

		const inner = callout.querySelector<HTMLElement>(":scope > .callout-title > .callout-title-inner");
		if (!inner) continue;
		if (inner.dataset.customizeTitulo === titulo) continue;

		const tipo = callout.getAttribute("data-callout") ?? "";
		const atual = inner.textContent?.trim() ?? "";

		// Só substituímos o título default. Se a usuária escreveu um título depois do `]`,
		// ele vence — é o que o próprio Obsidian faz, e sobrescrever seria surpreendente.
		const jaAplicado = inner.dataset.customizeTitulo !== undefined;
		if (!jaAplicado && atual !== tituloDefaultDoTipo(tipo)) continue;

		inner.setText(titulo);
		inner.dataset.customizeTitulo = titulo;
	}
}
