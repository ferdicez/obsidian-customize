import type { Plugin } from "obsidian";
import { ABAS_PADRAO, type DadosAbas } from "./abas/dados";
import { CALLOUTS_PADRAO, type DadosCallouts } from "./callouts";

/**
 * Dados persistidos do plugin (data.json). Guarda as paletas de cores da usuária e qual está ativa.
 * Nada aqui depende do DOM — é o modelo puro, testável sem o Obsidian.
 */

export interface Paleta {
	/** id estável — nunca muda ao renomear. É o que `paletaAtivaId` referencia. */
	id: string;
	nome: string;
	/** hex "#rrggbb" minúsculo, na ordem em que aparecem no popover. Duplicatas são permitidas. */
	cores: string[];
}

export interface DadosCustomize {
	paletas: Paleta[];
	/** id da paleta usada no popover. Se sumir, `paletaAtiva()` cai na primeira (ver abaixo). */
	paletaAtivaId: string;
	/**
	 * Substituir também o seletor de cor nativo do Obsidian pela paleta. Desligado por padrão:
	 * o uso principal do plugin é o atalho de teclado que copia o hex. Ligar isto é invasivo
	 * (afeta seletores de outros plugins), então é opt-in.
	 */
	interceptacaoAtiva: boolean;
	/** Seletores CSS de ancestrais onde NÃO interceptar (ex.: ".modal.mod-plugin-x"). */
	seletoresIgnorados: string[];
	/** Mostra o botão "Cor personalizada" no rodapé do popover (abre o diálogo do sistema). */
	permitirCorPersonalizada: boolean;
	/** Customização visual dos callouts. */
	callouts: DadosCallouts;
	/** Abas nas Bases (ícones por view e modo de exibição). Veio do plugin Base Tabs. */
	abas: DadosAbas;
}

export const PALETA_PADRAO_ID = "padrao";

export const DADOS_PADRAO: DadosCustomize = {
	paletas: [
		{
			id: PALETA_PADRAO_ID,
			nome: "Padrão",
			cores: [
				"#e03131", "#f76707", "#f59f00", "#66a80f",
				"#2f9e44", "#0ca678", "#1098ad", "#1c7ed6",
				"#4263eb", "#7048e8", "#ae3ec9", "#d6336c",
				"#212529", "#868e96", "#dee2e6", "#ffffff",
			],
		},
	],
	paletaAtivaId: PALETA_PADRAO_ID,
	interceptacaoAtiva: false,
	seletoresIgnorados: [],
	permitirCorPersonalizada: true,
	callouts: CALLOUTS_PADRAO,
	abas: ABAS_PADRAO,
};

/** Devolvida quando não há paleta nenhuma. Congelada: ninguém escreve nela por acidente. */
const PALETA_VAZIA: Paleta = Object.freeze({ id: "", nome: "", cores: Object.freeze([]) as unknown as string[] });

export async function carregarDados(plugin: Plugin): Promise<DadosCustomize> {
	const data = await plugin.loadData();
	// Object.assign raso (padrão dos outros plugins do vault): um campo novo adicionado ao
	// DADOS_PADRAO nasce preenchido mesmo em data.json antigos.
	const dados = Object.assign({}, DADOS_PADRAO, data) as DadosCustomize;

	// Blindagens contra data.json corrompido ou editado à mão — o interceptador roda no
	// mousedown de TODO o app, então um dado torto aqui não pode virar exceção lá.
	if (!Array.isArray(dados.paletas)) dados.paletas = DADOS_PADRAO.paletas.map(clonarPaleta);
	dados.paletas = dados.paletas.filter((p) => p && typeof p.id === "string" && Array.isArray(p.cores));
	if (dados.paletas.length === 0) dados.paletas = DADOS_PADRAO.paletas.map(clonarPaleta);
	if (!Array.isArray(dados.seletoresIgnorados)) dados.seletoresIgnorados = [];

	// `callouts` é aninhado, e o Object.assign acima é raso: precisa do seu próprio merge,
	// senão um data.json salvo antes desta funcionalidade viria sem `global`/`personalizados`.
	dados.callouts = {
		...CALLOUTS_PADRAO,
		...(dados.callouts ?? {}),
		global: { ...CALLOUTS_PADRAO.global, ...(dados.callouts?.global ?? {}) },
		coringa: {
			...CALLOUTS_PADRAO.coringa,
			...(dados.callouts?.coringa ?? {}),
			estilo: { ...(dados.callouts?.coringa?.estilo ?? {}) },
		},
	};
	if (!Array.isArray(dados.callouts.personalizados)) dados.callouts.personalizados = [];

	// `abas` é aninhado, e o Object.assign acima é raso: precisa do seu próprio merge, senão um
	// data.json salvo antes desta funcionalidade viria sem `ativo`/`iconesPorView`.
	dados.abas = {
		...ABAS_PADRAO,
		...(dados.abas ?? {}),
		iconesPorView: { ...(dados.abas?.iconesPorView ?? {}) },
		exibicaoPorView: { ...(dados.abas?.exibicaoPorView ?? {}) },
	};

	return dados;
}

export async function salvarDados(plugin: Plugin, dados: DadosCustomize): Promise<void> {
	await plugin.saveData(dados);
}

function clonarPaleta(p: Paleta): Paleta {
	return { id: p.id, nome: p.nome, cores: [...p.cores] };
}

/**
 * A paleta em uso. Nunca lança e nunca devolve undefined: se a ativa foi excluída, cai na
 * primeira da lista; se não há nenhuma, devolve a paleta vazia (e o interceptador desiste,
 * deixando o seletor nativo funcionar).
 */
export function paletaAtiva(dados: DadosCustomize): Paleta {
	return dados.paletas.find((p) => p.id === dados.paletaAtivaId) ?? dados.paletas[0] ?? PALETA_VAZIA;
}

export function novoId(): string {
	return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function criarPaleta(dados: DadosCustomize, nome: string): Paleta {
	const paleta: Paleta = { id: novoId(), nome: nome.trim() || "Nova paleta", cores: [] };
	dados.paletas.push(paleta);
	return paleta;
}

/**
 * Remove a paleta e reaponta a ativa se for preciso — o data.json nunca guarda id órfão.
 * Recusa remover a última: "nenhuma paleta" é um estado que a UI não precisa saber representar.
 */
export function removerPaleta(dados: DadosCustomize, id: string): boolean {
	if (dados.paletas.length <= 1) return false;
	const i = dados.paletas.findIndex((p) => p.id === id);
	if (i < 0) return false;
	dados.paletas.splice(i, 1);
	if (dados.paletaAtivaId === id) dados.paletaAtivaId = dados.paletas[0].id;
	return true;
}

/** Reordena uma cor dentro da paleta (delta -1 = sobe, +1 = desce). Ignora movimentos fora da lista. */
export function moverCor(paleta: Paleta, indice: number, delta: number): void {
	const destino = indice + delta;
	if (destino < 0 || destino >= paleta.cores.length) return;
	const [cor] = paleta.cores.splice(indice, 1);
	paleta.cores.splice(destino, 0, cor);
}
