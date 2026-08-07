import { Setting, setIcon } from "obsidian";
import type CustomizePlugin from "./main";
import { ModalEscolherIcone } from "./modal-escolher-icone";

/**
 * A seção "Abas nas Bases" do painel — o antigo painel do plugin Base Tabs, absorvido na 0.5.0.
 *
 * Em módulo próprio pelo mesmo motivo de `config-callouts.ts`: é UI suficiente para não caber no
 * `painel-config.ts` sem afogá-lo. As classes CSS continuam com o prefixo `base-tabs-` — elas já
 * existem no `styles.css` e são as mesmas que o código das abas escreve no DOM das Bases;
 * renomear seria muita superfície de erro para ganho nenhum.
 */
export class SecaoAbas {
	constructor(
		private plugin: CustomizePlugin,
		private redesenhar: () => void,
	) {}

	render(containerEl: HTMLElement): void {
		this.blocoToggle(containerEl);

		// Com as abas desligadas, ícones e tutorial descrevem algo que não está acontecendo.
		if (!this.plugin.dados.abas.ativo) return;

		this.renderIcones(containerEl);
		this.renderTutorialEmbed(containerEl);
	}

	private blocoToggle(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Mostrar as views como abas")
			.setDesc(
				"Desligue se alguma Base ficar lenta ou travar — as Bases voltam ao menu suspenso do " +
					"Obsidian, e o resto do plugin (paleta e callouts) continua funcionando.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.dados.abas.ativo).onChange(async (v) => {
					this.plugin.dados.abas.ativo = v;
					await this.plugin.salvar();
					this.plugin.alternarAbas();
					this.redesenhar();
				}),
			);
	}

	/** Lista os ícones já atribuídos (view + caminho da base), com trocar/remover. */
	private renderIcones(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Ícones por view").setHeading();

		const entradas = Object.entries(this.plugin.dados.abas.iconesPorView);
		if (entradas.length === 0) {
			// Estado vazio (não "nota"): é um convite a agir e some assim que ela atribuir o
			// primeiro ícone. Daí a classe própria, em itálico/--text-faint.
			containerEl.createEl("p", {
				cls: "customize-config-vazio",
				text: "Nenhum ícone personalizado ainda. Abra uma Base e clique com o botão direito numa aba.",
			});
			return;
		}

		entradas
			.sort((a, b) => a[0].localeCompare(b[0]))
			.forEach(([chave, icone]) => {
				const [caminhoBase, nomeView] = chave.split("::");
				const setting = new Setting(containerEl).setName(nomeView).setDesc(caminhoBase);

				setting.settingEl.createDiv({ cls: "base-tabs-config-preview" }, (el) => setIcon(el, icone));

				setting.addButton((btn) =>
					btn.setButtonText("Trocar ícone").onClick(() => {
						new ModalEscolherIcone(this.plugin.app, nomeView, icone, async (novo) => {
							if (novo) this.plugin.dados.abas.iconesPorView[chave] = novo;
							else delete this.plugin.dados.abas.iconesPorView[chave];
							await this.plugin.salvar();
							this.plugin.reescanearAbas();
							this.redesenhar();
						}).open();
					}),
				);

				setting.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Remover ícone")
						.onClick(async () => {
							delete this.plugin.dados.abas.iconesPorView[chave];
							await this.plugin.salvar();
							this.plugin.reescanearAbas();
							this.redesenhar();
						}),
				);
			});
	}

	/** Tutorial de como embedar uma base mostrando só algumas views (bloco base-tabs). */
	private renderTutorialEmbed(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Embed com views escolhidas").setHeading();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text:
				"Para embedar uma base numa nota mostrando só algumas views (em vez de todas), use um " +
				"bloco de código base-tabs. Escreva o nome da base e as views que quer, separadas por vírgula:",
		});

		const exemplo = ["```base-tabs", "base: Nome Da Base", "views: Tabela, Kanban", "```"].join("\n");
		const bloco = containerEl.createEl("pre", { cls: "base-tabs-config-code" });
		bloco.createEl("code", { text: exemplo });

		const btnCopiar = containerEl.createEl("button", {
			text: "Copiar exemplo",
			cls: "base-tabs-tutorial-copy",
		});
		btnCopiar.addEventListener("click", async () => {
			await navigator.clipboard.writeText(exemplo);
			btnCopiar.setText("Copiado!");
			window.setTimeout(() => btnCopiar.setText("Copiar exemplo"), 1500);
		});

		const dicas = containerEl.createEl("ul", {
			cls: "setting-item-description base-tabs-tutorial-dicas",
		});
		dicas.createEl("li", {
			text: 'O nome da base é o do arquivo .base, sem a extensão (ex.: "Clientes" para Clientes.base). Pode incluir a pasta: "Projetos/Clientes".',
		});
		dicas.createEl("li", {
			text: "Os nomes das views precisam ser exatamente iguais aos da base (maiúsculas e acentos contam). Se um nome não bater, aquela aba simplesmente não aparece.",
		});
		dicas.createEl("li", {
			text: "A ordem das views no bloco é a ordem em que as abas aparecem.",
		});
		dicas.createEl("li", {
			text: "Para esconder a barra de abas (mostrar só o conteúdo da base, ex.: quando há uma view só), adicione a linha: abas: não",
		});
		dicas.createEl("li", {
			text: "Dica: para embedar mostrando TODAS as views, basta usar o embed normal do Obsidian: ![[Nome Da Base.base]].",
		});
	}
}
