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
 * e por isso precisava de marca anti-duplicata, remoção manual e reposicionamento quando o tema
 * escondia o cabeçalho. Nada disso existe mais.
 *
 * O que sobra para nós é só: dar o ícone a cada view que ainda não tem, e manter todos os ícones
 * (várias notas abertas em split) desenhando o mesmo estado.
 *
 * ## O estado é do body, não do botão
 *
 * Quem esconde é o CSS, pela classe no `<body>` (ver `propriedades.ts`). O botão só alterna essa
 * classe e persiste a escolha — então dois splits concordam de graça, sem estado espalhado.
 */

/** Marca a view que já ganhou o ícone, para não empilhar um por re-render. */
const MARCA = "customize-olho";
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

	private darIconeA(view: MarkdownView): void {
		// `addAction` não é idempotente: chamá-la de novo empilharia um segundo ícone. A marca vive
		// no container da view, que o Obsidian descarta junto com a aba.
		const dono = view.containerEl;
		if (dono.dataset[MARCA]) return;

		const icone = view.addAction("eye-off", "Mostrar as propriedades ocultas", (evento) => {
			evento.preventDefault();
			void this.alternar();
		});
		icone.addClass(CLASSE_BOTAO);

		dono.dataset[MARCA] = "1";
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

	private removerIcones(): void {
		this.icones.forEach((icone) => icone.remove());
		this.icones.clear();
		// Sem limpar a marca, religar a funcionalidade não devolveria o ícone às abas já abertas.
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			delete leaf.view.containerEl.dataset[MARCA];
		});
	}
}
