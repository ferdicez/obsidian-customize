import { MarkdownView, setIcon, type App } from "obsidian";
import { CLASSE_REVELADO, normalizarChave, type DadosPropriedades } from "./propriedades";

/**
 * O olhinho que revela as propriedades escondidas.
 *
 * ## Onde ele mora, e por quê
 *
 * Na **barra de ações da aba** — a fileira de ícones no canto superior direito, ao lado do livro
 * (modo de leitura) e do menu `⋮`. Escolha dela, depois de ver a primeira versão dentro do bloco
 * de propriedades: *"eu achei que ficou ruim do jeito que tá… do lado do livro"*.
 *
 * É o lugar certo por dois motivos, além da preferência dela: não rouba espaço do topo da nota, e
 * fica junto dos outros controles que **mudam como a nota é exibida** — que é exatamente o que ele
 * faz. Dentro do bloco, o olhinho competia com o conteúdo que ele deveria estar limpando.
 *
 * ## A API faz o trabalho pesado
 *
 * `view.addAction()` é a via oficial: o Obsidian posiciona, estiliza e **remove o ícone junto com a
 * view**. A versão anterior deste arquivo inseria `<button>` à mão no `.metadata-properties-heading`
 * e por isso precisava de remoção manual e reposicionamento quando o tema escondia o cabeçalho.
 *
 * O que sobra para nós é só: dar o ícone a cada view que ainda não tem (**sem duplicar** — ver a
 * ARMADILHA em `darIconeA`), e manter todos os ícones (várias notas abertas em split) desenhando
 * o mesmo estado.
 *
 * ## O estado é do body, não do botão
 *
 * Quem esconde é o CSS, pela classe no `<body>` (ver `propriedades.ts`). O botão só alterna essa
 * classe e persiste a escolha — então dois splits concordam de graça, sem estado espalhado.
 */

/**
 * A classe do nosso ícone. É também o que impede a duplicata: `darIconeA` pergunta à barra de
 * ações se já existe um elemento com ela (ver a ARMADILHA lá embaixo).
 */
const CLASSE_BOTAO = "customize-props-olho";

export class BotaoPropriedades {
	/**
	 * Os ícones vivos, para repintar todos quando o estado muda. É um Set de elementos, e não uma
	 * lista de views, porque `addAction` devolve o próprio elemento — e um elemento que saiu do DOM
	 * (aba fechada) é detectado por `isConnected`, sem precisar de desregistro.
	 */
	private icones = new Set<HTMLElement>();

	constructor(
		private app: App,
		private getDados: () => DadosPropriedades,
		private aoAlternar: (revelado: boolean) => void | Promise<void>,
	) {}

	/**
	 * Aplica o estado atual no `<body>`. Chamado no início e sempre que a config muda — é o que
	 * garante que desligar a funcionalidade não deixe o vault preso no estado "revelado".
	 */
	sincronizarBody(): void {
		const dados = this.getDados();
		document.body.toggleClass(CLASSE_REVELADO, dados.ativo && dados.revelado);
	}

	/** Dá o ícone às views que ainda não têm, e tira de todas se a funcionalidade não se aplica. */
	varrer(): void {
		this.limparOrfaos();

		if (!this.deveAparecer()) {
			this.removerIcones();
			return;
		}

		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			this.darIconeA(view);
		});

		this.pintarTodos();
	}

	/** Tira os ícones e a classe do body. Usado no `onunload`. */
	limpar(): void {
		document.body.removeClass(CLASSE_REVELADO);
		this.removerIcones();
	}

	/**
	 * O olhinho só faz sentido com a funcionalidade ligada E com algo cadastrado para esconder —
	 * senão seria um botão morto na barra de toda nota.
	 */
	private deveAparecer(): boolean {
		const dados = this.getDados();
		return dados.ativo && dados.ocultas.some((c) => normalizarChave(c).length > 0);
	}

	/**
	 * Dá o ícone a uma view, no máximo um.
	 *
	 * ## ARMADILHA — a verdade é o DOM, não uma marca nossa
	 *
	 * `addAction` não é idempotente: chamada duas vezes, empilha dois ícones. A primeira versão
	 * disto marcava `view.containerEl.dataset` e pulava se a marca existisse — **e duplicou mesmo
	 * assim** (relato dela: "ele está com esses dois rolinhos agora"). O motivo é que o Obsidian
	 * **recria o `containerEl`** ao alternar entre edição e leitura: a marca vai embora junto, a
	 * varredura seguinte acha que a view nunca teve ícone, e adiciona outro. O mesmo vale para
	 * qualquer estado que a gente guarde fora do DOM que o Obsidian controla.
	 *
	 * A correção é perguntar à própria barra de ações quantos ícones nossos ela já tem. É o que o
	 * Note Toolbar faz (`querySelector(".view-actions")`), e é robusto porque a resposta vem de
	 * onde o ícone de fato está — se o Obsidian recriou a barra, ela está vazia e a pergunta se
	 * responde sozinha.
	 */
	private darIconeA(view: MarkdownView): void {
		const barra = view.containerEl.querySelector(".view-actions");
		if (!barra) return;

		const existentes = barra.querySelectorAll<HTMLElement>(`.${CLASSE_BOTAO}`);
		if (existentes.length > 0) {
			// Já tem. Se por qualquer motivo houver mais de um (duplicata vinda de uma versão
			// anterior nesta mesma sessão), fica só o primeiro.
			existentes.forEach((el, i) => {
				if (i === 0) this.icones.add(el);
				else el.remove();
			});
			return;
		}

		const icone = view.addAction("eye-off", "Mostrar as propriedades ocultas", (evento) => {
			evento.preventDefault();
			void this.alternar();
		});
		icone.addClass(CLASSE_BOTAO);
		this.icones.add(icone);
	}

	private async alternar(): Promise<void> {
		await this.aoAlternar(!this.getDados().revelado);
		this.sincronizarBody();
		this.pintarTodos();
	}

	/** Ícone e rótulo refletem o estado: olho aberto = as escondidas estão à mostra. */
	private pintarTodos(): void {
		const revelado = this.getDados().revelado;
		this.icones.forEach((icone) => {
			setIcon(icone, revelado ? "eye" : "eye-off");
			icone.setAttribute(
				"aria-label",
				revelado ? "Esconder as propriedades ocultas" : "Mostrar as propriedades ocultas",
			);
			icone.toggleClass("is-ativo", revelado);
		});
	}

	/** Esquece os ícones de abas já fechadas — senão o Set cresce sem parar durante a sessão. */
	private limparOrfaos(): void {
		this.icones.forEach((icone) => {
			if (!icone.isConnected) this.icones.delete(icone);
		});
	}

	/**
	 * Tira todos os ícones. Varre o DOM em vez de confiar só no Set: um ícone que tenha escapado
	 * do nosso registro (recriação de view, duplicata de uma versão anterior na mesma sessão)
	 * ficaria órfão na barra para sempre, e desligar a funcionalidade não pode deixar rastro.
	 */
	private removerIcones(): void {
		document
			.querySelectorAll<HTMLElement>(`.${CLASSE_BOTAO}`)
			.forEach((icone) => icone.remove());
		this.icones.clear();
	}
}
