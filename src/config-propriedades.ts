import { Setting, setIcon } from "obsidian";
import type CustomizePlugin from "./main";
import { normalizarChave } from "./propriedades";

/**
 * A seção "Propriedades da nota" do painel.
 *
 * Em módulo próprio pelo mesmo motivo de `config-callouts.ts` e `config-abas.ts`: é UI demais
 * para caber no `painel-config.ts` sem afogá-lo.
 *
 * ## A decisão que define esta tela: escolher da lista, não digitar
 *
 * Cadastrar "Criado" quando o frontmatter diz `created` produz um silêncio — nada some, e não há
 * como ela saber por quê. Por isso a lista de propriedades **existentes no vault** é oferecida
 * com um clique para ocultar, e o campo de digitar fica como saída para o caso raro (uma
 * propriedade que ela ainda vai criar). Os nomes vêm do próprio índice do Obsidian, então batem
 * com o `data-property-key` por construção.
 */

/** Quantas propriedades do vault listar de uma vez. Acima disso, a lista vira rolagem infinita. */
const MAX_SUGESTOES = 40;

/**
 * `app.metadataTypeManager` não está nas typings públicas. Só o usamos para SUGERIR nomes — se a
 * API interna sumir, caímos na varredura do cache de metadados, e no pior caso a lista vem vazia
 * e ela digita o nome à mão. Nada quebra.
 */
interface AppComTipos {
	metadataTypeManager?: {
		properties?: Record<string, { name?: string }>;
	};
}

export class SecaoPropriedades {
	constructor(
		private plugin: CustomizePlugin,
		private redesenhar: () => void,
	) {}

	private get dados() {
		return this.plugin.dados.propriedades;
	}

	private async salvar(): Promise<void> {
		await this.plugin.salvar();
		this.plugin.atualizarPropriedades();
	}

	render(containerEl: HTMLElement): void {
		this.blocoToggle(containerEl);

		// Desligada, a lista e as colunas descrevem algo que não está acontecendo.
		if (!this.dados.ativo) return;

		this.blocoOcultas(containerEl);
		this.blocoColunas(containerEl);
	}

	private blocoToggle(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Personalizar as propriedades")
			.setDesc(
				"Esconde as propriedades que você escolher atrás de um botão no topo da nota, e " +
					"pode distribuir o resto em duas colunas.",
			)
			.addToggle((t) =>
				t.setValue(this.dados.ativo).onChange(async (v) => {
					this.dados.ativo = v;
					await this.salvar();
					this.redesenhar();
				}),
			);
	}

	// ── Propriedades ocultas ─────────────────────────────────────────────────────────────────

	private blocoOcultas(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Propriedades ocultas").setHeading();

		containerEl.createEl("p", {
			cls: "customize-config-nota",
			text:
				"Estas não aparecem no topo da nota. O olhinho na barra da aba (ao lado do ícone de " +
				"leitura) mostra todas quando você precisar — e continua mostrando até você clicar de novo.",
		});

		this.listaOcultas(containerEl);
		this.listaSugestoes(containerEl);
		this.campoManual(containerEl);
	}

	private listaOcultas(containerEl: HTMLElement): void {
		const ocultas = this.dados.ocultas;

		if (ocultas.length === 0) {
			// Estado vazio (não "nota"): convite a agir, some no primeiro cadastro.
			containerEl.createEl("p", {
				cls: "customize-config-vazio",
				text: "Nenhuma propriedade oculta ainda. Escolha abaixo as que você não quer ver.",
			});
			return;
		}

		const lista = containerEl.createDiv({ cls: "customize-props-lista" });
		ocultas.forEach((chave, i) => {
			const linha = lista.createDiv({ cls: "customize-props-item" });
			linha.createSpan({ cls: "customize-props-nome", text: chave });

			const remover = linha.createEl("button", { cls: "clickable-icon" });
			remover.type = "button";
			remover.setAttribute("aria-label", `Voltar a mostrar "${chave}"`);
			setIcon(remover, "x");
			remover.addEventListener("click", async () => {
				this.dados.ocultas.splice(i, 1);
				await this.salvar();
				this.redesenhar();
			});
		});
	}

	/** As propriedades que existem no vault, com um clique para ocultar. */
	private listaSugestoes(containerEl: HTMLElement): void {
		const disponiveis = this.propriedadesDoVault().filter(
			(chave) => !this.dados.ocultas.includes(chave),
		);

		if (disponiveis.length === 0) return;

		new Setting(containerEl)
			.setName("Propriedades do seu vault")
			.setDesc("Clique numa para escondê-la.")
			.setClass("customize-props-sugestoes-titulo");

		const grade = containerEl.createDiv({ cls: "customize-props-sugestoes" });
		disponiveis.slice(0, MAX_SUGESTOES).forEach((chave) => {
			const botao = grade.createEl("button", { cls: "customize-props-chip", text: chave });
			botao.type = "button";
			botao.addEventListener("click", async () => {
				await this.ocultar(chave);
			});
		});

		if (disponiveis.length > MAX_SUGESTOES) {
			grade.createSpan({
				cls: "customize-config-vazio",
				text: `…e mais ${disponiveis.length - MAX_SUGESTOES}. Use o campo abaixo para as que não aparecem aqui.`,
			});
		}
	}

	/** Saída para propriedade que ainda não existe em nota nenhuma. */
	private campoManual(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Adicionar pelo nome")
			.setDesc(
				"Para uma propriedade que você ainda vai criar. Escreva exatamente como aparece no " +
					"frontmatter (maiúsculas não importam).",
			)
			.addText((t) => {
				t.setPlaceholder("ex.: created");
				const confirmar = async (): Promise<void> => {
					if (await this.ocultar(t.getValue())) t.setValue("");
				};
				t.inputEl.addEventListener("keydown", (ev) => {
					if (ev.key !== "Enter") return;
					ev.preventDefault();
					void confirmar();
				});
				// O blur cobre quem digita e clica fora em vez de apertar Enter.
				t.inputEl.addEventListener("blur", () => void confirmar());
			});
	}

	/** Normaliza, recusa duplicata e persiste. Devolve se de fato entrou. */
	private async ocultar(bruta: string): Promise<boolean> {
		const chave = normalizarChave(bruta);
		if (chave.length === 0 || this.dados.ocultas.includes(chave)) return false;
		this.dados.ocultas.push(chave);
		await this.salvar();
		this.redesenhar();
		return true;
	}

	/**
	 * Os nomes de propriedade conhecidos do vault, em minúsculas e ordenados.
	 *
	 * Duas fontes, nesta ordem: o registro de tipos do Obsidian (que conhece até as propriedades
	 * declaradas mas não usadas) e, se ele não existir, o cache de metadados dos arquivos. A
	 * segunda é a rede de segurança para o caso de a API interna mudar de nome.
	 */
	private propriedadesDoVault(): string[] {
		const encontradas = new Set<string>();

		const registro = (this.plugin.app as unknown as AppComTipos).metadataTypeManager?.properties;
		if (registro) {
			Object.values(registro).forEach((p) => {
				const nome = normalizarChave(p?.name ?? "");
				if (nome) encontradas.add(nome);
			});
		}

		if (encontradas.size === 0) {
			this.plugin.app.vault.getMarkdownFiles().forEach((arquivo) => {
				const fm = this.plugin.app.metadataCache.getFileCache(arquivo)?.frontmatter;
				if (!fm) return;
				Object.keys(fm).forEach((chave) => {
					const nome = normalizarChave(chave);
					// `position` é ruído do parser do Obsidian, não uma propriedade dela.
					if (nome && nome !== "position") encontradas.add(nome);
				});
			});
		}

		return [...encontradas].sort((a, b) => a.localeCompare(b));
	}

	// ── Duas colunas ─────────────────────────────────────────────────────────────────────────

	private blocoColunas(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Layout").setHeading();

		new Setting(containerEl)
			.setName("Duas colunas")
			.setDesc(
				"Distribui as propriedades em duas colunas quando a nota tem largura para isso. " +
					"Em tela estreita ou num painel lateral, volta para uma coluna sozinho.",
			)
			.addToggle((t) =>
				t.setValue(this.dados.duasColunas).onChange(async (v) => {
					this.dados.duasColunas = v;
					await this.salvar();
					this.redesenhar();
				}),
			);

		if (!this.dados.duasColunas) return;

		new Setting(containerEl)
			.setName("Largura mínima para dividir")
			.setDesc(
				"Abaixo desta largura da nota, as propriedades voltam a uma coluna. Aumente se os " +
					"valores estiverem ficando espremidos.",
			)
			.addSlider((s) =>
				s
					.setLimits(320, 900, 20)
					.setValue(this.dados.larguraMinimaColunas)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.dados.larguraMinimaColunas = v;
						await this.salvar();
					}),
			);
	}
}
