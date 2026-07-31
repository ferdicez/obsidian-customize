import type { App } from "obsidian";
import type { CalloutPersonalizado } from "./callouts";
import { rgbParaHex } from "./cores";

/**
 * Importação dos callouts configurados no plugin Callout Manager.
 *
 * Existe porque a usuária tinha 15 callouts customizados lá e pretende desinstalá-lo — sem
 * isto, desinstalar significaria perder as cores e ícones de todos eles.
 *
 * Lemos o `data.json` do outro plugin pelo cofre (`app.vault.adapter`), não pela API dele:
 * a API só existe enquanto ele estiver instalado e ativo, e o ponto aqui é justamente
 * sobreviver à desinstalação. O arquivo continua no disco até a pasta ser apagada.
 *
 * Formato lido (confirmado no data.json real):
 *   { "callouts": { "settings": { "hoje": [ { "changes": { "icon": "...", "color": "r, g, b" } } ] } } }
 *
 * O valor é um ARRAY de settings porque o Callout Manager permite variações por tema
 * (`condition: { colorScheme: "dark" }`). Pegamos a primeira entrada sem condição — é a
 * que vale para todos os temas. Variações por tema não são suportadas aqui.
 */

const CAMINHO_DATA = ".obsidian/plugins/callout-manager/data.json";

interface MudancaCalloutManager {
	changes?: { icon?: string; color?: string };
	condition?: unknown;
}

interface DataCalloutManager {
	callouts?: {
		settings?: Record<string, MudancaCalloutManager[]>;
	};
}

export interface ResultadoImportacao {
	callouts: CalloutPersonalizado[];
	/** Tipos que existiam mas não puderam ser lidos (cor inválida, entrada vazia). */
	ignorados: string[];
}

/** true se o data.json do Callout Manager existe no cofre. */
export async function temCalloutManager(app: App): Promise<boolean> {
	try {
		return await app.vault.adapter.exists(CAMINHO_DATA);
	} catch {
		return false;
	}
}

/** Lê os callouts do Callout Manager. Devolve lista vazia se não houver nada legível. */
export async function importarDoCalloutManager(app: App): Promise<ResultadoImportacao> {
	const vazio: ResultadoImportacao = { callouts: [], ignorados: [] };

	let bruto: string;
	try {
		if (!(await app.vault.adapter.exists(CAMINHO_DATA))) return vazio;
		bruto = await app.vault.adapter.read(CAMINHO_DATA);
	} catch (e) {
		console.warn("[customize] não consegui ler o data.json do Callout Manager:", e);
		return vazio;
	}

	let data: DataCalloutManager;
	try {
		data = JSON.parse(bruto) as DataCalloutManager;
	} catch (e) {
		console.warn("[customize] data.json do Callout Manager não é JSON válido:", e);
		return vazio;
	}

	const settings = data.callouts?.settings;
	if (!settings || typeof settings !== "object") return vazio;

	const callouts: CalloutPersonalizado[] = [];
	const ignorados: string[] = [];

	for (const [tipo, entradas] of Object.entries(settings)) {
		if (!Array.isArray(entradas) || entradas.length === 0) {
			ignorados.push(tipo);
			continue;
		}

		// Primeira entrada sem condição de tema; se todas tiverem condição, cai na primeira.
		const entrada = entradas.find((e) => e && e.condition === undefined) ?? entradas[0];
		const mudancas = entrada?.changes;
		if (!mudancas) {
			ignorados.push(tipo);
			continue;
		}

		const cor = mudancas.color ? rgbParaHex(mudancas.color) ?? undefined : undefined;
		const icone = mudancas.icon?.trim() || undefined;

		if (!cor && !icone) {
			ignorados.push(tipo);
			continue;
		}

		callouts.push({ tipo: tipo.trim().toLowerCase(), cor, icone, estilo: {} });
	}

	callouts.sort((a, b) => a.tipo.localeCompare(b.tipo));
	return { callouts, ignorados };
}
