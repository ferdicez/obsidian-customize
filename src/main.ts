import { Notice, Plugin, requireApiVersion } from "obsidian";
import { chaveDaView, iconeDaView, type ModoExibicao } from "./abas/dados";
import { GerenciadorDeAbas } from "./abas/gerenciador-de-abas";
import { ProcessadorBaseTabs } from "./abas/codeblock/processador";
import { gerarCssCallouts } from "./callouts";
import { carregarDados, paletaAtiva, salvarDados, type DadosCustomize } from "./dados";
import { EstilosDinamicos } from "./estilos-dinamicos";
import { InterceptadorDeCor } from "./interceptador-de-cor";
import { ModalEscolherIcone } from "./modal-escolher-icone";
import { PainelConfigCustomize } from "./painel-config";
import { PopoverPaleta } from "./popover-paleta";
import { BotaoPropriedades } from "./botao-propriedades";
import { gerarCssPropriedades } from "./propriedades";
import { processarTitulos } from "./titulo-callout";

/** Linguagem do bloco de código do embed curado de Base (veio do plugin Base Tabs). */
export const LINGUAGEM_BLOCO = "base-tabs";

/**
 * Versão do Obsidian em que as Bases passaram a existir. Abaixo dela, a funcionalidade de abas
 * simplesmente não se registra — é por isso que o `minAppVersion` do manifest pode continuar em
 * 1.4.10 mesmo depois de absorver o Base Tabs (que exigia 1.10.0): quem estiver numa versão
 * antiga continua com paleta e callouts funcionando, em vez de não poder instalar o plugin.
 */
const VERSAO_MINIMA_BASES = "1.10.0";

/**
 * Customize — customizações da interface do Obsidian.
 *
 * Três funcionalidades:
 *
 * 1. **Paleta de cores.** Um atalho de teclado abre a paleta com os códigos hex à mostra;
 *    clicar numa cor copia o código e o popover continua aberto. Opcionalmente (desligado
 *    por padrão), substitui também o seletor de cor nativo — ver `interceptador-de-cor.ts`.
 * 2. **Callouts.** Customiza borda, fundo, raio, alinhamento do título, ícone e cor dos
 *    callouts, global ou por tipo — ver `callouts.ts`.
 * 3. **Abas nas Bases.** Mostra as views de uma Base como abas horizontais com ícones, no lugar
 *    do menu suspenso nativo — ver `abas/`. Era o plugin Base Tabs, absorvido na 0.5.0.
 */
export default class CustomizePlugin extends Plugin {
	dados!: DadosCustomize;
	private popover!: PopoverPaleta;
	private interceptador!: InterceptadorDeCor;
	private estilosCallouts!: EstilosDinamicos;
	/**
	 * `<style>` separado do de callouts de propósito: são funcionalidades independentes, e um erro
	 * na geração de uma não pode invalidar a folha da outra.
	 */
	private estilosPropriedades!: EstilosDinamicos;
	private botaoPropriedades!: BotaoPropriedades;
	gerenciadorAbas: GerenciadorDeAbas | null = null;
	/** Ouvintes para forçar re-render das abas (ex.: após trocar um ícone) — inclui embeds curados. */
	private ouvintesReescan = new Set<() => void>();

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
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				this.aplicarEstilos();
				// A folha de propriedades também precisa voltar ao fim do head: o tema Minimal
				// estiliza `.metadata-property`, e quem vem depois ganha o empate.
				this.estilosPropriedades?.aplicar(gerarCssPropriedades(this.dados.propriedades));
			}),
		);

		// Sem hotkey padrão de propósito: qualquer combinação que eu escolhesse teria chance de
		// colidir com um atalho do Obsidian ou de outro plugin. A usuária define o dela em
		// Configurações → Atalhos de teclado, procurando por "Customize".
		this.addCommand({
			id: "abrir-paleta",
			name: "Abrir paleta de cores",
			callback: () => this.alternarPaleta(),
		});

		this.iniciarPropriedades();
		this.iniciarAbas();
		this.registrarBlocoDeBase();

		this.addSettingTab(new PainelConfigCustomize(this.app, this));
	}

	onunload() {
		// Os listeners de document saem sozinhos via registerDomEvent; o popover é nosso.
		this.popover?.destruir();
		this.pararAbas();
		// Os olhinhos e a classe do body são DOM fora do nosso container — não saem sozinhos com o
		// plugin, e uma classe órfã no body deixaria as propriedades reveladas para sempre.
		this.botaoPropriedades?.limpar();
		this.ouvintesReescan.clear();
	}

	async salvar(): Promise<void> {
		await salvarDados(this, this.dados);
		this.aplicarEstilos();
	}

	// ── Propriedades da nota ─────────────────────────────────────────────────────────────────

	/**
	 * Liga o esconde-propriedades e o layout em colunas.
	 *
	 * Quem esconde é CSS (ver `propriedades.ts`); daqui sai só o `<style>` e o olhinho. Por isso
	 * não há observador de DOM: a varredura acontece nos eventos de workspace, que disparam nas
	 * transições que importam e ficam quietos enquanto ela digita no frontmatter.
	 *
	 * O olhinho vive na barra de ações da aba, via `view.addAction()` — os eventos abaixo existem
	 * para dar o ícone a abas abertas depois do boot (`layout-change` cobre split e aba nova).
	 */
	private iniciarPropriedades(): void {
		this.estilosPropriedades = new EstilosDinamicos(this, "propriedades");
		this.estilosPropriedades.iniciar();

		this.botaoPropriedades = new BotaoPropriedades(
			this.app,
			() => this.dados.propriedades,
			async (revelado) => {
				this.dados.propriedades.revelado = revelado;
				// salvarDados direto, não `salvar()`: alternar o olhinho não precisa regerar CSS
				// nenhum (quem esconde é a classe do body), e regerar a cada clique faria o
				// navegador recalcular o estilo do vault inteiro à toa.
				await salvarDados(this, this.dados);
			},
		);

		const varrer = (): void => this.botaoPropriedades.varrer();
		this.app.workspace.onLayoutReady(() => {
			this.atualizarPropriedades();
		});
		this.registerEvent(this.app.workspace.on("layout-change", varrer));
		this.registerEvent(this.app.workspace.on("active-leaf-change", varrer));
		this.registerEvent(this.app.workspace.on("file-open", varrer));
	}

	/**
	 * Reaplica tudo de propriedades a partir do estado atual: o CSS, a classe do body e os
	 * olhinhos. É o que o painel de configurações chama a cada mudança.
	 */
	atualizarPropriedades(): void {
		this.estilosPropriedades?.aplicar(gerarCssPropriedades(this.dados.propriedades));
		this.botaoPropriedades?.sincronizarBody();
		this.botaoPropriedades?.varrer();
	}

	// ── Abas nas Bases ───────────────────────────────────────────────────────────────────────

	/** As abas estão disponíveis? Precisa de Bases no Obsidian E do toggle ligado. */
	private abasDisponiveis(): boolean {
		return requireApiVersion(VERSAO_MINIMA_BASES) && this.dados.abas.ativo;
	}

	/**
	 * Liga a funcionalidade de abas. Tudo dentro de try/catch e atrás de `onLayoutReady`: esta é a
	 * parte do plugin que mexe no DOM interno das Bases, e uma exceção aqui não pode derrubar a
	 * paleta de cores nem os callouts, que são independentes dela.
	 */
	private iniciarAbas(): void {
		if (this.gerenciadorAbas || !this.abasDisponiveis()) return;

		try {
			this.gerenciadorAbas = new GerenciadorDeAbas(
				this.app,
				() => this.dados.abas,
				(caminhoBase, nomeView) => this.abrirEscolhaDeIconeDaView(caminhoBase, nomeView),
				(caminhoBase, nomeView, modo) => this.definirModoDaView(caminhoBase, nomeView, modo),
			);

			// Espera o layout estar pronto para não brigar com o boot do Obsidian.
			this.app.workspace.onLayoutReady(() => this.gerenciadorAbas?.iniciar());

			// Reescaneia em mudanças de layout/aba ativa (bases que abrem depois, splits, etc.).
			this.registerEvent(
				this.app.workspace.on("layout-change", () => this.gerenciadorAbas?.reescanear()),
			);
			this.registerEvent(
				this.app.workspace.on("active-leaf-change", () => this.gerenciadorAbas?.reescanear()),
			);
		} catch (e) {
			console.warn("[customize] falha ao iniciar as abas das Bases:", e);
			this.gerenciadorAbas = null;
		}
	}

	private pararAbas(): void {
		this.gerenciadorAbas?.destruir();
		this.gerenciadorAbas = null;
	}

	/**
	 * Registra o bloco ```base-tabs (embed de Base com views escolhidas).
	 *
	 * Fora do `iniciarAbas()` de propósito: `registerMarkdownCodeBlockProcessor` só pode ser
	 * chamado durante o `onload`, então o registro é sempre feito e quem decide é o processador,
	 * consultando `abasDisponiveis()` a cada render. Assim o toggle vale na hora, sem recarregar.
	 *
	 * O nome do bloco continua `base-tabs` (não virou `customize-...`): renomear quebraria as notas
	 * que ela já escreveu com esse bloco, e o ganho seria só cosmético.
	 */
	private registrarBlocoDeBase(): void {
		if (!requireApiVersion(VERSAO_MINIMA_BASES)) return;

		const processador = new ProcessadorBaseTabs(
			this.app,
			() => this.dados.abas,
			(caminhoBase, nomeView) => this.abrirEscolhaDeIconeDaView(caminhoBase, nomeView),
			(caminhoBase, nomeView, modo) => this.definirModoDaView(caminhoBase, nomeView, modo),
			(ouvinte) => this.registrarOuvinteReescan(ouvinte),
		);

		this.registerMarkdownCodeBlockProcessor(LINGUAGEM_BLOCO, (src, el, ctx) => {
			try {
				processador.processar(src, el, ctx);
			} catch (e) {
				console.warn("[customize] falha ao processar o bloco base-tabs:", e);
			}
		});
	}

	/**
	 * Liga/desliga as abas sem recarregar o plugin. Chamado pelo toggle do painel.
	 *
	 * O bloco de código continua registrado nos dois casos (o Obsidian não permite desregistrar um
	 * processador de bloco), mas ele consulta `abasDisponiveis()` a cada render — com o toggle
	 * desligado, um bloco existente cai no embed nativo em vez de sumir da nota.
	 */
	alternarAbas(): void {
		if (this.dados.abas.ativo) this.iniciarAbas();
		else this.pararAbas();
		this.reescanearAbas();
	}

	/** Registra um ouvinte de re-render e devolve a função para removê-lo. */
	registrarOuvinteReescan(ouvinte: () => void): () => void {
		this.ouvintesReescan.add(ouvinte);
		return () => this.ouvintesReescan.delete(ouvinte);
	}

	/** Força re-render de tudo: base aberta como arquivo + embeds curados. */
	reescanearAbas(): void {
		this.gerenciadorAbas?.reescanear();
		this.ouvintesReescan.forEach((f) => f());
	}

	/** Abre o modal de ícone e persiste a escolha para (caminhoBase, nomeView). */
	private abrirEscolhaDeIconeDaView(caminhoBase: string | null, nomeView: string): void {
		const chave = chaveDaView(caminhoBase, nomeView);
		const atual = iconeDaView(this.dados.abas, caminhoBase, nomeView);
		new ModalEscolherIcone(this.app, nomeView, atual, async (novo) => {
			if (novo) this.dados.abas.iconesPorView[chave] = novo;
			else delete this.dados.abas.iconesPorView[chave];
			await this.salvar();
			this.reescanearAbas();
		}).open();
	}

	/** Define o modo de exibição da aba (ícone+nome / só ícone / só nome) e persiste. */
	private async definirModoDaView(
		caminhoBase: string | null,
		nomeView: string,
		modo: ModoExibicao,
	): Promise<void> {
		const chave = chaveDaView(caminhoBase, nomeView);
		if (modo === "ambos") delete this.dados.abas.exibicaoPorView[chave]; // padrão: não precisa guardar.
		else this.dados.abas.exibicaoPorView[chave] = modo;
		await this.salvar();
		this.reescanearAbas();
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
