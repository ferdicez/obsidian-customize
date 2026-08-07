/**
 * Dados das abas nas Bases (funcionalidade 3 do Customize, vinda do plugin Base Tabs).
 *
 * Este módulo é o antigo `dados.ts` do base-tabs, com uma diferença central: ele NÃO fala com o
 * `plugin.loadData()` diretamente. O Customize tem um único `data.json` para as três
 * funcionalidades, então o que era a raiz do arquivo virou o ramo `abas` de `DadosCustomize`.
 * Aqui ficam só o formato e os helpers de leitura — carregar/salvar é responsabilidade do
 * `dados.ts` da raiz, que faz o merge com os padrões.
 *
 * Nunca escrevemos nos arquivos .base — a chave é derivada do caminho do .base + nome da view.
 */

/** Como uma aba é exibida: ícone + nome (padrão), só o ícone, ou só o nome. */
export type ModoExibicao = "ambos" | "so-icone" | "so-nome";
export const MODO_PADRAO: ModoExibicao = "ambos";

export interface DadosAbas {
	/**
	 * Interruptor da funcionalidade. Ligado por padrão — quem instala o Customize com Bases no
	 * vault espera as abas funcionando, como funcionavam no plugin separado.
	 *
	 * O motivo de existir é de segurança, não de preferência: o Base Tabs já travou o Obsidian
	 * duas vezes com bases enormes (ver `_docs/base-tabs.md`, sessão 2026-07-21 parte 7). Como
	 * plugin separado, a saída de emergência era desativá-lo e manter o resto do vault. Agora
	 * que ele mora dentro do Customize, desligar o plugin levaria junto callouts e paleta de
	 * cores — este toggle devolve a saída de emergência sem esse custo.
	 */
	ativo: boolean;
	/** chave: "<caminho-do-.base>::<nome-da-view>"  →  id de ícone Lucide (ex.: "table") */
	iconesPorView: Record<string, string>;
	/** chave: "<caminho-do-.base>::<nome-da-view>"  →  modo de exibição da aba */
	exibicaoPorView: Record<string, ModoExibicao>;
}

export const ABAS_PADRAO: DadosAbas = {
	ativo: true,
	iconesPorView: {},
	exibicaoPorView: {},
};

/**
 * Chave estável de uma view. Como o Obsidian não dá id às views (só `name`+`type`),
 * a identidade é (caminho do .base, nome da view). Renomear a view/o arquivo desvincula o ícone.
 */
export function chaveDaView(caminhoBase: string | null, nomeView: string): string {
	return `${caminhoBase ?? "?"}::${nomeView}`;
}

/** Ícone salvo para uma view, ou undefined se a usuária ainda não escolheu nenhum. */
export function iconeDaView(dados: DadosAbas, caminhoBase: string | null, nomeView: string): string | undefined {
	return dados.iconesPorView[chaveDaView(caminhoBase, nomeView)];
}

/** Modo de exibição salvo para uma view (ou o padrão "ambos"). */
export function modoDaView(dados: DadosAbas, caminhoBase: string | null, nomeView: string): ModoExibicao {
	return dados.exibicaoPorView?.[chaveDaView(caminhoBase, nomeView)] ?? MODO_PADRAO;
}
