import { parseYaml, TFile, type App } from "obsidian";

/** Uma view declarada no arquivo .base. */
export interface ViewDoArquivo {
	nome: string;
	tipo: string;
}

/**
 * Resolve o texto do `base:` (ex.: "workspaces", "workspaces.base", "Pasta/workspaces") para o
 * arquivo .base real, do mesmo jeito que o Obsidian resolve `![[...]]` — acha pelo nome mesmo sem a
 * pasta. `sourcePath` é a nota onde o bloco está (para links relativos). Retorna null se não achar.
 */
export function resolverArquivoBase(app: App, entrada: string, sourcePath = ""): TFile | null {
	const limpo = entrada.trim().replace(/^\[\[|\]\]$/g, "");
	const comExt = limpo.endsWith(".base") ? limpo : `${limpo}.base`;

	// 1) caminho exato (funciona quando a usuária deu o caminho completo).
	const exato = app.vault.getAbstractFileByPath(comExt);
	if (exato instanceof TFile) return exato;

	// 2) resolução por link (acha pelo nome do arquivo, como o ![[...]] faz).
	const porLink = app.metadataCache.getFirstLinkpathDest(comExt, sourcePath);
	if (porLink instanceof TFile) return porLink;
	// tenta também sem a extensão (o resolvedor às vezes prefere assim).
	const porLinkSemExt = app.metadataCache.getFirstLinkpathDest(limpo, sourcePath);
	if (porLinkSemExt instanceof TFile && porLinkSemExt.extension === "base") return porLinkSemExt;

	return null;
}

/**
 * Lê a lista de views de um arquivo .base (YAML). Estrutura:
 *   views:
 *     - type: table
 *       name: Tabela
 *     - type: cards
 *       name: teste 3
 *
 * Retorna [] se não conseguir ler/parsear. Usa o cache do Obsidian (leitura síncrona) quando possível.
 */
export function lerViewsDoArquivo(app: App, caminhoBase: string | null, sourcePath = ""): ViewDoArquivo[] {
	if (!caminhoBase) return [];
	const file = resolverArquivoBase(app, caminhoBase, sourcePath);
	if (!file) return [];

	const conteudo = cacheConteudo.get(file.path);
	if (!conteudo) return []; // cache ainda não preenchido; próximo ciclo resolve.

	try {
		const dados = parseYaml(conteudo) as { views?: Array<{ name?: string; type?: string }> } | null;
		const views = dados?.views;
		if (!Array.isArray(views)) return [];
		return views
			.filter((v) => typeof v?.name === "string" && v.name.length > 0)
			.map((v) => ({ nome: v.name as string, tipo: v.type ?? "" }));
	} catch {
		return [];
	}
}

const cacheConteudo = new Map<string, string>();

/**
 * Lê o arquivo .base de fato e popula o cache, para as próximas leituras síncronas.
 * Resolve a entrada (nome/caminho) para o arquivo real como o ![[...]] faz. Retorna true se conseguiu.
 */
export async function preencherCacheBase(app: App, caminhoBase: string | null, sourcePath = ""): Promise<boolean> {
	if (!caminhoBase) return false;
	const file = resolverArquivoBase(app, caminhoBase, sourcePath);
	if (!file) return false;
	try {
		const texto = await app.vault.cachedRead(file);
		cacheConteudo.set(file.path, texto);
		return true;
	} catch {
		return false;
	}
}

/** Invalida o cache de um .base pelo caminho real do arquivo. */
export function invalidarCacheBase(caminhoReal: string): void {
	cacheConteudo.delete(caminhoReal);
}
