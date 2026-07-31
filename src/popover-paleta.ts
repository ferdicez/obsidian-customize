import { normalizarHex, precisaBorda } from "./cores";

/**
 * O popover de swatches. Serve a dois usos:
 *
 * - modo "copiar"  — aberto pelo atalho de teclado. Mostra o hex ao lado de cada cor, clicar
 *                    copia para a área de transferência e o popover CONTINUA aberto (dá para
 *                    copiar várias em sequência). Aparece centralizado na tela.
 * - modo "escolher" — aberto ao clicar num seletor de cor, quando a substituição do seletor
 *                    nativo está ligada. Grade compacta, clicar escolhe e fecha. Ancorado no
 *                    seletor.
 *
 * Elemento próprio, não `Menu` do Obsidian: `MenuItem` só aceita título + ícone Lucide (não há
 * ponto de extensão para um quadradinho de cor) e `Menu` é uma lista vertical — aqui queremos
 * uma grade. Usar `Menu` significaria hackear o DOM interno dele, exatamente o acoplamento
 * frágil que este plugin evita.
 *
 * Este módulo não sabe nada sobre `<input type="color">` nem sobre persistência: recebe uma
 * lista de hex e devolve a escolha por callback.
 */

/** Colunas da grade em cada modo. Precisa bater com o CSS (navegação por ↑/↓ depende disso). */
const COLUNAS: Record<ModoPopover, number> = {
	copiar: 4,
	escolher: 8,
};

export type ModoPopover = "copiar" | "escolher";

export interface OpcoesPopover {
	modo: ModoPopover;
	cores: string[];
	/** Cor a destacar como "atual" (só faz sentido no modo escolher). */
	corAtual?: string;
	/** Título opcional no topo (usado no modo copiar para mostrar o nome da paleta). */
	titulo?: string;
	permitirCorPersonalizada: boolean;
	/** Devolve true se o popover deve fechar depois da escolha. */
	aoEscolher: (hex: string, botao: HTMLElement) => boolean | void;
	/** Chamado no clique do botão "Cor personalizada". Precisa abrir o diálogo nativo de forma
	 *  SÍNCRONA — `showPicker()` exige user activation, que se perde depois de um await/timeout. */
	aoPedirCorPersonalizada?: () => void;
}

export class PopoverPaleta {
	private el: HTMLElement | null = null;
	private swatches: HTMLElement[] = [];
	private indiceFoco = 0;
	private modo: ModoPopover = "escolher";
	/** Elemento a quem devolver o foco ao fechar (null quando aberto pelo atalho). */
	private ancora: HTMLElement | null = null;
	/** Listeners efêmeros (só existem enquanto o popover está aberto). */
	private limpadores: Array<() => void> = [];

	get aberto(): boolean {
		return this.el !== null;
	}

	/** Abre ancorado num elemento (modo escolher). */
	abrir(ancora: HTMLElement, opcoes: OpcoesPopover): void {
		this.montar(opcoes, ancora);
		if (this.el) this.posicionarNaAncora(this.el, ancora);
		this.finalizarAbertura(opcoes);
	}

	/** Abre centralizado na tela (modo copiar, chamado pelo atalho). */
	abrirCentralizado(opcoes: OpcoesPopover): void {
		this.montar(opcoes, null);
		if (this.el) this.centralizar(this.el);
		this.finalizarAbertura(opcoes);
	}

	private montar(opcoes: OpcoesPopover, ancora: HTMLElement | null): void {
		this.fechar();
		this.ancora = ancora;
		this.modo = opcoes.modo;

		const el = document.body.createDiv({ cls: `customize-popover is-modo-${opcoes.modo}` });
		this.el = el;
		// Medimos antes de posicionar; sem isso o popover pisca no canto errado por um frame.
		el.style.visibility = "hidden";

		if (opcoes.titulo) el.createDiv({ cls: "customize-popover-titulo", text: opcoes.titulo });

		this.montarGrade(el, opcoes);
		if (opcoes.permitirCorPersonalizada && opcoes.aoPedirCorPersonalizada) {
			this.montarRodape(el, opcoes);
		}
	}

	private finalizarAbertura(opcoes: OpcoesPopover): void {
		if (this.el) this.el.style.visibility = "";
		this.registrarFechamento();
		this.focarInicial(opcoes);
	}

	private montarGrade(el: HTMLElement, opcoes: OpcoesPopover): void {
		const grade = el.createDiv({ cls: "customize-popover-grade" });
		grade.setAttribute("role", "listbox");
		grade.setAttribute("aria-label", "Paleta de cores");

		const atual = opcoes.corAtual ? normalizarHex(opcoes.corAtual) : null;
		this.swatches = [];

		opcoes.cores.forEach((cor) => {
			const hex = normalizarHex(cor);
			if (!hex) return;

			const botao = grade.createEl("button", { cls: "customize-swatch" });
			botao.type = "button";
			// A cor entra como custom property: a regra de estilo fica no CSS escopado,
			// o inline carrega só o dado.
			botao.style.setProperty("--customize-cor", hex);
			if (precisaBorda(hex)) botao.addClass("is-clara");
			botao.setAttribute("role", "option");
			botao.setAttribute("data-cor", hex);
			// A cor sozinha não é acessível — o hex precisa estar no nome acessível.
			botao.setAttribute("aria-label", opcoes.modo === "copiar" ? `Copiar ${hex}` : hex);
			botao.setAttribute("tabindex", "-1");

			const ehAtual = hex === atual;
			botao.setAttribute("aria-selected", String(ehAtual));
			if (ehAtual) botao.addClass("is-atual");

			// No modo copiar o hex fica visível: o objetivo é justamente ler/copiar o código.
			if (opcoes.modo === "copiar") {
				botao.createSpan({ cls: "customize-swatch-amostra" });
				botao.createSpan({ cls: "customize-swatch-hex", text: hex });
			}

			botao.addEventListener("click", () => {
				const fechar = opcoes.aoEscolher(hex, botao);
				if (fechar) this.fechar();
			});
			botao.addEventListener("keydown", (ev) => this.aoTeclar(ev));

			this.swatches.push(botao);
		});
	}

	private montarRodape(el: HTMLElement, opcoes: OpcoesPopover): void {
		const rodape = el.createDiv({ cls: "customize-popover-rodape" });
		const botao = rodape.createEl("button", {
			cls: "customize-btn-personalizada",
			text: "Cor personalizada…",
		});
		botao.type = "button";
		// Síncrono de propósito: showPicker() precisa da user activation deste clique.
		botao.addEventListener("click", () => opcoes.aoPedirCorPersonalizada?.());
	}

	/** Feedback visual de "copiado" no swatch clicado, sem fechar o popover. */
	marcarCopiado(botao: HTMLElement): void {
		this.el?.querySelectorAll(".is-copiado").forEach((e) => e.removeClass("is-copiado"));
		botao.addClass("is-copiado");
	}

	private focarInicial(opcoes: OpcoesPopover): void {
		if (this.swatches.length === 0) return;
		const atual = opcoes.corAtual ? normalizarHex(opcoes.corAtual) : null;
		const i = atual ? this.swatches.findIndex((s) => s.getAttribute("data-cor") === atual) : -1;
		this.focarSwatch(i >= 0 ? i : 0);
	}

	/** Foco roving: só um swatch é tabulável por vez, as setas movem o foco entre eles. */
	private focarSwatch(i: number): void {
		this.swatches[this.indiceFoco]?.setAttribute("tabindex", "-1");
		this.indiceFoco = i;
		const alvo = this.swatches[i];
		alvo?.setAttribute("tabindex", "0");
		alvo?.focus({ preventScroll: true });
	}

	private aoTeclar(ev: KeyboardEvent): void {
		const total = this.swatches.length;
		if (total === 0) return;
		const colunas = COLUNAS[this.modo];
		let novo = this.indiceFoco;

		switch (ev.key) {
			case "ArrowRight": novo = (this.indiceFoco + 1) % total; break;
			case "ArrowLeft": novo = (this.indiceFoco - 1 + total) % total; break;
			case "ArrowDown": novo = Math.min(total - 1, this.indiceFoco + colunas); break;
			case "ArrowUp": novo = Math.max(0, this.indiceFoco - colunas); break;
			case "Home": novo = 0; break;
			case "End": novo = total - 1; break;
			case "Enter":
			case " ":
				ev.preventDefault();
				this.swatches[this.indiceFoco]?.click();
				return;
			case "Escape":
				ev.preventDefault();
				// Sem stopPropagation o Escape fecharia junto o modal de settings por baixo.
				ev.stopPropagation();
				this.fechar();
				return;
			default:
				return;
		}

		ev.preventDefault();
		this.focarSwatch(novo);
	}

	private posicionarNaAncora(el: HTMLElement, ancora: HTMLElement): void {
		const MARGEM = 8;
		const r = ancora.getBoundingClientRect();
		const larg = el.offsetWidth;
		const alt = el.offsetHeight;

		// Preferência: logo abaixo do seletor, alinhado à esquerda dele.
		let top = r.bottom + 6;
		let left = r.left;

		if (top + alt > window.innerHeight - MARGEM) {
			const acima = r.top - alt - 6;
			// Só sobe se couber de verdade lá em cima; senão gruda no fundo (melhor que sair da tela).
			top = acima >= MARGEM ? acima : Math.max(MARGEM, window.innerHeight - alt - MARGEM);
		}

		left = Math.min(left, window.innerWidth - larg - MARGEM);
		left = Math.max(MARGEM, left);

		el.style.top = `${top}px`;
		el.style.left = `${left}px`;
	}

	private centralizar(el: HTMLElement): void {
		const MARGEM = 8;
		const left = (window.innerWidth - el.offsetWidth) / 2;
		// Um pouco acima do centro: fica mais confortável de ler do que exatamente no meio.
		const top = (window.innerHeight - el.offsetHeight) / 2.4;
		el.style.left = `${Math.max(MARGEM, left)}px`;
		el.style.top = `${Math.max(MARGEM, top)}px`;
	}

	private registrarFechamento(): void {
		// mousedown (não click) para fechar ANTES que um próximo seletor comece a abrir.
		this.ouvir(document, "mousedown", (ev) => {
			const alvo = (ev as MouseEvent).target;
			if (alvo instanceof Node && this.el?.contains(alvo)) return;
			this.fechar();
		}, true);

		this.ouvir(document, "keydown", (ev) => {
			const e = ev as KeyboardEvent;
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			this.fechar();
		}, true);

		// O painel de settings rola — sem isto o popover fica flutuando longe do seletor.
		// No modo copiar ele é centralizado na tela, então rolar não o desalinha.
		if (this.modo === "escolher") {
			this.ouvir(document, "scroll", () => this.fechar(), true);
		}
		this.ouvir(window, "resize", () => this.fechar());
		this.ouvir(window, "blur", () => this.fechar());
	}

	private ouvir(
		alvo: Document | Window,
		tipo: string,
		fn: (ev: Event) => void,
		captura = false,
	): void {
		alvo.addEventListener(tipo, fn, captura);
		this.limpadores.push(() => alvo.removeEventListener(tipo, fn, captura));
	}

	/** Idempotente: pode ser chamado quantas vezes for, inclusive com o popover já fechado. */
	fechar(): void {
		for (const limpar of this.limpadores) limpar();
		this.limpadores = [];

		this.el?.remove();
		this.el = null;
		this.swatches = [];
		this.indiceFoco = 0;

		const ancora = this.ancora;
		this.ancora = null;
		// Devolve o foco a um lugar sensato (o próprio seletor), sem sacudir a rolagem.
		ancora?.focus({ preventScroll: true });
	}

	destruir(): void {
		this.fechar();
	}
}
