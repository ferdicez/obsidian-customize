import { Notice, Setting, setIcon } from "obsidian";
import { abrirAcordeao, criarAcordeao } from "./acordeao";
import {
	resolverEstilo,
	TIPOS_EMBUTIDOS,
	type AlinhamentoTitulo,
	type CalloutPersonalizado,
	type EstiloCallout,
} from "./callouts";
import { normalizarHex } from "./cores";
import { importarDoCalloutManager, temCalloutManager } from "./importar-callout-manager";
import { CLASSE_IGNORAR } from "./interceptador-de-cor";
import type CustomizePlugin from "./main";
import { ModalEscolherIcone } from "./modal-escolher-icone";
import { PreviaCallout } from "./previa-callout";

/**
 * A seção "Callouts" do painel de configurações. Fica em módulo próprio porque tem bastante
 * UI — o `painel-config.ts` cuida da paleta e chama isto.
 *
 * Estrutura: um estilo GLOBAL que vale para todos os callouts, e uma lista de tipos com
 * ajustes próprios. Nos controles por tipo, "Padrão" significa herdar do global — por isso
 * os campos são opcionais (`undefined`) em vez de terem um valor default.
 */

/** Limites do slider de tamanho de ícone. 18px é o que o Obsidian usa nos callouts. */
const TAMANHO_ICONE = { min: 10, max: 48, padrao: 18 };

/** Chave do acordeão dos estilos nomeados — usada também ao criar um estilo, para abri-lo. */
const CHAVE_NOMEADOS = "customize:callouts:nomeados";

const ALINHAMENTOS: Array<{ valor: AlinhamentoTitulo; rotulo: string }> = [
	{ valor: "esquerda", rotulo: "Esquerda" },
	{ valor: "centro", rotulo: "Centro" },
	{ valor: "direita", rotulo: "Direita" },
];

/** Um controle de "herda ou define" para valores numéricos. */
interface OpcoesNumero {
	nome: string;
	desc: string;
	min: number;
	max: number;
	passo: number;
	sufixo?: string;
	/** Texto do estado "não definido" (só usado nos ajustes por tipo). */
	rotuloPadrao?: string;
}

export class SecaoCallouts {
	/**
	 * Prévias vivas no painel. Repovoada a cada `render()`; `atualizarPrevias()` redesenha
	 * todas sem reconstruir o painel — é o que permite ver o efeito enquanto o slider anda,
	 * já que um `display()` completo faria o controle perder o foco no meio do arraste.
	 */
	private previas: Array<() => void> = [];

	/** Tipo com o editor aberto (null = nenhum). Estado só de UI, não persiste. */
	private editando: string | null = null;
	/**
	 * Se o Callout Manager está instalado. Checado uma vez no `preparar()` para o `render()`
	 * poder ser síncrono — desenhar depois de um await correria o risco de escrever num
	 * container que outro `display()` já limpou.
	 */
	private calloutManagerPresente = false;

	constructor(private plugin: CustomizePlugin, private redesenhar: () => void) {}

	private get dados() {
		return this.plugin.dados.callouts;
	}

	/** Faz a checagem de disco uma vez, antes do primeiro render. */
	async preparar(): Promise<void> {
		this.calloutManagerPresente = await temCalloutManager(this.plugin.app);
	}

	/** Salva e redesenha as prévias — o que todo controle desta seção deve chamar. */
	private async salvar(): Promise<void> {
		await this.plugin.salvar();
		this.atualizarPrevias();
	}

	private atualizarPrevias(): void {
		for (const atualizar of this.previas) atualizar();
	}

	/** Cria uma prévia e registra sua função de atualização. */
	private criarPrevia(
		pai: HTMLElement,
		estado: () => { estilo: EstiloCallout; cor?: string; icone?: string },
	): void {
		const previa = new PreviaCallout(pai);
		const atualizar = (): void => {
			const { estilo, cor, icone } = estado();
			previa.atualizar(estilo, cor, icone);
		};
		atualizar();
		this.previas.push(atualizar);
	}

	/**
	 * Desenhada DENTRO do acordeão "Callouts" do painel — o título e a explicação de abertura
	 * vivem no cabeçalho dele, não aqui, para não aparecerem duas vezes.
	 *
	 * As sub-seções são acordeões aninhados porque são quatro assuntos independentes (nome
	 * livre, estilo Padrão, estilo de todos, estilos nomeados) e empilhados eles somam mais de
	 * uma tela de rolagem — que é justamente o que a usuária pediu para resolver.
	 */
	render(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName("Personalizar callouts")
			.setDesc("Desligue para voltar à aparência padrão do Obsidian, sem perder as configurações.")
			.addToggle((t) =>
				t.setValue(this.dados.ativo).onChange(async (v) => {
					this.dados.ativo = v;
					await this.salvar();
					this.redesenhar();
				}),
			);

		if (!this.dados.ativo) return;

		// Repovoada do zero: o painel inteiro foi reconstruído, as prévias antigas morreram
		// com ele. Sem isto, `atualizarPrevias()` mexeria em elementos fora do DOM.
		this.previas = [];

		this.subSecao(containerEl, "titulo-livre", "Nome livre no callout", (corpo) =>
			this.tituloLivre(corpo),
		);
		this.subSecao(containerEl, "coringa", "Estilo Padrão", (corpo) => this.estiloCoringa(corpo));
		this.subSecao(containerEl, "global", "Estilo de todos os callouts", (corpo) =>
			this.estiloGlobal(corpo),
		);
		this.listaDeTipos(containerEl);
		this.importacao(containerEl);
	}

	/** Um acordeão aninhado das sub-seções de callout, para não repetir as opções em cada uma. */
	private subSecao(
		containerEl: HTMLElement,
		chave: string,
		titulo: string,
		desenhar: (corpo: HTMLElement) => void,
	): void {
		const acordeao = criarAcordeao(containerEl, {
			chave: `customize:callouts:${chave}`,
			titulo,
			aninhado: true,
		});
		acordeao.sePreenchido(desenhar);
	}

	// ── Título livre e estilo "Padrão" ─────────────────────────────────────────────────────

	private tituloLivre(containerEl: HTMLElement): void {
		const exemplo = containerEl.createDiv({ cls: "customize-explicacao" });
		exemplo.createEl("p", {
			text:
				"Escreva o estilo primeiro e o nome que você quer depois da barra. O nome aparece " +
				"no callout; o estilo define a cor e o ícone.",
		});
		exemplo.createEl("code", { text: "> [!demandas|Reunião com cliente]" });
		exemplo.createEl("p", {
			cls: "setting-item-description",
			text:
				"Se você escrever um título depois do colchete, ele vence a barra — " +
				"igual ao comportamento normal do Obsidian.",
		});

		new Setting(containerEl)
			.setName("Usar o texto depois da barra como título")
			.setDesc("Sem isto, o Obsidian mostra o nome do estilo capitalizado (\"Demandas\").")
			.addToggle((t) =>
				t.setValue(this.dados.tituloPeloMetadata).onChange(async (v) => {
					this.dados.tituloPeloMetadata = v;
					await this.salvar();
				}),
			);
	}

	private estiloCoringa(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			cls: "customize-config-nota",
			text:
				"Vale para qualquer nome que você inventar e que não tenha estilo próprio — " +
				"inclusive um callout escrito direto, como > [!Anotação rápida]. Sem isto, o " +
				"Obsidian usa azul com ícone de lápis.",
		});

		const c = this.dados.coringa;

		this.criarPrevia(containerEl, () => ({
			estilo: resolverEstilo(this.dados.global, c.estilo),
			cor: c.cor,
			icone: c.icone,
		}));

		// CLASSE_IGNORAR: o seletor de cor aqui é para DEFINIR uma cor, então o seletor do
		// sistema é o comportamento certo.
		const bloco = containerEl.createDiv({ cls: CLASSE_IGNORAR });

		const settingCor = new Setting(bloco).setName("Cor");
		settingCor.addColorPicker((p) =>
			p.setValue(c.cor ?? "#7852ee").onChange(async (v) => {
				c.cor = normalizarHex(v) ?? undefined;
				await this.salvar();
			}),
		);
		settingCor.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip("Voltar à cor padrão do Obsidian")
				.onClick(async () => {
					c.cor = undefined;
					await this.salvar();
					this.redesenhar();
				}),
		);

		this.controleIcone(
			bloco,
			"Estilo Padrão",
			"Vale para qualquer nome inventado sem estilo próprio.",
			() => c.icone,
			(v) => {
				c.icone = v;
			},
		);

		this.controleTamanhoIcone(
			bloco,
			c.estilo,
			"Vazio = usa o tamanho do estilo global.",
			true,
			() => this.salvar(),
		);
	}

	// ── Estilo global ──────────────────────────────────────────────────────────────────────

	private estiloGlobal(containerEl: HTMLElement): void {
		const g = this.dados.global;
		const salvar = (): Promise<void> => this.salvar();

		// Sem cor nem ícone: o global não os define (isso é do estilo Padrão e dos nomeados),
		// então a prévia mostra o azul do Obsidian com a forma configurada aqui.
		this.criarPrevia(containerEl, () => ({ estilo: g }));

		this.controleNumero(containerEl, g, "larguraBorda", {
			nome: "Espessura da borda",
			desc: "O padrão do Obsidian é 0 — sem borda, só o fundo colorido.",
			min: 0,
			max: 12,
			passo: 1,
			sufixo: "px",
		}, 0, salvar);

		this.controleNumero(containerEl, g, "radius", {
			nome: "Arredondamento das quinas",
			desc: "O padrão do Obsidian é 4px.",
			min: 0,
			max: 32,
			passo: 1,
			sufixo: "px",
		}, 4, salvar);

		this.controlePorcentagem(containerEl, g, "opacidadeFundo", {
			nome: "Intensidade do fundo",
			desc: "Quanto da cor do callout aparece no fundo. O padrão do Obsidian é 10%.",
			min: 0,
			max: 100,
			passo: 5,
		}, 10, salvar);

		this.controlePorcentagem(containerEl, g, "opacidadeBorda", {
			nome: "Intensidade da borda",
			desc: "Quanto da cor do callout aparece na borda. O padrão do Obsidian é 25%.",
			min: 0,
			max: 100,
			passo: 5,
		}, 25, salvar);

		new Setting(containerEl)
			.setName("Alinhamento do título")
			.addDropdown((d) => {
				ALINHAMENTOS.forEach((a) => d.addOption(a.valor, a.rotulo));
				d.setValue(g.alinhamentoTitulo ?? "esquerda");
				d.onChange(async (v) => {
					g.alinhamentoTitulo = v as AlinhamentoTitulo;
					await salvar();
				});
			});

		new Setting(containerEl)
			.setName("Mostrar o ícone")
			.addToggle((t) =>
				t.setValue(g.mostrarIcone !== false).onChange(async (v) => {
					g.mostrarIcone = v;
					await salvar();
					this.redesenhar();
				}),
			);

		// Só faz sentido enquanto o ícone estiver visível.
		if (g.mostrarIcone !== false) {
			this.controleTamanhoIcone(
				containerEl,
				g,
				`Vale para todos os callouts. O padrão do Obsidian é ${TAMANHO_ICONE.padrao}px.`,
				false,
				salvar,
			);
		}

		new Setting(containerEl)
			.setName("Título em negrito")
			.setDesc("Desligue para o título ter o mesmo peso do texto normal.")
			.addToggle((t) =>
				t.setValue((g.pesoTitulo ?? 600) >= 600).onChange(async (v) => {
					g.pesoTitulo = v ? 600 : 400;
					await salvar();
				}),
			);

		new Setting(containerEl)
			.setName("Cor sólida")
			.setDesc(
				"O Obsidian mistura o fundo do callout com o fundo da nota, o que desbota cores fortes. " +
					"Ligue para a cor aparecer exatamente como escolhida.",
			)
			.addToggle((t) =>
				t.setValue(g.corSolida === true).onChange(async (v) => {
					g.corSolida = v;
					await salvar();
				}),
			);
	}

	// ── Tipos com ajustes próprios ─────────────────────────────────────────────────────────

	private listaDeTipos(containerEl: HTMLElement): void {
		const total = this.dados.personalizados.length;
		const acordeao = criarAcordeao(containerEl, {
			chave: CHAVE_NOMEADOS,
			titulo: "Estilos nomeados",
			descricao: "Cada estilo tem um identificador que você usa no markdown, com cor e ícone próprios.",
			resumo: `${total} ${total === 1 ? "estilo" : "estilos"}`,
			aninhado: true,
		});

		// Dentro de `-acoes`: o acordeão ignora cliques aqui, então criar um estilo não fecha a
		// seção onde o editor dele vai abrir.
		const acoes = acordeao.cabecalho.createDiv({ cls: "customize-acordeao-acoes" });
		new Setting(acoes).addButton((b) =>
			b
				.setButtonText("Novo estilo")
				.setCta()
				.onClick(() => this.adicionarTipo()),
		);

		acordeao.sePreenchido((corpo) => this.desenharTipos(corpo));
	}

	private desenharTipos(containerEl: HTMLElement): void {
		if (this.dados.personalizados.length === 0) {
			containerEl.createDiv({
				cls: "customize-config-vazio",
				text: "Nenhum estilo nomeado ainda. Todos os callouts usam o estilo Padrão.",
			});
			return;
		}

		this.dados.personalizados.forEach((p, i) => {
			const setting = new Setting(containerEl)
				.setName(p.tipo)
				.setDesc(this.resumo(p));

			if (p.cor) {
				const amostra = setting.settingEl.createDiv({ cls: "customize-config-mini" });
				amostra.style.setProperty("--customize-cor", p.cor);
			}

			setting.addButton((b) =>
				b
					.setButtonText(this.editando === p.tipo ? "Fechar" : "Editar")
					.onClick(() => {
						this.editando = this.editando === p.tipo ? null : p.tipo;
						this.redesenhar();
					}),
			);

			setting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip("Remover ajustes deste tipo")
					.onClick(async () => {
						this.dados.personalizados.splice(i, 1);
						if (this.editando === p.tipo) this.editando = null;
						await this.salvar();
						this.redesenhar();
					}),
			);

			if (this.editando === p.tipo) this.editorDoTipo(containerEl, p);
		});
	}

	private resumo(p: CalloutPersonalizado): string {
		const partes: string[] = [];
		if (p.icone) partes.push(`ícone ${p.icone}`);
		const ajustes = Object.keys(p.estilo).length;
		if (ajustes > 0) partes.push(`${ajustes} ${ajustes === 1 ? "ajuste" : "ajustes"} de estilo`);
		return partes.length > 0 ? partes.join(" · ") : "Usa o estilo global";
	}

	private async adicionarTipo(): Promise<void> {
		// Sugere o primeiro tipo embutido que ainda não foi personalizado.
		const usados = new Set(this.dados.personalizados.map((p) => p.tipo));
		const sugestao = TIPOS_EMBUTIDOS.map((t) => t.nome).find((n) => !usados.has(n)) ?? "novo";

		this.dados.personalizados.push({ tipo: sugestao, estilo: {} });
		this.editando = sugestao;
		// O estilo novo nasce com o editor aberto; a seção que o contém precisa estar aberta
		// junto, senão o botão parece não ter feito nada.
		abrirAcordeao(CHAVE_NOMEADOS);
		await this.salvar();
		this.redesenhar();
	}

	private editorDoTipo(containerEl: HTMLElement, p: CalloutPersonalizado): void {
		// CLASSE_IGNORAR: o seletor de cor aqui é para DEFINIR uma cor — o seletor do sistema
		// é o comportamento certo, então não deixamos o próprio plugin interceptá-lo.
		const editor = containerEl.createDiv({ cls: `customize-editor-cores ${CLASSE_IGNORAR}` });
		const salvar = (): Promise<void> => this.salvar();

		this.criarPrevia(editor, () => ({
			estilo: resolverEstilo(this.dados.global, p.estilo),
			cor: p.cor,
			icone: p.icone,
		}));

		new Setting(editor)
			.setName("Identificador do estilo")
			.setDesc("O que você escreve no markdown: `hoje` para `> [!hoje]` ou `> [!hoje|Meu título]`.")
			.addText((t) =>
				t
					.setPlaceholder("hoje")
					.setValue(p.tipo)
					.onChange(async (v) => {
						const limpo = v.trim().toLowerCase();
						if (!limpo) return;
						this.editando = limpo;
						p.tipo = limpo;
						await salvar();
					}),
			);

		const settingCor = new Setting(editor)
			.setName("Cor")
			.setDesc("Define o título, o ícone, a borda e o fundo deste tipo.");

		settingCor.addColorPicker((c) =>
			c.setValue(p.cor ?? "#7852ee").onChange(async (v) => {
				p.cor = normalizarHex(v) ?? undefined;
				await salvar();
			}),
		);

		settingCor.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip("Voltar à cor padrão do Obsidian")
				.onClick(async () => {
					p.cor = undefined;
					await salvar();
					this.redesenhar();
				}),
		);

		this.controleIcone(
			editor,
			p.tipo,
			"Trocar o ícone só aparece ao reabrir a nota.",
			() => p.icone,
			(v) => {
				p.icone = v;
			},
		);

		this.controleTamanhoIcone(editor, p.estilo, "Vazio = usa o tamanho global.", true, salvar);

		editor.createEl("p", {
			cls: "customize-config-nota",
			text: "Ajustes abaixo sobrescrevem o estilo global só neste tipo. Vazio = usa o global.",
		});

		this.controleNumeroOpcional(editor, p.estilo, "larguraBorda", {
			nome: "Espessura da borda",
			desc: "",
			min: 0,
			max: 12,
			passo: 1,
			sufixo: "px",
		}, salvar);

		this.controleNumeroOpcional(editor, p.estilo, "radius", {
			nome: "Arredondamento das quinas",
			desc: "",
			min: 0,
			max: 32,
			passo: 1,
			sufixo: "px",
		}, salvar);

		new Setting(editor).setName("Alinhamento do título").addDropdown((d) => {
			d.addOption("", "Usar o global");
			ALINHAMENTOS.forEach((a) => d.addOption(a.valor, a.rotulo));
			d.setValue(p.estilo.alinhamentoTitulo ?? "");
			d.onChange(async (v) => {
				p.estilo.alinhamentoTitulo = v ? (v as AlinhamentoTitulo) : undefined;
				await salvar();
			});
		});

		new Setting(editor).setName("Mostrar o ícone").addDropdown((d) => {
			d.addOption("", "Usar o global");
			d.addOption("sim", "Sim");
			d.addOption("nao", "Não");
			d.setValue(p.estilo.mostrarIcone === undefined ? "" : p.estilo.mostrarIcone ? "sim" : "nao");
			d.onChange(async (v) => {
				p.estilo.mostrarIcone = v === "" ? undefined : v === "sim";
				await salvar();
			});
		});
	}

	// ── Importação do Callout Manager ──────────────────────────────────────────────────────

	private importacao(containerEl: HTMLElement): void {
		if (!this.calloutManagerPresente) return;

		// Acordeão aninhado como as demais, mas ABERTO por padrão: só aparece quando o Callout
		// Manager está instalado, e é um aviso com prazo — se ela desinstalar o outro plugin
		// antes de importar, as cores e ícones se perdem. Escondido não cumpriria esse papel.
		const acordeao = criarAcordeao(containerEl, {
			chave: "customize:callouts:importar",
			titulo: "Importar do Callout Manager",
			aninhado: true,
			abertoPorPadrao: true,
		});

		acordeao.sePreenchido((corpo) => this.desenharImportacao(corpo));
	}

	private desenharImportacao(containerEl: HTMLElement): void {
		containerEl.createEl("p", {
			cls: "customize-config-nota",
			text:
				"Encontrei callouts configurados no plugin Callout Manager. Importe antes de " +
				"desinstalá-lo, senão as cores e ícones se perdem. Tipos que já existirem aqui " +
				"não são sobrescritos.",
		});

		new Setting(containerEl)
			.setName("Importar callouts")
			.addButton((b) =>
				b
					.setButtonText("Importar")
					.setCta()
					.onClick(async () => {
						const { callouts, ignorados } = await importarDoCalloutManager(this.plugin.app);
						if (callouts.length === 0) {
							new Notice("Não encontrei callouts para importar.");
							return;
						}

						const existentes = new Set(this.dados.personalizados.map((p) => p.tipo));
						const novos = callouts.filter((c) => !existentes.has(c.tipo));
						this.dados.personalizados.push(...novos);

						// Importar sem ligar a customização deixaria a impressão de que não funcionou.
						this.dados.ativo = true;
						await this.salvar();
						this.redesenhar();

						const pulados = callouts.length - novos.length;
						const detalhes = [
							`${novos.length} ${novos.length === 1 ? "callout importado" : "callouts importados"}`,
							pulados > 0 ? `${pulados} já existiam` : "",
							ignorados.length > 0 ? `${ignorados.length} sem cor/ícone` : "",
						].filter(Boolean);
						new Notice(detalhes.join(", ") + ".");
					}),
			);
	}

	// ── Controles reutilizáveis ────────────────────────────────────────────────────────────

	/**
	 * Escolha de ícone por modal visual (`ModalEscolherIcone`), com o ícone atual à mostra.
	 *
	 * `ler`/`gravar` em vez de receber o objeto e o nome do campo: os dois donos de ícone
	 * (`coringa` e cada `CalloutPersonalizado`) têm o campo no mesmo lugar, mas passar
	 * closures deixa o controle indiferente à forma do dado.
	 */
	private controleIcone(
		containerEl: HTMLElement,
		contexto: string,
		desc: string,
		ler: () => string | undefined,
		gravar: (v: string | undefined) => void,
	): void {
		const setting = new Setting(containerEl).setName("Ícone").setDesc(desc);

		const amostra = setting.controlEl.createDiv({ cls: "customize-icone-amostra" });
		const rotulo = setting.controlEl.createSpan({ cls: "customize-icone-nome" });

		const refletir = (): void => {
			const atual = ler();
			amostra.empty();
			// `lucide-pencil` é o que o Obsidian usa quando o tipo não define ícone.
			setIcon(amostra, atual || "lucide-pencil");
			amostra.toggleClass("is-padrao", !atual);
			rotulo.setText(atual ?? "padrão do Obsidian");
		};
		refletir();

		setting.addButton((b) =>
			b.setButtonText("Escolher").onClick(() => {
				new ModalEscolherIcone(this.plugin.app, contexto, ler(), async (escolhido) => {
					gravar(escolhido);
					refletir();
					await this.salvar();
				}).open();
			}),
		);

		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip("Voltar ao ícone padrão")
				.onClick(async () => {
					gravar(undefined);
					refletir();
					await this.salvar();
				}),
		);
	}

	/**
	 * Tamanho do ícone. O `undefined` continua significando "herda" — no global ele cai no
	 * padrão do Obsidian (18px), nos estilos específicos no que o global definiu.
	 */
	private controleTamanhoIcone(
		containerEl: HTMLElement,
		alvo: EstiloCallout,
		desc: string,
		opcional: boolean,
		salvar: () => Promise<void>,
	): void {
		const setting = new Setting(containerEl).setName("Tamanho do ícone").setDesc(desc);

		setting.addSlider((s) =>
			s
				.setLimits(TAMANHO_ICONE.min, TAMANHO_ICONE.max, 1)
				.setValue(alvo.tamanhoIcone ?? TAMANHO_ICONE.padrao)
				.setDynamicTooltip()
				.onChange(async (v) => {
					alvo.tamanhoIcone = v;
					await salvar();
				}),
		);

		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(opcional ? "Usar o tamanho global" : "Voltar ao tamanho padrão")
				.onClick(async () => {
					alvo.tamanhoIcone = undefined;
					await salvar();
					this.redesenhar();
				}),
		);
	}

	/** Slider com valor sempre definido (usado no global), com botão de voltar ao padrão. */
	private controleNumero(
		containerEl: HTMLElement,
		alvo: EstiloCallout,
		campo: "larguraBorda" | "radius",
		op: OpcoesNumero,
		padraoObsidian: number,
		salvar: () => Promise<void>,
	): void {
		const setting = new Setting(containerEl).setName(op.nome);
		if (op.desc) setting.setDesc(op.desc);

		setting.addSlider((s) =>
			s
				.setLimits(op.min, op.max, op.passo)
				.setValue(alvo[campo] ?? padraoObsidian)
				.setDynamicTooltip()
				.onChange(async (v) => {
					alvo[campo] = v;
					await salvar();
				}),
		);
	}

	/** Slider de porcentagem que grava 0–1 (as opacidades do CSS). */
	private controlePorcentagem(
		containerEl: HTMLElement,
		alvo: EstiloCallout,
		campo: "opacidadeFundo" | "opacidadeBorda",
		op: OpcoesNumero,
		padraoPercentual: number,
		salvar: () => Promise<void>,
	): void {
		const setting = new Setting(containerEl).setName(op.nome);
		if (op.desc) setting.setDesc(op.desc);

		const atual = alvo[campo];
		setting.addSlider((s) =>
			s
				.setLimits(op.min, op.max, op.passo)
				.setValue(atual === undefined ? padraoPercentual : Math.round(atual * 100))
				.setDynamicTooltip()
				.onChange(async (v) => {
					alvo[campo] = v / 100;
					await salvar();
				}),
		);
	}

	/** Campo numérico opcional (usado por tipo): vazio = herda do global. */
	private controleNumeroOpcional(
		containerEl: HTMLElement,
		alvo: EstiloCallout,
		campo: "larguraBorda" | "radius",
		op: OpcoesNumero,
		salvar: () => Promise<void>,
	): void {
		const setting = new Setting(containerEl).setName(op.nome);
		if (op.desc) setting.setDesc(op.desc);

		setting.addText((t) => {
			t.setPlaceholder("Usar o global")
				.setValue(alvo[campo] === undefined ? "" : String(alvo[campo]))
				.onChange(async (v) => {
					const limpo = v.trim();
					if (limpo === "") {
						alvo[campo] = undefined;
						await salvar();
						return;
					}
					const n = Number(limpo);
					if (!Number.isFinite(n)) return;
					alvo[campo] = Math.min(op.max, Math.max(op.min, n));
					await salvar();
				});
			t.inputEl.type = "number";
			t.inputEl.min = String(op.min);
			t.inputEl.max = String(op.max);
			t.inputEl.addClass("customize-input-numero");
		});
	}
}
