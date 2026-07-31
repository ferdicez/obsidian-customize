import { Notice, Plugin } from "obsidian";
import { gerarCssCallouts } from "./callouts";
import { carregarDados, paletaAtiva, salvarDados, type DadosCustomize } from "./dados";
import { EstilosDinamicos } from "./estilos-dinamicos";
import { InterceptadorDeCor } from "./interceptador-de-cor";
import { PainelConfigCustomize } from "./painel-config";
import { PopoverPaleta } from "./popover-paleta";
import { processarTitulos } from "./titulo-callout";

/**
 * Customize — customizações da interface do Obsidian.
 *
 * Duas funcionalidades:
 *
 * 1. **Paleta de cores.** Um atalho de teclado abre a paleta com os códigos hex à mostra;
 *    clicar numa cor copia o código e o popover continua aberto. Opcionalmente (desligado
 *    por padrão), substitui também o seletor de cor nativo — ver `interceptador-de-cor.ts`.
 * 2. **Callouts.** Customiza borda, fundo, raio, alinhamento do título, ícone e cor dos
 *    callouts, global ou por tipo — ver `callouts.ts`.
 */
export default class CustomizePlugin extends Plugin {
	dados!: DadosCustomize;
	private popover!: PopoverPaleta;
	private interceptador!: InterceptadorDeCor;
	private estilosCallouts!: EstilosDinamicos;

	async onload() {
		this.dados = await carregarDados(this);

		this.popover = new PopoverPaleta();
		// getDados como função (não o objeto): as settings trocam campos de `this.dados` a
		// qualquer momento, e o interceptador precisa ler sempre o estado atual.
		this.interceptador = new InterceptadorDeCor(this, () => this.dados, this.popover);
		this.interceptador.iniciar();

		this.estilosCallouts = new EstilosDinamicos(this, "callouts");
		this.estilosCallouts.iniciar();
		this.aplicarEstilos();

		// Troca o título do callout pelo texto depois do `|`. Lê a config a cada chamada
		// (não no registro) para o toggle valer sem recarregar o plugin.
		this.registerMarkdownPostProcessor((el, ctx) => {
			if (!this.dados.callouts.ativo || !this.dados.callouts.tituloPeloMetadata) return;
			processarTitulos(el, ctx);
		});

		// Trocar de tema ou recarregar snippets reordena os <style> do head; reaplicamos para
		// continuar depois deles na cascata.
		this.registerEvent(this.app.workspace.on("css-change", () => this.aplicarEstilos()));

		// Sem hotkey padrão de propósito: qualquer combinação que eu escolhesse teria chance de
		// colidir com um atalho do Obsidian ou de outro plugin. A usuária define o dela em
		// Configurações → Atalhos de teclado, procurando por "Customize".
		this.addCommand({
			id: "abrir-paleta",
			name: "Abrir paleta de cores",
			callback: () => this.alternarPaleta(),
		});

		this.addSettingTab(new PainelConfigCustomize(this.app, this));
	}

	onunload() {
		// Os listeners de document saem sozinhos via registerDomEvent; o popover é nosso.
		this.popover?.destruir();
	}

	async salvar(): Promise<void> {
		await salvarDados(this, this.dados);
		this.aplicarEstilos();
	}

	/** Regera e reaplica o CSS dos callouts a partir do estado atual. */
	aplicarEstilos(): void {
		this.estilosCallouts?.aplicar(gerarCssCallouts(this.dados.callouts));
	}

	/** Abre a paleta em modo copiar — ou fecha, se o atalho for apertado com ela já aberta. */
	private alternarPaleta(): void {
		if (this.popover.aberto) {
			this.popover.fechar();
			return;
		}

		const paleta = paletaAtiva(this.dados);
		if (paleta.cores.length === 0) {
			new Notice("A paleta ativa não tem nenhuma cor. Adicione cores em Configurações → Customize.");
			return;
		}

		this.popover.abrirCentralizado({
			modo: "copiar",
			cores: paleta.cores,
			titulo: paleta.nome,
			permitirCorPersonalizada: false,
			aoEscolher: (hex, botao) => {
				void this.copiar(hex, botao);
				return false; // não fecha: dá pra copiar várias cores em sequência
			},
		});
	}

	private async copiar(hex: string, botao: HTMLElement): Promise<void> {
		try {
			await navigator.clipboard.writeText(hex);
			this.popover.marcarCopiado(botao);
			new Notice(`${hex} copiado`);
		} catch (e) {
			console.warn("[customize] falha ao copiar para a área de transferência:", e);
			new Notice("Não consegui copiar a cor.");
		}
	}
}
