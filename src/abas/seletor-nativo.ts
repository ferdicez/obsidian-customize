/**
 * Camada ÚNICA de acoplamento ao DOM interno das Bases do Obsidian.
 *
 * O Obsidian não expõe API pública para listar/trocar as views de uma Base, então tudo aqui
 * depende da estrutura interna do DOM (não documentada, pode mudar entre versões). Por isso
 * concentramos TODO o "conhecimento frágil" neste arquivo. Toda função é defensiva.
 *
 * Estrutura real (mapeada em runtime, Obsidian ~1.13):
 *   .bases-view[data-view-type][data-view-name]   → container da view ATIVA (só a grade/cards/tabela)
 *   .bases-toolbar                                 → toolbar (IRMÃ do .bases-view, não dentro dele)
 *     .bases-toolbar-item.bases-toolbar-views-menu → o SELETOR de views (abre o menu de views)
 *       .text-icon-button                          → o botão clicável
 *         .text-button-label                       → o nome da view ativa
 *     .bases-toolbar-item.bases-toolbar-new-item-menu → botão "Novo" (novo item; NÃO é adicionar view)
 *
 * As views em si são lidas do arquivo .base (YAML), não do DOM — mais confiável que abrir o menu.
 */

export interface ViewNativa {
	nome: string;
	tipo: string;
	ativa: boolean;
}

export let DIAGNOSTICO = false;
export function definirDiagnostico(v: boolean): void {
	DIAGNOSTICO = v;
}
function log(...args: unknown[]): void {
	if (DIAGNOSTICO) console.log("[base-tabs]", ...args);
}

/**
 * A toolbar de uma Base. A toolbar NÃO fica dentro do .bases-view — é irmã/ancestral. Então subimos
 * até um contêiner de Base plausível e buscamos a toolbar lá dentro.
 */
export function encontrarToolbar(basesViewEl: HTMLElement): HTMLElement | null {
	const dentro = basesViewEl.querySelector<HTMLElement>(".bases-toolbar");
	if (dentro) return dentro;

	let atual: HTMLElement | null = basesViewEl.parentElement;
	while (atual) {
		const t = atual.querySelector<HTMLElement>(".bases-toolbar");
		if (t) return t;
		atual = atual.parentElement;
	}
	return null;
}

/** O botão clicável do seletor de views (o que abre o menu de views). */
export function encontrarSeletor(toolbarEl: HTMLElement): HTMLElement | null {
	const item = toolbarEl.querySelector<HTMLElement>(".bases-toolbar-views-menu");
	return item?.querySelector<HTMLElement>(".text-icon-button") ?? item;
}

/** O nome da view ativa, lido do atributo do container .bases-view. */
export function nomeViewAtiva(basesViewEl: HTMLElement): string | null {
	return basesViewEl.getAttribute("data-view-name");
}

/** O tipo da view ativa (table|cards|list|map|...), lido do atributo do container. */
export function tipoViewAtiva(basesViewEl: HTMLElement): string | null {
	return basesViewEl.getAttribute("data-view-type");
}

function esperar(ms: number): Promise<void> {
	return new Promise((r) => window.setTimeout(r, ms));
}

/**
 * Abre o menu nativo de views com eventos de mouse reais (o Obsidian não responde a um .click()
 * sintético simples nesses botões) e ESPERA o .menu aparecer (é assíncrono). Retorna o menu ou null.
 */
async function abrirMenuDeViews(seletor: HTMLElement): Promise<HTMLElement | null> {
	const opts = { bubbles: true, cancelable: true, view: window, button: 0 } as MouseEventInit;

	// O seletor é escondido via CSS (classe .base-tabs-ativo na toolbar). Um elemento escondido/fora
	// da tela pode não responder ao clique programático. Então, só durante o clique, forçamos ele a
	// ficar acionável (via style inline, que vence o CSS). É imperceptível — dura milissegundos.
	const estiloAnterior = seletor.getAttribute("style") ?? "";
	seletor.style.pointerEvents = "auto";
	seletor.style.position = "static";
	seletor.style.width = "auto";
	seletor.style.height = "auto";

	// dispara a sequência completa de eventos de ponteiro + mouse.
	seletor.dispatchEvent(new PointerEvent("pointerdown", opts));
	seletor.dispatchEvent(new MouseEvent("mousedown", opts));
	seletor.dispatchEvent(new PointerEvent("pointerup", opts));
	seletor.dispatchEvent(new MouseEvent("mouseup", opts));
	seletor.dispatchEvent(new MouseEvent("click", opts));

	// restaura o estilo (o CSS volta a esconder o seletor).
	seletor.setAttribute("style", estiloAnterior);

	// espera o menu de views surgir E ter itens (o Obsidian preenche de forma assíncrona).
	for (let i = 0; i < 30; i++) {
		const menu = document.querySelector<HTMLElement>(".menu.bases-toolbar-views-menu");
		if (menu?.querySelector(SELETOR_ITEM)) return menu;
		await esperar(20);
	}
	return document.querySelector<HTMLElement>(".menu.bases-toolbar-views-menu");
}

/** Classe real de cada item de view no menu nativo (mapeada em runtime). */
const SELETOR_ITEM = ".bases-toolbar-menu-item";
const SELETOR_NOME = ".bases-toolbar-menu-item-name";

function fecharMenu(menu: HTMLElement | null): void {
	document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	menu?.remove();
}

/** O texto/nome de um item do menu de views. */
function nomeDoItem(item: HTMLElement): string {
	const nomeEl = item.querySelector<HTMLElement>(SELETOR_NOME) ?? item;
	return (nomeEl.textContent ?? "").trim();
}

/**
 * Abre o menu nativo de configuração de UMA view (renomear, duplicar, excluir, etc.).
 * Isso devolve o acesso às ações nativas que o plugin escondeu ao ocultar o seletor. Funciona
 * acionando a "setinha" (submenu) do item da view no menu nativo de views.
 */
export async function abrirConfigNativaDaView(basesViewEl: HTMLElement, nome: string): Promise<boolean> {
	const toolbar = encontrarToolbar(basesViewEl);
	if (!toolbar) return false;
	const seletor = encontrarSeletor(toolbar);
	if (!seletor) return false;
	try {
		const menu = await abrirMenuDeViews(seletor);
		if (!menu) return false;
		const itens = Array.from(menu.querySelectorAll<HTMLElement>(SELETOR_ITEM));
		const alvo = itens.find((item) => nomeDoItem(item) === nome);
		if (!alvo) {
			fecharMenu(menu);
			return false;
		}
		// a setinha ">" do item abre o submenu com as ações (renomear/duplicar/excluir).
		const setinha = alvo.querySelector<HTMLElement>(".bases-toolbar-menu-item-icon");
		if (setinha) {
			setinha.click();
			return true;
		}
		fecharMenu(menu);
		return false;
	} catch (e) {
		log("erro ao abrir config nativa da view", e);
		return false;
	}
}

/**
 * Troca a view ativa da Base: abre o menu de views nativo e clica no item de nome `nome`.
 * O menu do Obsidian aparece de forma assíncrona, então esperamos ele surgir antes de clicar.
 */
export async function trocarPara(basesViewEl: HTMLElement, nome: string): Promise<boolean> {
	const toolbar = encontrarToolbar(basesViewEl);
	if (!toolbar) return false;
	const seletor = encontrarSeletor(toolbar);
	if (!seletor) return false;

	try {
		const menu = await abrirMenuDeViews(seletor);
		if (!menu) return false;
		const itens = Array.from(menu.querySelectorAll<HTMLElement>(SELETOR_ITEM));
		const alvo = itens.find((item) => nomeDoItem(item) === nome);
		if (alvo) {
			// clica na área de informação do item (o nome), não na setinha ">" que abre submenu.
			const alvoClicavel = alvo.querySelector<HTMLElement>(".bases-toolbar-menu-item-info") ?? alvo;
			alvoClicavel.click();
			return true;
		}
		fecharMenu(menu);
		return false;
	} catch (e) {
		log("erro ao trocar de view", e);
		return false;
	}
}

