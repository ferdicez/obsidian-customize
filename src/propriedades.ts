/**
 * Propriedades da nota — esconder as que não importam e distribuir o resto em colunas.
 *
 * ## O que o Obsidian desenha (verificado no vault, não deduzido)
 *
 * ```
 * .metadata-container                     ← o bloco inteiro, no topo da nota
 *   .metadata-properties-heading          ← a linha "Propriedades" (some com o Minimal)
 *   .metadata-properties                  ← o container das linhas — é este que vira grade
 *     .metadata-property[data-property-key="created"]
 *     .metadata-property[data-property-key="tags"]
 *     ...
 *   .metadata-add-button                  ← "Adicionar propriedade"
 * ```
 *
 * O `data-property-key` é a chave do frontmatter **em minúsculas** — foi por isso que
 * `pretty-properties` e o tema Minimal, os dois instalados aqui, miram por
 * `[data-property-key="tags"]`. É essa garantia que deixa a funcionalidade inteira ser CSS:
 * não tocamos no DOM do Obsidian, só emitimos regras.
 *
 * ## ARMADILHA 1 — por que CSS e não JavaScript
 *
 * A tentação é percorrer as `.metadata-property` e dar `display: none` nas escondidas. Não faça:
 * o Obsidian recria esse bloco a cada troca de nota, a cada edição de frontmatter e a cada
 * re-render do editor. Um MutationObserver competindo com isso é a receita dos travamentos que já
 * custaram duas sessões nas abas das Bases (ver `_docs/customize.md`). Uma folha de estilo é
 * declarativa: vale para o que já existe e para o que o Obsidian desenhar depois, sem observador.
 *
 * ## ARMADILHA 2 — esconder não pode esconder o que está sendo editado
 *
 * `display: none` num campo com o cursor dentro tira o foco no meio da digitação. Por isso a regra
 * de ocultar abre exceção para `:focus-within`: a propriedade escondida que ela abriu para editar
 * continua na tela até ela sair do campo.
 *
 * ## ARMADILHA 3 — a grade tem que valer para as linhas, não para o bloco
 *
 * `display: grid` vai em `.metadata-properties` (o pai direto das linhas). Aplicar em
 * `.metadata-container` colocaria o cabeçalho e o botão "Adicionar propriedade" como células da
 * grade, cada um numa coluna.
 *
 * ## ARMADILHA 4 — `container-type` quebraria o sticky do Obsidian
 *
 * Duas colunas "quando couber" pede consulta de container (a nota pode estar num split estreito,
 * onde `@media` mede a janela inteira e erra). Mas declarar `container-type: inline-size` cria um
 * contexto de contenção que quebra `position: sticky` de descendentes. Por isso o container é
 * declarado no `.metadata-container`, que não tem descendente sticky, e nunca na coluna do editor.
 */

/** Chave do frontmatter normalizada para casar com o `data-property-key` do Obsidian. */
export function normalizarChave(chave: string): string {
	return chave.trim().toLowerCase();
}

export interface DadosPropriedades {
	/**
	 * Funcionalidade ligada. Nasce **desligada**: é a única das do plugin que muda a aparência de
	 * toda nota do vault sem ela ter configurado nada, e uma propriedade sumindo sem explicação
	 * é assustador. Ela liga quando cadastra a primeira propriedade oculta.
	 */
	ativo: boolean;
	/**
	 * Chaves do frontmatter que ficam escondidas atrás do botão. Guardadas normalizadas
	 * (minúsculas, sem espaços nas pontas) — é a forma que o `data-property-key` tem.
	 */
	ocultas: string[];
	/**
	 * As ocultas estão à mostra agora? Global e persistido, por escolha dela: uma vez revelado,
	 * continua revelado em todas as notas até ela clicar de novo.
	 */
	revelado: boolean;
	/** Distribuir as propriedades em duas colunas quando a largura permitir. */
	duasColunas: boolean;
	/**
	 * Largura mínima (px) da área de propriedades para valer a pena dividir em duas colunas.
	 * Abaixo disso volta para uma coluna sozinho — senão, numa nota em split estreito, os campos
	 * ficariam espremidos a ponto de não caber o valor.
	 */
	larguraMinimaColunas: number;
}

export const PROPRIEDADES_PADRAO: DadosPropriedades = {
	ativo: false,
	ocultas: [],
	revelado: false,
	duasColunas: false,
	larguraMinimaColunas: 520,
};

/** Classe no `body` enquanto as ocultas estão à mostra. É o que o botão do olhinho alterna. */
export const CLASSE_REVELADO = "customize-props-revelado";

/**
 * Escapa uma chave para uso dentro de `[data-property-key="..."]`.
 *
 * A chave vem do frontmatter dela, então pode conter aspas ou barras — sem escape, um nome com
 * aspa fecharia o seletor no meio e derrubaria o resto da folha. `CSS.escape` não serve aqui:
 * ele escapa identificadores, não o conteúdo de uma string entre aspas.
 */
function escaparValor(valor: string): string {
	return valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * O CSS da funcionalidade, gerado a partir do estado atual.
 *
 * Devolve string vazia quando não há nada a fazer — o `<style>` fica vazio em vez de carregar
 * regras que não mudam nada.
 */
export function gerarCssPropriedades(dados: DadosPropriedades): string {
	if (!dados.ativo) return "";

	const blocos: string[] = [];
	const ocultas = dados.ocultas.map(normalizarChave).filter((c) => c.length > 0);

	if (ocultas.length > 0) blocos.push(blocoOcultar(ocultas));
	if (dados.duasColunas) blocos.push(blocoColunas(dados.larguraMinimaColunas));

	return blocos.join("\n\n");
}

/**
 * Esconde as propriedades cadastradas — a menos que o `body` esteja com a classe de revelado.
 *
 * O `:not()` no `body` é o que faz o botão funcionar **sem regenerar o CSS**: alternar uma classe
 * no body é instantâneo e não passa pelo `<style>`. Se a regra fosse emitida condicionalmente,
 * cada clique no olhinho reescreveria a folha inteira e o navegador recalcularia estilo de tudo.
 *
 * O `:focus-within` é a ARMADILHA 2 do cabeçalho: campo em edição não some debaixo do cursor.
 */
function blocoOcultar(ocultas: string[]): string {
	const seletores = ocultas
		.map(
			(chave) =>
				`body:not(.${CLASSE_REVELADO}) .metadata-property[data-property-key="${escaparValor(chave)}"]:not(:focus-within)`,
		)
		.join(",\n");

	return `${seletores} {\n\tdisplay: none;\n}`;
}

/**
 * Duas colunas, via consulta de container.
 *
 * `@container` e não `@media`: a nota pode estar num split ou numa aba estreita, e `@media` mede a
 * janela inteira — daria duas colunas espremidas num painel de 300px. A consulta de container mede
 * a área que a nota de fato ocupa.
 *
 * O `container-type` vai no `.metadata-container` (ARMADILHA 4): é o ancestral mais próximo que
 * não tem descendente `sticky`, então contê-lo não quebra nada do Obsidian.
 *
 * `align-items: start` impede que uma propriedade de valor alto (uma lista de tags que quebra em
 * várias linhas) estique a célula vizinha para a mesma altura, deixando um buraco na coluna.
 */
function blocoColunas(larguraMinima: number): string {
	return [
		`.metadata-container {`,
		`\tcontainer-type: inline-size;`,
		`\tcontainer-name: customize-props;`,
		`}`,
		``,
		`@container customize-props (min-width: ${larguraMinima}px) {`,
		`\t.metadata-properties {`,
		`\t\tdisplay: grid;`,
		`\t\tgrid-template-columns: 1fr 1fr;`,
		`\t\talign-items: start;`,
		`\t\tcolumn-gap: var(--size-4-4);`,
		`\t}`,
		`}`,
	].join("\n");
}
