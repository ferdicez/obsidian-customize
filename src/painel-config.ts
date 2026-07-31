import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import { SecaoCallouts } from "./config-callouts";
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
	/** Evita repetir a checagem de disco (e o redesenho) a cada `display()`. */
	private checouCalloutManager = false;

	constructor(app: App, private plugin: CustomizePlugin) {
		super(app, plugin);
		this.secaoCallouts = new SecaoCallouts(plugin, () => this.display());
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Customize" });

		new Setting(containerEl).setHeading().setName("Paleta de cores");
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Um atalho de teclado abre a paleta com os códigos à mostra. Clicar numa cor copia o " +
				"código e a paleta continua aberta, para copiar várias em sequência.",
		});

		this.secaoAtalho(containerEl);
		this.secaoPaletas(containerEl);
		this.secaoSeletorNativo(containerEl);
		this.secaoAvancado(containerEl);
		this.secaoCallouts.render(containerEl);

		// A checagem de "o Callout Manager está instalado?" toca o disco. Fazemos fora do
		// caminho de desenho e redesenhamos só se o resultado mudar algo — assim o render
		// continua síncrono e nunca escreve num container que já foi limpo.
		if (!this.checouCalloutManager) {
			this.checouCalloutManager = true;
			void this.secaoCallouts.preparar().then(() => this.display());
		}
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

	private secaoPaletas(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName("Paletas")
			.addButton((b) =>
				b
					.setButtonText("Nova paleta")
					.setCta()
					.onClick(async () => {
						const nova = criarPaleta(this.plugin.dados, "Nova paleta");
						this.editando = nova.id;
						await this.plugin.salvar();
						this.display();
					}),
			);

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
			editor.createDiv({ cls: "customize-vazio", text: "Nenhuma cor ainda. Adicione a primeira abaixo." });
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

	private secaoSeletorNativo(containerEl: HTMLElement): void {
		new Setting(containerEl).setHeading().setName("Seletor de cor do Obsidian");

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Opcional: além do atalho, substituir também o seletor de cor do próprio Obsidian " +
				"pela paleta. Afeta as configurações de aparência e as de outros plugins, então " +
				"vem desligado.",
		});

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

		new Setting(containerEl).setHeading().setName("Avançado");

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
}
