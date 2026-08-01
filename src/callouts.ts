/**
 * Modelo e geração de CSS dos callouts.
 *
 * ── O que o Obsidian nos dá (verificado no app.css da versão instalada) ───────────────────
 *
 * Variáveis declaradas em `body` (especificidade 0,0,1 — fácil de vencer):
 *   --callout-border-width: 0px      --callout-radius: var(--radius-s)  (4px)
 *   --callout-border-opacity: 0.25   --callout-padding: 12px 12px 12px 24px
 *   --callout-title-weight: 600      --callout-blend-mode: var(--highlight-mix-blend-mode)
 *   --callout-title-color: inherit   <- ADICIONADA numa atualização; ver armadilha 4
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
 * 4. O TÍTULO TEM DUAS CAMADAS, e a de baixo descarta a cor da de cima:
 *       .callout-title       { color: rgb(var(--callout-color)); }   <- nossa cor chega aqui
 *       .callout-title-inner { color: var(--callout-title-color); }  <- e é descartada aqui
 *    Como `--callout-title-color` tem default `inherit`, o texto do título herda a cor do CORPO
 *    DA NOTA (preto no tema claro) em vez da cor do callout. Por isso definir `--callout-color`
 *    sozinho deixa o título preto — é obrigatório emitir `--callout-title-color` junto.
 *    Borda e ícone não passam por essa camada, então continuam funcionando só com a cor: é o que
 *    torna o sintoma confuso (a cor "funciona", mas o título não).
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
	/**
	 * Tamanho do ícone em px. O Obsidian dimensiona o SVG do callout por `--icon-size`
	 * (herdada do contexto, tipicamente 18px). Ver `regrasDoCallout`.
	 */
	tamanhoIcone?: number;
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

/** Opacidade de fundo que o Obsidian usa nativamente (`rgba(var(--callout-color), 0.1)`). */
const OPACIDADE_FUNDO_PADRAO = 0.1;

/** Opacidade de borda nativa do Obsidian (`--callout-border-opacity: 0.25` no body). */
const OPACIDADE_BORDA_PADRAO = 0.25;

/**
 * ARMADILHA 7 — as variáveis de Base embutida dentro de callout, pela quarta vez o mesmo triplet.
 *
 * O Obsidian tinge a moldura de uma Base embutida com a cor do callout que a contém:
 *
 *     .callout {
 *       --bases-embed-border-color: color-mix(in oklch, var(--callout-color) 25%, ...);
 *       --bases-table-border-color: ...;  --table-border-color: ...;
 *     }
 *
 * Confirmado no DevTools dela que o valor computado sai literalmente
 * `color-mix(in oklch, 163, 163, 163 25%, white 50%)` — o triplet entrou CRU, sem `rgb()`. A
 * função é inválida, a variável não resolve e a moldura cai em PRETO. (Na versão anterior a
 * regra tinha `rgb(var(--callout-color))` e funcionava; a nova tirou o wrapper.)
 *
 * Reemitimos as três já com `rgb()` em volta do triplet. Vão no bloco GLOBAL, com a forma
 * `rgb(var(--callout-color))`, porque o problema atinge TODO callout que embute uma Base —
 * inclusive os nativos e o `quote` cinza, que não têm cor configurada por ela.
 *
 * Os 25%/50% reproduzem a fórmula nativa, para a aparência continuar sendo a pretendida pelo
 * Obsidian; só consertamos o argumento que ele quebrou.
 */
const VARIAVEIS_BASE_EMBUTIDA = [
	"--bases-embed-border-color",
	"--bases-table-border-color",
	"--table-border-color",
].map(
	(nome) =>
		`${nome}: color-mix(in srgb, rgb(var(--callout-color)) 25%, var(--background-primary) 50%);`,
);

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
		if (rgb) {
			regras.push(`--callout-color: ${rgb};`);
			// A partir da versão que introduziu `--callout-title-color`, o `.callout-title-inner`
			// declara `color: var(--callout-title-color)`, cujo padrão é `inherit` — ou seja, o
			// texto do título herda a cor do corpo da nota (preto no tema claro) e DESCARTA a cor
			// que `.callout-title` aplica logo acima. Sem esta linha, escolher qualquer cor
			// resulta num título preto. Borda e ícone não passam por essa camada e por isso
			// continuavam funcionando — foi o que tornou o sintoma confuso.
			regras.push(`--callout-title-color: rgb(${rgb});`);

			// ARMADILHA 5 — `color-mix()` não aceita triplet, e é o que o Obsidian passou a usar
			// na borda:
			//     border-color: color-mix(in oklch, var(--callout-color)
			//                   calc(var(--callout-border-opacity) * 100%), transparent)
			// `--callout-color` é "203, 108, 149" (triplet, sem `rgb()`), que NÃO é uma cor válida
			// para `color-mix()`. A função inteira falha e o `border-color` cai no valor inicial:
			// PRETO. O título continuava certo porque usa `rgb(var(--callout-color))`, forma que
			// aceita triplet — daí o sintoma "título colorido, linha preta".
			//
			// Emitimos `border-color` sem depender de `color-mix()`. Repare que a OPACIDADE vai por
			// `var(--callout-border-opacity)`, não pelo valor literal deste estilo: cor e opacidade
			// costumam vir de blocos DIFERENTES (a cor no coringa/tipo, a opacidade no global), e
			// fixar aqui o padrão 0.25 faria este bloco — mais específico e emitido depois —
			// sobrescrever a intensidade que ela configurou no global. Com a variável, cada bloco
			// contribui com o que sabe e a cascata resolve o resto.
			regras.push(
				`border-color: rgba(${rgb}, var(--callout-border-opacity, ${OPACIDADE_BORDA_PADRAO}));`,
			);
		}
	}

	if (estilo.larguraBorda !== undefined) {
		regras.push(`--callout-border-width: ${estilo.larguraBorda}px;`);
	}
	if (estilo.opacidadeBorda !== undefined) {
		regras.push(`--callout-border-opacity: ${estilo.opacidadeBorda};`);
		// Sem `cor` neste bloco (caso do estilo global, onde a cor vem do coringa ou do tipo) o
		// `border-color` acima não foi emitido — mas a regra com `color-mix()` continua quebrada.
		// `rgb(var(--callout-color))` envolve o triplet e devolve uma cor de verdade; o segundo
		// argumento de `rgba()` aceita a opacidade direto. Ver ARMADILHA 5.
		if (!cor) {
			regras.push(`border-color: rgba(var(--callout-color), ${estilo.opacidadeBorda});`);
		}
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
		// `mix-blend-mode: darken|lighten` (o padrão do Obsidian, via --highlight-mix-blend-mode)
		// mistura este fundo com o da nota e achata a diferença entre uma intensidade e outra —
		// mexer no slider parece não fazer efeito.
		//
		// Só desligamos o blend quando a intensidade FOGE do padrão do Obsidian (0.1). Em 0.1 a
		// aparência pretendida é a nativa, e forçar `normal` ali mudaria o visual dos callouts
		// embutidos sem que ninguém tenha pedido. `corSolida` continua sendo o controle explícito
		// e já emite `normal` por conta própria logo abaixo.
		if (!estilo.corSolida && estilo.opacidadeFundo !== OPACIDADE_FUNDO_PADRAO) {
			regras.push(`--callout-blend-mode: normal;`);
		}
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

/**
 * Regras do ícone (`.callout-icon`). O Obsidian dimensiona ícones por `--icon-size`, mas o
 * `<svg>` gerado pelo `setIcon` também traz `width`/`height` como ATRIBUTOS — que perdem para
 * qualquer regra CSS, mas só se existir uma. Por isso mandamos os dois: a variável (que é o
 * caminho oficial e cobre temas que a consomem) e width/height explícitos no svg.
 */
function regrasDoIcone(estilo: EstiloCallout, cor?: string): string[] {
	const regras: string[] = [];
	if (estilo.tamanhoIcone !== undefined) {
		regras.push(`--icon-size: ${estilo.tamanhoIcone}px;`);
	}
	// ARMADILHA 6 — a cor do ícone caiu no mesmo problema do triplet que a borda (ARMADILHA 5).
	// A regra nativa virou `.callout-icon .svg-icon { color: var(--callout-color) }`, sem o
	// `rgb()` em volta — então resolve para `color: 203, 108, 149`, que não é cor válida. A
	// declaração é descartada e o ícone herda o cinza do texto da nota.
	//
	// O `color` vai no `.callout-icon` (pai do svg) porque o `<svg>` do Lucide usa
	// `stroke: currentColor`: colorir o pai basta e não depende de qual elemento o Obsidian
	// escolhe estilizar. Emitido junto da cor, independente de `tamanhoIcone` estar definido.
	if (cor) {
		const rgb = hexParaRgb(cor);
		if (rgb) regras.push(`color: rgb(${rgb});`);
	}
	return regras;
}

/** Regras aplicadas ao `<svg>` dentro do ícone — ver `regrasDoIcone`. */
function regrasDoSvg(estilo: EstiloCallout): string[] {
	if (estilo.tamanhoIcone === undefined) return [];
	return [`width: ${estilo.tamanhoIcone}px;`, `height: ${estilo.tamanhoIcone}px;`];
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
 * Seletor do bloco GLOBAL. `:is(.callout)` em vez de `.callout` puro.
 *
 * Por quê: `.callout` sozinho é 0,1,0, e TEMAS estilizam callout com seletor mais específico —
 * o Minimal, por exemplo, usa `.callouts-outlined .callout` (0,2,0) no estilo "Outlined", com
 * `--callout-border-opacity: 0.5` e `background-color: transparent`. Sendo 0,2,0 contra os
 * nossos 0,1,0, o TEMA VENCE SEMPRE, não importa a ordem no <head>: a intensidade de borda e de
 * fundo configuradas aqui eram silenciosamente descartadas.
 *
 * A solução é `.callout.callout`: repetir a MESMA classe no seletor composto soma especificidade
 * de verdade (0,2,0) sem mudar nada do que casa. (Cuidado: `:is(.callout, .callout)` NÃO serve —
 * `:is()` assume a especificidade do argumento mais específico, e como os dois são `.callout`,
 * o resultado continua 0,1,0. Testado: o tema seguia vencendo.)
 *
 * Empatamos com o tema em 0,2,0 e ganhamos pela ordem (nosso <style> volta ao fim do head a cada
 * reaplicação). Não subimos mais que isso de propósito: 0,2,0 é o mesmo patamar das regras por
 * tipo, e continua sobrescrevível por um snippet da usuária.
 */
const SEL_GLOBAL = ".callout.callout";

/**
 * Gera todo o CSS de callouts. Devolve string vazia se não houver nada a aplicar — assim o
 * `<style>` fica vazio em vez de conter regras inúteis.
 */
export function gerarCssCallouts(dados: DadosCallouts): string {
	if (!dados.ativo) return "";

	const partes: string[] = [];

	// ── Global ────────────────────────────────────────────────────────────────────────────
	// SEL_GLOBAL é `.callout.callout` = 0,2,0, para empatar com temas que estilizam callout por
	// seletor composto (ver o comentário de SEL_GLOBAL). `.callout` puro perdia.
	//
	// As variáveis de Base embutida entram aqui (e não em `regrasDoCallout`) porque o conserto
	// vale para TODO callout, tenha ela configurado cor nele ou não — ver ARMADILHA 7.
	partes.push(bloco(SEL_GLOBAL, [...regrasDoCallout(dados.global), ...VARIAVEIS_BASE_EMBUTIDA]));
	partes.push(bloco(`${SEL_GLOBAL} > .callout-title`, regrasDoTitulo(dados.global)));

	if (dados.global.mostrarIcone === false) {
		partes.push(bloco(`${SEL_GLOBAL} > .callout-title > .callout-icon`, ["display: none;"]));
	} else {
		// O global não tem cor própria (ela vem do coringa/tipo), então aqui a cor do ícone sai
		// pela variável — `rgb(var(--callout-color))` envolve o triplet e conserta a regra nativa
		// quebrada (ARMADILHA 6) para TODOS os callouts, inclusive os nativos, que continuam com
		// a cor deles porque a variável é quem muda por tipo.
		const iconeGlobal = regrasDoIcone(dados.global);
		iconeGlobal.push("color: rgb(var(--callout-color));");
		partes.push(bloco(`${SEL_GLOBAL} > .callout-title > .callout-icon`, iconeGlobal));
		partes.push(
			bloco(`${SEL_GLOBAL} > .callout-title > .callout-icon > svg`, regrasDoSvg(dados.global)),
		);
	}

	// ── Coringa ("Padrão"): qualquer nome que o Obsidian não conhece ──────────────────────
	// Usa `:not(a, b, c)` (lista de seletores) em vez de `:not(a):not(b):not(c)` encadeado.
	// A forma encadeada somaria especificidade a cada item (chegaria a 0,28,0) e engessaria
	// qualquer sobrescrita futura; a lista mantém 0,2,0 — igual às regras por tipo, resolvido
	// pela ordem no <head>.
	const coringaRegras = regrasDoCallout(dados.coringa.estilo, dados.coringa.cor);
	if (dados.coringa.icone) coringaRegras.push(`--callout-icon: ${dados.coringa.icone};`);

	const coringaTitulo = regrasDoTitulo(dados.coringa.estilo);
	const coringaIcone = regrasDoIcone(dados.coringa.estilo, dados.coringa.cor);

	if (coringaRegras.length > 0 || coringaTitulo.length > 0 || coringaIcone.length > 0) {
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
		} else {
			partes.push(bloco(`${selCoringa} > .callout-title > .callout-icon`, coringaIcone));
			partes.push(
				bloco(`${selCoringa} > .callout-title > .callout-icon > svg`, regrasDoSvg(dados.coringa.estilo)),
			);
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
		} else {
			const regrasIcone = regrasDoIcone(p.estilo, p.cor);
			if (p.estilo.mostrarIcone === true && dados.global.mostrarIcone === false) {
				regrasIcone.unshift("display: flex;");
			}
			partes.push(bloco(`${sel} > .callout-title > .callout-icon`, regrasIcone));
			partes.push(bloco(`${sel} > .callout-title > .callout-icon > svg`, regrasDoSvg(p.estilo)));
		}
	}

	return partes.filter((p) => p.length > 0).join("\n\n");
}

/**
 * CSS de UMA prévia do painel de configurações, escopado por id.
 *
 * Escopado de propósito: as regras da prévia não podem vazar para as notas. Por isso o
 * seletor é `#<id> .callout`, e não `.callout` — e por isso esta função é separada do
 * `gerarCssCallouts`, em vez de um parâmetro nele: são dois destinos com regras diferentes
 * (a prévia mostra UM estilo resolvido; o CSS real precisa da lógica de coringa, tipos e
 * exclusões).
 *
 * `estiloResolvido` já vem com a herança aplicada pelo chamador — a prévia mostra o
 * resultado final, não a cascata.
 */
export function gerarCssPrevia(
	idPrevia: string,
	estiloResolvido: EstiloCallout,
	cor?: string,
	icone?: string,
): string {
	const base = `#${idPrevia} .callout`;
	const partes: string[] = [];

	const regras = regrasDoCallout(estiloResolvido, cor);
	if (icone) regras.push(`--callout-icon: ${icone};`);
	// A prévia vive dentro do modal de settings, onde o mix-blend-mode dá resultado
	// diferente do fundo de uma nota. Fixamos normal para o que ela vê ser o que sai.
	if (!estiloResolvido.corSolida) regras.push("--callout-blend-mode: normal;");
	partes.push(bloco(base, regras));

	partes.push(bloco(`${base} > .callout-title`, regrasDoTitulo(estiloResolvido)));

	if (estiloResolvido.mostrarIcone === false) {
		partes.push(bloco(`${base} > .callout-title > .callout-icon`, ["display: none;"]));
	} else {
		// `cor` aqui é a do estilo previsualizado; sem ela a prévia cai na cor do Obsidian, então
		// a forma com variável cobre esse caso — mesma lógica do bloco global.
		const iconePrevia = regrasDoIcone(estiloResolvido, cor);
		if (!cor) iconePrevia.push("color: rgb(var(--callout-color));");
		partes.push(bloco(`${base} > .callout-title > .callout-icon`, iconePrevia));
		partes.push(bloco(`${base} > .callout-title > .callout-icon > svg`, regrasDoSvg(estiloResolvido)));
	}

	return partes.filter((p) => p.length > 0).join("\n\n");
}

/** Aplica a herança: o que o estilo específico não define, vem do global. */
export function resolverEstilo(global: EstiloCallout, especifico: EstiloCallout): EstiloCallout {
	return { ...global, ...limparIndefinidos(especifico) };
}

/** Remove chaves com valor `undefined` para o spread não apagar o que veio do global. */
function limparIndefinidos(e: EstiloCallout): EstiloCallout {
	const saida: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(e)) {
		if (v !== undefined) saida[k] = v;
	}
	return saida as EstiloCallout;
}
