import { setIcon } from "obsidian";

/**
 * Seção recolhível no estilo do painel de configurações do My Tasks — o padrão comum dos
 * painéis do vault (ver `_docs/painel-de-configuracoes.md`, regra 5).
 *
 * Portado de `dash-home/src/acordeao.ts` com o prefixo de classe trocado, e não reescrito,
 * por duas propriedades que a versão ingênua não tem:
 *
 * 1. **Abrir/fechar não redesenha a tela.** O clique só troca classes CSS. Aqui isso importa
 *    ainda mais do que nos outros plugins: o `display()` deste painel é chamado a cada
 *    gravação, e redesenhar no clique perderia foco de campo e posição de scroll.
 * 2. **O conteúdo fechado não é desenhado.** `sePreenchido` adia o desenho até a primeira
 *    abertura, então seção fechada não paga custo (nem cria prévias vivas de callout à toa).
 */

/**
 * Estado de aberto/fechado por chave. Vive no MÓDULO, não na instância do painel, porque
 * `display()` reconstrói a tela inteira a cada gravação: sem isso, mexer em qualquer campo
 * dentro de um acordeão o fecharia na cara dela no meio da edição.
 */
const abertos = new Map<string, boolean>();

export interface OpcoesAcordeao {
	/**
	 * Chave estável para lembrar aberto/fechado entre redesenhos. Precisa ser única na tela e
	 * não pode depender de índice de lista — senão reordenar embaralha o estado.
	 */
	chave: string;
	titulo: string;
	descricao?: string;
	/** Texto curto à direita do título (ex.: "3 cores"). */
	resumo?: string;
	/** Começa aberto na PRIMEIRA vez que aparece; depois vale o que a usuária deixou. */
	abertoPorPadrao?: boolean;
	/** Acordeão aninhado: recua e afina o título, para o nível de dentro não competir com o de fora. */
	aninhado?: boolean;
}

export interface Acordeao {
	/** A seção inteira — use para pendurar botões de ação no cabeçalho. */
	secao: HTMLElement;
	/** O cabeçalho clicável, onde ações extras podem ser inseridas. */
	cabecalho: HTMLElement;
	/** Onde o conteúdo da seção é desenhado. */
	corpo: HTMLElement;
	/** Chamado só quando a seção está ABERTA (ou na primeira abertura). */
	sePreenchido: (desenhar: (corpo: HTMLElement) => void) => void;
}

export function criarAcordeao(container: HTMLElement, opcoes: OpcoesAcordeao): Acordeao {
	const aberto = abertos.get(opcoes.chave) ?? opcoes.abertoPorPadrao ?? false;
	abertos.set(opcoes.chave, aberto);

	const secao = container.createDiv({ cls: "customize-acordeao" });
	if (opcoes.aninhado) secao.addClass("customize-acordeao-aninhado");
	secao.toggleClass("customize-acordeao-aberto", aberto);

	// <button> de propósito: dá foco por teclado e Enter/Espaço de graça, que uma <div> não tem.
	const cabecalho = secao.createEl("button", {
		cls: "customize-acordeao-cabecalho",
		attr: { "aria-expanded": String(aberto) },
	});

	const seta = cabecalho.createSpan({ cls: "customize-acordeao-seta" });
	setIcon(seta, "chevron-right");

	const textos = cabecalho.createDiv({ cls: "customize-acordeao-textos" });
	textos.createSpan({ cls: "customize-acordeao-titulo", text: opcoes.titulo });
	if (opcoes.descricao) {
		textos.createDiv({ cls: "customize-acordeao-descricao", text: opcoes.descricao });
	}
	if (opcoes.resumo) {
		cabecalho.createSpan({ cls: "customize-acordeao-resumo", text: opcoes.resumo });
	}

	const corpo = secao.createDiv({ cls: "customize-acordeao-corpo" });
	if (!aberto) corpo.addClass("customize-oculto");

	// Guarda o desenhador para a primeira abertura, quando a seção nasce fechada. Declarado ANTES
	// do listener que o usa — `let` não sofre hoisting de valor.
	let desenharPendente: ((corpo: HTMLElement) => void) | null = null;

	cabecalho.addEventListener("click", (evento) => {
		// Botões de ação dentro do cabeçalho (nova paleta, novo estilo) não devem abrir/fechar.
		if ((evento.target as HTMLElement).closest(".customize-acordeao-acoes")) return;

		const novoEstado = !(abertos.get(opcoes.chave) ?? false);
		abertos.set(opcoes.chave, novoEstado);
		secao.toggleClass("customize-acordeao-aberto", novoEstado);
		corpo.toggleClass("customize-oculto", !novoEstado);
		cabecalho.setAttr("aria-expanded", String(novoEstado));

		if (novoEstado && desenharPendente) {
			const desenhar = desenharPendente;
			desenharPendente = null;
			desenhar(corpo);
		}
	});

	return {
		secao,
		cabecalho,
		corpo,
		sePreenchido: (desenhar) => {
			if (aberto) {
				desenhar(corpo);
				return;
			}
			desenharPendente = desenhar;
		},
	};
}

/**
 * Marca um acordeão como aberto ANTES de ele ser desenhado. Usado ao criar um item novo (uma
 * paleta, um estilo nomeado): a seção que o contém precisa estar aberta, senão o item nasce
 * escondido atrás de um acordeão fechado e parece que o botão não fez nada.
 */
export function abrirAcordeao(chave: string): void {
	abertos.set(chave, true);
}
