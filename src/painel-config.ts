import { App, PluginSettingTab, Setting, requireApiVersion, setIcon } from "obsidian";
import { abrirAcordeao, criarAcordeao } from "./acordeao";
import { SecaoAbas } from "./config-abas";
import { SecaoCallouts } from "./config-callouts";
import { SecaoPropriedades } from "./config-propriedades";
import { normalizarHex, precisaBorda } from "./cores";
import { criarPaleta, moverCor, paletaAtiva, removerPaleta, type Paleta } from "./dados";
import { CLASSE_IGNORAR } from "./interceptador-de-cor";
import type CustomizePlugin from "./main";

/** Quantas cores aparecem na prévia de cada paleta na lista. */
const MAX_PREVIEW = 12;

/**
 * `app.setting` não está nas typings públicas do Obsidian. Só usamos para a conveniência de
 * pular direto para a aba de atalhos — tudo é opcional e chamado com `?.`, então se a API
 * interna mudar o botão simplesmente não faz nada, sem quebrar o painel.
 */
interface AbaHotkeys {
	searchInputEl?: { focus?: () => void };
	setQuery?: (q: string) => void;
}

interface AppComSettings {
	setting?: {
		openTabById?: (id: string) => void;
		activeTab?: unknown;
	};
}

export class PainelConfigCustomize extends PluginSettingTab {
	/** Paleta com o editor de cores aberto (null = nenhuma). Estado só de UI, não persiste. */
	private editando: string | null = null;
	private secaoCallouts: SecaoCallouts;
	private secaoAbas: SecaoAbas;
	private secaoPropriedades: SecaoPropriedades;
	/** Evita repetir a checagem de disco (e o redesenho) a cada `display()`. */
	private checouCalloutManager = false;

	constructor(app: App, private plugin: CustomizePlugin) {
		super(app, plugin);
		this.secaoCallouts = new SecaoCallouts(plugin, () => this.display());
		this.secaoAbas = new SecaoAbas(plugin, () => this.display());
		this.secaoPropriedades = new SecaoPropriedades(plugin, () => this.display());
	}

	display(): void {
		const { containerEl } = this;

		// Guarda e devolve o scroll. `display()` é chamado a cada mudança (trocar uma cor, mexer
		// num slider, abrir um editor) e recria o painel inteiro; sem isto, cada clique joga a
		// usuária de volta ao topo e ela precisa se reencontrar na lista.
		const rolagem = this.acharRolagem();
		const posicao = rolagem?.scrollTop ?? 0;

		containerEl.empty();

		// Escopo de todo o CSS do painel (regra 1 de `_docs/painel-de-configuracoes.md`). Sem ela
		// as regras de "linha em vez de cartão" vazariam para as configurações dos outros plugins.
		// Não há `h2` com o nome do plugin: o Obsidian já o mostra no cabeçalho da janela.
		containerEl.addClass("customize-config");

		// As duas primeiras seções nascem abertas: são o que ela mexe no dia a dia (qual paleta o
		// atalho abre, quais cores tem dentro). O resto é ajuste raro e nasce fechado, para o
		// painel caber numa tela em vez de exigir rolagem para se localizar.
		this.blocoAtalho(containerEl);
		this.blocoPaletas(containerEl);
		this.blocoSeletorNativo(containerEl);
		this.blocoCallouts(containerEl);
		this.blocoPropriedades(containerEl);
		this.blocoAbas(containerEl);

		// A checagem de "o Callout Manager está instalado?" toca o disco. Fazemos fora do
		// caminho de desenho e redesenhamos só se o resultado mudar algo — assim o render
		// continua síncrono e nunca escreve num container que já foi limpo.
		if (!this.checouCalloutManager) {
			this.checouCalloutManager = true;
			void this.secaoCallouts.preparar().then(() => this.display());
		}

		if (rolagem && posicao > 0) {
			// Depois do layout: o conteúdo acabou de ser recriado e a altura só é conhecida agora.
			// Sem o requestAnimationFrame o scrollTop é cortado para a altura antiga (menor).
			window.requestAnimationFrame(() => {
				rolagem.scrollTop = posicao;
			});
		}
	}

	/**
	 * O elemento que realmente rola. O Obsidian coloca o conteúdo das configurações dentro de um
	 * `.vertical-tab-content`, que é quem tem o overflow — `containerEl` em si não rola. Se essa
	 * estrutura mudar, caímos no próprio containerEl em vez de quebrar.
	 */
	private acharRolagem(): HTMLElement | null {
		const proprio = this.containerEl;
		if (proprio.scrollHeight > proprio.clientHeight) return proprio;
		return proprio.closest<HTMLElement>(".vertical-tab-content") ?? null;
	}

	/**
	 * "Como abrir a paleta": o atalho e qual paleta ele abre. É a pergunta que a usuária faz
	 * primeiro ao entrar no painel, então abre por padrão e vem antes da lista de paletas.
	 */
	private blocoAtalho(containerEl: HTMLElement): void {
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:atalho",
			titulo: "Paleta de cores",
			descricao:
				"Um atalho de teclado abre a paleta com os códigos à mostra. Clicar numa cor copia o " +
				"código e a paleta continua aberta, para copiar várias em sequência.",
			resumo: paletaAtiva(this.plugin.dados).nome,
			abertoPorPadrao: true,
		});

		acordeao.sePreenchido((corpo) => this.secaoAtalho(corpo));
	}

	private secaoAtalho(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Atalho de teclado")
			.setDesc(
				"O plugin não vem com um atalho definido, para não colidir com os do Obsidian. " +
					'Defina o seu em Configurações → Atalhos de teclado, procurando por "Customize".',
			)
			.addButton((b) =>
				b.setButtonText("Abrir atalhos de teclado").onClick(() => {
					// Navega direto para a aba de hotkeys já filtrada pelo comando do plugin.
					const settings = (this.app as unknown as AppComSettings).setting;
					settings?.openTabById?.("hotkeys");
					const aba = settings?.activeTab as AbaHotkeys | undefined;
					aba?.searchInputEl?.focus?.();
					if (aba?.setQuery) aba.setQuery("Customize");
				}),
			);

		new Setting(containerEl)
			.setName("Paleta ativa")
			.setDesc("A paleta que o atalho abre.")
			.addDropdown((d) => {
				this.plugin.dados.paletas.forEach((p) => d.addOption(p.id, p.nome));
				d.setValue(paletaAtiva(this.plugin.dados).id);
				d.onChange(async (id) => {
					this.plugin.dados.paletaAtivaId = id;
					await this.plugin.salvar();
					this.display();
				});
			});
	}

	/**
	 * A lista de paletas. Nasce aberta porque é onde ela edita cores — e porque o editor inline
	 * de uma paleta é desenhado aqui dentro: se a seção estivesse fechada, clicar em "Editar
	 * cores" abriria um editor invisível.
	 */
	private blocoPaletas(containerEl: HTMLElement): void {
		const total = this.plugin.dados.paletas.length;
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:paletas",
			titulo: "Paletas",
			resumo: `${total} ${total === 1 ? "paleta" : "paletas"}`,
			abertoPorPadrao: true,
		});

		// O botão de criar vive no cabeçalho: dentro de `-acoes`, que o acordeão trata como zona
		// morta de clique, para criar uma paleta não fechar a seção onde ela vai aparecer.
		const acoes = acordeao.cabecalho.createDiv({ cls: "customize-acordeao-acoes" });
		new Setting(acoes).addButton((b) =>
			b
				.setButtonText("Nova paleta")
				.setCta()
				.onClick(async () => {
					const nova = criarPaleta(this.plugin.dados, "Nova paleta");
					this.editando = nova.id;
					// A paleta nova nasce com o editor aberto; a seção precisa estar aberta junto,
					// senão o botão parece não ter feito nada.
					abrirAcordeao("customize:paletas");
					await this.plugin.salvar();
					this.display();
				}),
		);

		acordeao.sePreenchido((corpo) => this.secaoPaletas(corpo));
	}

	private secaoPaletas(containerEl: HTMLElement): void {
		this.plugin.dados.paletas.forEach((paleta) => {
			const ativa = paleta.id === paletaAtiva(this.plugin.dados).id;
			const setting = new Setting(containerEl)
				.setName(paleta.nome + (ativa ? " (ativa)" : ""))
				.setDesc(`${paleta.cores.length} ${paleta.cores.length === 1 ? "cor" : "cores"}`);

			this.previewDaPaleta(setting.settingEl, paleta);

			setting.addText((t) =>
				t
					.setPlaceholder("Nome da paleta")
					.setValue(paleta.nome)
					.onChange(async (v) => {
						// O id é estável, então renomear não desassocia a paleta ativa.
						paleta.nome = v.trim() || "Sem nome";
						await this.plugin.salvar();
					}),
			);

			setting.addButton((b) =>
				b
					.setButtonText(this.editando === paleta.id ? "Fechar" : "Editar cores")
					.onClick(() => {
						this.editando = this.editando === paleta.id ? null : paleta.id;
						this.display();
					}),
			);

			setting.addExtraButton((b) => {
				const ultima = this.plugin.dados.paletas.length <= 1;
				b.setIcon("trash")
					.setTooltip(ultima ? "Não dá para remover a última paleta" : "Remover paleta")
					.setDisabled(ultima)
					.onClick(async () => {
						if (!removerPaleta(this.plugin.dados, paleta.id)) return;
						if (this.editando === paleta.id) this.editando = null;
						await this.plugin.salvar();
						this.display();
					});
			});

			if (this.editando === paleta.id) this.editorDeCores(containerEl, paleta);
		});
	}

	private previewDaPaleta(settingEl: HTMLElement, paleta: Paleta): void {
		if (paleta.cores.length === 0) return;
		const preview = settingEl.createDiv({ cls: "customize-config-preview" });
		paleta.cores.slice(0, MAX_PREVIEW).forEach((cor) => {
			const hex = normalizarHex(cor);
			if (!hex) return;
			const mini = preview.createDiv({ cls: "customize-config-mini" });
			mini.style.setProperty("--customize-cor", hex);
			mini.setAttribute("aria-label", hex);
		});
	}

	private editorDeCores(containerEl: HTMLElement, paleta: Paleta): void {
		// CLASSE_IGNORAR: sem isto, o seletor de cor daqui embaixo seria interceptado pelo próprio
		// plugin (popover abrindo sobre popover). Para DEFINIR uma cor da paleta, o seletor do
		// sistema é justamente o comportamento certo.
		const editor = containerEl.createDiv({ cls: `customize-editor-cores ${CLASSE_IGNORAR}` });

		if (paleta.cores.length === 0) {
			editor.createDiv({
				cls: "customize-config-vazio",
				text: "Nenhuma cor ainda. Adicione a primeira abaixo.",
			});
		}

		paleta.cores.forEach((cor, i) => {
			const hex = normalizarHex(cor) ?? cor;
			const linha = editor.createDiv({ cls: "customize-linha-cor" });

			const amostra = linha.createDiv({ cls: "customize-config-mini" });
			amostra.style.setProperty("--customize-cor", hex);
			if (precisaBorda(hex)) amostra.addClass("is-clara");

			linha.createSpan({ cls: "customize-linha-cor-hex", text: hex });

			this.botaoIcone(linha, "chevron-up", "Subir", i === 0, async () => {
				moverCor(paleta, i, -1);
				await this.plugin.salvar();
				this.display();
			});

			this.botaoIcone(linha, "chevron-down", "Descer", i === paleta.cores.length - 1, async () => {
				moverCor(paleta, i, 1);
				await this.plugin.salvar();
				this.display();
			});

			this.botaoIcone(linha, "x", "Remover cor", false, async () => {
				paleta.cores.splice(i, 1);
				await this.plugin.salvar();
				this.display();
			});
		});

		this.linhaAdicionar(editor, paleta);
	}

	private linhaAdicionar(editor: HTMLElement, paleta: Paleta): void {
		const linha = editor.createDiv({ cls: "customize-adicionar-cor" });
		let escolhida = "#4263eb";

		const seletor = linha.createEl("input");
		seletor.type = "color";
		seletor.value = escolhida;
		seletor.addEventListener("input", () => {
			escolhida = seletor.value;
			campo.value = seletor.value;
		});

		const campo = linha.createEl("input");
		campo.type = "text";
		campo.placeholder = "#4263eb";
		campo.value = escolhida;
		campo.addEventListener("input", () => {
			const hex = normalizarHex(campo.value);
			if (hex) {
				escolhida = hex;
				seletor.value = hex;
			}
		});

		const adicionar = async (): Promise<void> => {
			const hex = normalizarHex(campo.value) ?? normalizarHex(escolhida);
			if (!hex) return;
			paleta.cores.push(hex);
			await this.plugin.salvar();
			this.display();
		};

		campo.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter") return;
			ev.preventDefault();
			void adicionar();
		});

		const botao = linha.createEl("button", { text: "Adicionar" });
		botao.type = "button";
		botao.addEventListener("click", () => void adicionar());
	}

	private botaoIcone(
		pai: HTMLElement,
		icone: string,
		titulo: string,
		desabilitado: boolean,
		aoClicar: () => void | Promise<void>,
	): void {
		const botao = pai.createEl("button", { cls: "clickable-icon" });
		botao.type = "button";
		botao.setAttribute("aria-label", titulo);
		botao.disabled = desabilitado;
		setIcon(botao, icone);
		botao.addEventListener("click", () => void aoClicar());
	}

	/**
	 * Substituição do seletor nativo, com "Avançado" junto: as exceções só existem quando a
	 * substituição está ligada, então separá-las em duas seções irmãs deixaria uma delas
	 * aparecendo e sumindo sozinha na lista. Fechada por padrão — é um ajuste de uma vez só.
	 */
	private blocoSeletorNativo(containerEl: HTMLElement): void {
		const ligado = this.plugin.dados.interceptacaoAtiva;
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:seletor-nativo",
			titulo: "Seletor de cor do Obsidian",
			descricao:
				"Opcional: além do atalho, substituir também o seletor de cor do próprio Obsidian " +
				"pela paleta. Afeta as configurações de aparência e as de outros plugins, então " +
				"vem desligado.",
			resumo: ligado ? "Substituindo" : "Desligado",
		});

		acordeao.sePreenchido((corpo) => {
			this.secaoSeletorNativo(corpo);
			this.secaoAvancado(corpo);
		});
	}

	private secaoSeletorNativo(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Substituir o seletor de cor nativo")
			.setDesc("Desligue se algum seletor parar de funcionar — as cores voltam ao seletor do sistema.")
			.addToggle((t) =>
				t.setValue(this.plugin.dados.interceptacaoAtiva).onChange(async (v) => {
					this.plugin.dados.interceptacaoAtiva = v;
					await this.plugin.salvar();
					this.display();
				}),
			);

		if (!this.plugin.dados.interceptacaoAtiva) return;

		new Setting(containerEl)
			.setName("Botão de cor personalizada")
			.setDesc("Mostra, no rodapé do popover, um botão que abre o seletor do sistema para escolher qualquer cor.")
			.addToggle((t) =>
				t.setValue(this.plugin.dados.permitirCorPersonalizada).onChange(async (v) => {
					this.plugin.dados.permitirCorPersonalizada = v;
					await this.plugin.salvar();
				}),
			);
	}

	private secaoAvancado(containerEl: HTMLElement): void {
		// Só faz sentido com a substituição ligada — é o único caminho que intercepta seletores.
		if (!this.plugin.dados.interceptacaoAtiva) return;

		// Aninhado: é exceção da substituição, não um assunto irmão dela.
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:avancado",
			titulo: "Avançado",
			aninhado: true,
			resumo: this.resumoExcecoes(),
		});

		acordeao.sePreenchido((corpo) => this.secaoExcecoes(corpo));
	}

	private resumoExcecoes(): string | undefined {
		const total = this.plugin.dados.seletoresIgnorados.length;
		if (total === 0) return undefined;
		return `${total} ${total === 1 ? "exceção" : "exceções"}`;
	}

	private secaoExcecoes(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Não substituir nestes lugares")
			.setDesc(
				"Um seletor CSS por linha. Se algum plugin depender do seletor de cor do sistema, " +
					"coloque aqui um seletor de um elemento que o contenha (ex.: .modal.mod-exemplo).",
			)
			.addTextArea((t) => {
				t.setPlaceholder(".modal.mod-exemplo")
					.setValue(this.plugin.dados.seletoresIgnorados.join("\n"))
					.onChange(async (v) => {
						this.plugin.dados.seletoresIgnorados = v
							.split("\n")
							.map((s) => s.trim())
							.filter((s) => s.length > 0);
						await this.plugin.salvar();
					});
				t.inputEl.rows = 4;
			});
	}

	/**
	 * Callouts é a maior seção do painel (estilo global, estilo Padrão, lista de estilos
	 * nomeados, importação), e nada tem a ver com paleta de cores — por isso acordeão próprio,
	 * fechado por padrão. Fechado ela também não paga o custo das prévias vivas, que redesenham
	 * um callout de verdade a cada mudança de slider.
	 */
	private blocoCallouts(containerEl: HTMLElement): void {
		const total = this.plugin.dados.callouts.personalizados.length;
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:callouts",
			titulo: "Callouts",
			descricao:
				"Muda a aparência dos callouts (aquelas caixas coloridas com > [!nota]). O estilo " +
				"global vale para todos; dentro dá para ajustar tipos específicos.",
			resumo: this.plugin.dados.callouts.ativo
				? `${total} ${total === 1 ? "estilo" : "estilos"}`
				: "Desligado",
		});

		acordeao.sePreenchido((corpo) => this.secaoCallouts.render(corpo));
	}

	/**
	 * Propriedades da nota. Acordeão próprio e fechado por padrão: depois de escolher o que
	 * esconder, ela quase não volta aqui — o uso do dia a dia é o olhinho na própria nota.
	 */
	private blocoPropriedades(containerEl: HTMLElement): void {
		const dados = this.plugin.dados.propriedades;
		const total = dados.ocultas.length;
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:propriedades",
			titulo: "Propriedades da nota",
			descricao:
				"Esconde as propriedades que só ocupam espaço no topo da nota, atrás de um olhinho " +
				"que mostra todas quando você precisar. Também distribui as propriedades em duas colunas.",
			resumo: dados.ativo
				? `${total} ${total === 1 ? "oculta" : "ocultas"}`
				: "Desligado",
		});

		acordeao.sePreenchido((corpo) => this.secaoPropriedades.render(corpo));
	}

	/**
	 * Abas nas Bases — a funcionalidade que veio do plugin Base Tabs na 0.5.0. Acordeão próprio e
	 * fechado por padrão: depois de escolher os ícones, ela quase não volta aqui.
	 *
	 * A seção inteira some em Obsidian sem Bases (< 1.10.0), porque ali não há o que configurar —
	 * é o mesmo motivo de o `minAppVersion` do plugin não ter subido para 1.10.0.
	 */
	private blocoAbas(containerEl: HTMLElement): void {
		if (!requireApiVersion("1.10.0")) return;

		const total = Object.keys(this.plugin.dados.abas.iconesPorView).length;
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:abas",
			titulo: "Abas nas Bases",
			descricao:
				"Mostra as views de uma Base como abas lado a lado com ícones, no lugar do menu " +
				"suspenso. Clique com o botão direito numa aba para escolher o ícone e o modo de " +
				"exibição (ícone e nome / só ícone / só nome).",
			resumo: this.plugin.dados.abas.ativo
				? `${total} ${total === 1 ? "ícone" : "ícones"}`
				: "Desligado",
		});

		acordeao.sePreenchido((corpo) => this.secaoAbas.render(corpo));
	}
}
