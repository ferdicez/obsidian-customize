/**
 * Modelo e geração de CSS dos callouts.
 *
 * ── O que o Obsidian nos dá (verificado no app.css da versão instalada) ───────────────────
 *
 * Variáveis declaradas em `body` (especificidade 0,0,1 — fácil de vencer):
 *   --callout-border-width: 0px      --callout-radius: var(--radius-s)  (4px)
 *   --callout-border-opacity: 0.25   --callout-padding: 12px 12px 12px 24px
 *   --callout-title-weight: 600      --callout-blend-mode: darken|lighten
 *
 * Variáveis declaradas em `.callout` (0,1,0) e sobrescritas em `.callout[data-callout="x"]` (0,2,0):
 *   --callout-color: r, g, b         --callout-icon: lucide-pencil
 *
 * Por isso, para mudar cor/ícone de um tipo, o seletor precisa ser no mínimo
 * `.callout[data-callout="x"]` — um `.callout { ... }` genérico NÃO vence a regra por tipo.
 *
 * Três armadilhas que o CSS abaixo trata:
 *
 * 1. `--callout-color` é um TRIPLET RGB ("233, 49, 71"), nunca hex. O Obsidian consome como
 *    `rgb(var(--callout-color))`. Passar hex quebra silenciosamente.
 * 2. NÃO existe `--callout-background`: o fundo é `rgba(var(--callout-color), 0.1)` hard-coded
 *    no app.css. Para mudar, sobrescrevemos a propriedade `background-color` direto.
 * 3. `mix-blend-mode: darken|lighten` "lava" qualquer cor de fundo customizada. Quem mexe em
 *    fundo quase sempre quer `--callout-blend-mode: normal` junto.
 *
 * E uma limitação conhecida: trocar `--callout-icon` NÃO re-renderiza um callout já na tela
 * (o Obsidian só lê a variável no momento do render, e há uma guarda `if (t.firstChild) return`).
 * Precisa reabrir a nota. Está documentado na UI.
 */

import { hexParaRgb } from "./cores";

export type AlinhamentoTitulo = "esquerda" | "centro" | "direita";

/** Um estilo de callout. Todo campo é opcional: `undefined` = "não mexe, deixa o padrão". */
export interface EstiloCallout {
	/** Espessura da borda em px. */
	larguraBorda?: number;
	/** Opacidade da borda (0–1), derivada da cor do callout. */
	opacidadeBorda?: number;
	/** Opacidade do fundo (0–1), derivada da cor do callout. O padrão do Obsidian é 0.1. */
	opacidadeFundo?: number;
	/** Raio das quinas em px. */
	radius?: number;
	alinhamentoTitulo?: AlinhamentoTitulo;
	mostrarIcone?: boolean;
	/** Negrito do título (peso da fonte). */
	pesoTitulo?: number;
	/** Desliga o mix-blend-mode, que distorce cores de fundo customizadas. */
	corSolida?: boolean;
}

/** Um tipo de callout com estilo próprio, sobrescrevendo o global. */
export interface CalloutPersonalizado {
	/** O nome usado no markdown: `> [!hoje]` → "hoje". Sempre minúsculo. */
	tipo: string;
	/** Cor em hex (convertida para triplet RGB na geração do CSS). */
	cor?: string;
	/** Id de ícone Lucide (ex.: "lucide-calendar-check"). */
	icone?: string;
	/** Ajustes que sobrescrevem o estilo global só para este tipo. */
	estilo: EstiloCallout;
}

export interface DadosCallouts {
	/** Ligar/desligar toda a customização de callouts de uma vez. */
	ativo: boolean;
	/** Estilo aplicado a TODOS os callouts. */
	global: EstiloCallout;
	/** Tipos com estilo/cor/ícone próprios. */
	personalizados: CalloutPersonalizado[];
	/**
	 * Usar o texto depois do `|` como título: `> [!demandas|Reunião com cliente]` mostra
	 * "Reunião com cliente" em vez de "Demandas". Ver `titulo-callout.ts`.
	 */
	tituloPeloMetadata: boolean;
	/**
	 * Cor e ícone aplicados a qualquer callout cujo tipo o Obsidian não conhece — ou seja,
	 * a qualquer nome inventado. É o que faz `> [!Anotação rápida]` já sair estilizado em
	 * vez do azul-com-lápis padrão. Na UI é chamado de estilo "Padrão".
	 */
	coringa: { cor?: string; icone?: string; estilo: EstiloCallout };
}

export const CALLOUTS_PADRAO: DadosCallouts = {
	ativo: false,
	global: {},
	personalizados: [],
	tituloPeloMetadata: true,
	coringa: { estilo: {} },
};

/**
 * Tipos embutidos do Obsidian, agrupados por aliases equivalentes (mesma cor e ícone).
 * Extraído do app.css. `note` não tem regra própria — é o fallback de qualquer tipo
 * desconhecido, por isso aparece primeiro.
 */
export const TIPOS_EMBUTIDOS: Array<{ nome: string; aliases: string[] }> = [
	{ nome: "note", aliases: [] },
	{ nome: "abstract", aliases: ["summary", "tldr"] },
	{ nome: "info", aliases: [] },
	{ nome: "todo", aliases: [] },
	{ nome: "tip", aliases: ["hint"] },
	{ nome: "important", aliases: [] },
	{ nome: "success", aliases: ["check", "done"] },
	{ nome: "question", aliases: ["help", "faq"] },
	{ nome: "warning", aliases: ["caution", "attention"] },
	{ nome: "failure", aliases: ["fail", "missing"] },
	{ nome: "danger", aliases: ["error"] },
	{ nome: "bug", aliases: [] },
	{ nome: "example", aliases: [] },
	{ nome: "quote", aliases: ["cite"] },
];

/**
 * Todos os nomes que o Obsidian reconhece, achatando os aliases. Usado para montar o `:not()`
 * do estilo coringa — ele deve pegar só os nomes inventados pela usuária.
 *
 * `note` entra aqui, e isso é importante: o Obsidian NÃO tem regra `[data-callout="note"]`
 * no CSS (ele cai no mesmo fallback dos tipos desconhecidos), então sem incluí-lo à mão o
 * coringa também pegaria os callouts `note` legítimos.
 */
const NOMES_NATIVOS: string[] = TIPOS_EMBUTIDOS.flatMap((t) => [t.nome, ...t.aliases]);

const JUSTIFY: Record<AlinhamentoTitulo, string> = {
	esquerda: "flex-start",
	centro: "center",
	direita: "flex-end",
};

/** Regras que vão dentro de um seletor de `.callout`. */
function regrasDoCallout(estilo: EstiloCallout, cor?: string): string[] {
	const regras: string[] = [];

	if (cor) {
		const rgb = hexParaRgb(cor);
		// Triplet sem rgb(): é assim que o Obsidian consome a variável.
		if (rgb) regras.push(`--callout-color: ${rgb};`);
	}

	if (estilo.larguraBorda !== undefined) {
		regras.push(`--callout-border-width: ${estilo.larguraBorda}px;`);
	}
	if (estilo.opacidadeBorda !== undefined) {
		regras.push(`--callout-border-opacity: ${estilo.opacidadeBorda};`);
	}
	if (estilo.radius !== undefined) {
		regras.push(`--callout-radius: ${estilo.radius}px;`);
	}
	if (estilo.pesoTitulo !== undefined) {
		regras.push(`--callout-title-weight: ${estilo.pesoTitulo};`);
	}
	if (estilo.opacidadeFundo !== undefined) {
		// Não há variável de fundo no Obsidian: sobrescrevemos a propriedade direto.
		regras.push(`background-color: rgba(var(--callout-color), ${estilo.opacidadeFundo});`);
	}
	if (estilo.corSolida) {
		// darken/lighten distorcem o fundo customizado; normal mostra a cor como ela é.
		regras.push(`--callout-blend-mode: normal;`);
	}

	return regras;
}

/** Regras do título (`.callout-title`) — alinhamento é flexbox, não há variável. */
function regrasDoTitulo(estilo: EstiloCallout): string[] {
	if (estilo.alinhamentoTitulo === undefined) return [];
	return [`justify-content: ${JUSTIFY[estilo.alinhamentoTitulo]};`];
}

function bloco(seletor: string, regras: string[]): string {
	if (regras.length === 0) return "";
	return `${seletor} {\n\t${regras.join("\n\t")}\n}`;
}

/** Escapa um tipo para uso dentro de `[data-callout="..."]`. */
function escaparTipo(tipo: string): string {
	return tipo.replace(/["\\]/g, "\\$&");
}

/**
 * Gera todo o CSS de callouts. Devolve string vazia se não houver nada a aplicar — assim o
 * `<style>` fica vazio em vez de conter regras inúteis.
 */
export function gerarCssCallouts(dados: DadosCallouts): string {
	if (!dados.ativo) return "";

	const partes: string[] = [];

	// ── Global ────────────────────────────────────────────────────────────────────────────
	// `.callout` (0,1,0) basta para as variáveis que o Obsidian declara em `body` (0,0,1).
	partes.push(bloco(".callout", regrasDoCallout(dados.global)));
	partes.push(bloco(".callout > .callout-title", regrasDoTitulo(dados.global)));

	if (dados.global.mostrarIcone === false) {
		partes.push(bloco(".callout > .callout-title > .callout-icon", ["display: none;"]));
	}

	// ── Coringa ("Padrão"): qualquer nome que o Obsidian não conhece ──────────────────────
	// Usa `:not(a, b, c)` (lista de seletores) em vez de `:not(a):not(b):not(c)` encadeado.
	// A forma encadeada somaria especificidade a cada item (chegaria a 0,28,0) e engessaria
	// qualquer sobrescrita futura; a lista mantém 0,2,0 — igual às regras por tipo, resolvido
	// pela ordem no <head>.
	const coringaRegras = regrasDoCallout(dados.coringa.estilo, dados.coringa.cor);
	if (dados.coringa.icone) coringaRegras.push(`--callout-icon: ${dados.coringa.icone};`);

	const coringaTitulo = regrasDoTitulo(dados.coringa.estilo);

	if (coringaRegras.length > 0 || coringaTitulo.length > 0) {
		// Exclui os nativos E os tipos já personalizados — estes têm regra própria e não
		// devem ser sobrepostos pelo coringa.
		const excluir = [...NOMES_NATIVOS, ...dados.personalizados.map((p) => p.tipo.trim().toLowerCase())]
			.filter((n) => n.length > 0)
			.map((n) => `[data-callout="${escaparTipo(n)}"]`)
			.join(", ");
		const selCoringa = `.callout:not(${excluir})`;

		partes.push(bloco(selCoringa, coringaRegras));
		partes.push(bloco(`${selCoringa} > .callout-title`, coringaTitulo));

		if (dados.coringa.estilo.mostrarIcone === false) {
			partes.push(bloco(`${selCoringa} > .callout-title > .callout-icon`, ["display: none;"]));
		}
	}

	// ── Por tipo ──────────────────────────────────────────────────────────────────────────
	// `.callout[data-callout="x"]` (0,2,0) é o mínimo para vencer as regras por tipo do
	// Obsidian, que também são 0,2,0 — empate resolvido pela ordem: nosso <style> entra depois.
	for (const p of dados.personalizados) {
		const tipo = p.tipo.trim().toLowerCase();
		if (!tipo) continue;
		const sel = `.callout[data-callout="${escaparTipo(tipo)}"]`;

		const regras = regrasDoCallout(p.estilo, p.cor);
		if (p.icone) regras.push(`--callout-icon: ${p.icone};`);
		partes.push(bloco(sel, regras));

		partes.push(bloco(`${sel} > .callout-title`, regrasDoTitulo(p.estilo)));

		// Só emite se o tipo decidir algo diferente do global (undefined = herda).
		if (p.estilo.mostrarIcone === false) {
			partes.push(bloco(`${sel} > .callout-title > .callout-icon`, ["display: none;"]));
		} else if (p.estilo.mostrarIcone === true && dados.global.mostrarIcone === false) {
			partes.push(bloco(`${sel} > .callout-title > .callout-icon`, ["display: flex;"]));
		}
	}

	return partes.filter((p) => p.length > 0).join("\n\n");
}
