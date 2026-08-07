import { setIcon, type App } from "obsidian";
import { CLASSE_REVELADO, normalizarChave, type DadosPropriedades } from "./propriedades";

/**
 * O olhinho que revela as propriedades escondidas.
 *
 * ## Onde ele mora, e por que não num MutationObserver
 *
 * O botão é inserido no `.metadata-properties-heading` de cada `.metadata-container` visível. Esse
 * bloco é recriado pelo Obsidian a cada troca de nota, então algo precisa reinserir o botão.
 *
 * A escolha aqui é **varrer nos eventos do workspace** (`layout-change`, `active-leaf-change`,
 * `file-open`) em vez de observar mutações do DOM. É o mesmo padrão que o `gerenciador-de-abas.ts`
 * usa para as Bases, e a razão é a registrada no doc do plugin: um observador disparando a cada
 * tecla digitada no frontmatter já travou o Obsidian antes. Os eventos do workspace disparam nas
 * transições que importam e ficam quietos enquanto ela digita.
 *
 * ## ARMADILHA — o botão não pode entrar duas vezes
 *
 * `varrer()` roda várias vezes para o mesmo container (os três eventos podem disparar em sequência
 * numa única troca de nota). Por isso a marca `data-customize-olho` no container: já tem botão,
 * pula. Sem isso, uma nota aberta e fechada algumas vezes acumularia olhinhos lado a lado.
 *
 * ## O estado é do body, não do botão
 *
 * Quem esconde é o CSS, através da classe no `<body>` (ver `propriedades.ts`). O botão só alterna
 * essa classe e persiste a escolha. Assim os olhinhos de todas as notas abertas em split
 * concordam entre si de graça — não há estado espalhado para sincronizar.
 */

const MARCA = "data-customize-olho";
const CLASSE_BOTAO = "customize-props-olho";

export class BotaoPropriedades {
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
		const revelado = dados.ativo && dados.revelado;
		document.body.toggleClass(CLASSE_REVELADO, revelado);
	}

	/** Insere o botão onde falta e remove onde não deve mais existir. */
	varrer(): void {
		const dados = this.getDados();
		const containers = document.querySelectorAll<HTMLElement>(".metadata-container");

		containers.forEach((container) => {
			// Sem nada escondido, o olhinho não teria o que revelar — seria um botão morto no
			// cabeçalho de toda nota do vault.
			if (!dados.ativo || this.temOcultas(dados) === false) {
				this.removerDe(container);
				return;
			}
			this.inserirEm(container);
		});
	}

	/** Tira todos os botões e a classe do body. Usado no `onunload` e ao desligar a funcionalidade. */
	limpar(): void {
		document.body.removeClass(CLASSE_REVELADO);
		document
			.querySelectorAll<HTMLElement>(`.${CLASSE_BOTAO}`)
			.forEach((botao) => botao.remove());
		document
			.querySelectorAll<HTMLElement>(`[${MARCA}]`)
			.forEach((container) => container.removeAttribute(MARCA));
	}

	/** Há alguma propriedade cadastrada para esconder? */
	private temOcultas(dados: DadosPropriedades): boolean {
		return dados.ocultas.some((c) => normalizarChave(c).length > 0);
	}

	private removerDe(container: HTMLElement): void {
		if (!container.hasAttribute(MARCA)) return;
		container.removeAttribute(MARCA);
		container.querySelectorAll<HTMLElement>(`.${CLASSE_BOTAO}`).forEach((b) => b.remove());
	}

	private inserirEm(container: HTMLElement): void {
		if (container.hasAttribute(MARCA)) return;

		// O cabeçalho "Propriedades" é o lugar natural, mas o tema Minimal o esconde
		// (`.metadata-heading-off`). Nesse caso o botão vai no próprio container, e o CSS o
		// posiciona no canto — senão o olhinho ficaria invisível junto com o cabeçalho.
		const cabecalho = container.querySelector<HTMLElement>(".metadata-properties-heading");
		const destino = cabecalho ?? container;

		const botao = destino.createEl("button", { cls: `clickable-icon ${CLASSE_BOTAO}` });
		botao.type = "button";
		if (!cabecalho) botao.addClass("customize-props-olho-solto");

		this.pintar(botao);

		botao.addEventListener("click", (evento) => {
			// O cabeçalho do bloco de propriedades é clicável no Obsidian (recolhe a seção).
			// Sem isto, revelar as propriedades fecharia o bloco no mesmo clique.
			evento.preventDefault();
			evento.stopPropagation();
			void this.alternar();
		});

		container.setAttribute(MARCA, "1");
	}

	private async alternar(): Promise<void> {
		const dados = this.getDados();
		const novo = !dados.revelado;
		await this.aoAlternar(novo);
		this.sincronizarBody();
		// Repinta os olhinhos de todas as notas abertas — em split, os dois precisam concordar.
		document.querySelectorAll<HTMLElement>(`.${CLASSE_BOTAO}`).forEach((b) => this.pintar(b));
	}

	/** Ícone e rótulo refletem o estado atual: olho aberto = as escondidas estão à mostra. */
	private pintar(botao: HTMLElement): void {
		const revelado = this.getDados().revelado;
		setIcon(botao, revelado ? "eye" : "eye-off");
		botao.setAttribute(
			"aria-label",
			revelado ? "Esconder as propriedades ocultas" : "Mostrar as propriedades ocultas",
		);
		botao.toggleClass("is-ativo", revelado);
	}
}
