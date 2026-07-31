import type { Plugin } from "obsidian";
import { normalizarHex } from "./cores";
import { paletaAtiva, type DadosCustomize } from "./dados";
import type { PopoverPaleta } from "./popover-paleta";

/**
 * ÚNICO módulo com conhecimento frágil do DOM/Electron. Se o Obsidian ou o Chromium mudarem
 * o comportamento do seletor de cor, só este arquivo muda.
 *
 * ── Mapa do que sabemos ───────────────────────────────────────────────────────────────────
 *
 * 1. ONDE ESTÃO OS SELETORES
 *    Todo seletor de cor do Obsidian (Aparência, CSS variables) e de plugins que usam
 *    `Setting.addColorPicker` é um `<input type="color">` real no DOM. A API `ColorComponent`
 *    NÃO expõe `colorEl` nem qualquer handle do elemento (obsidian.d.ts 1.13.1), então achamos
 *    por query de DOM — não há caminho oficial.
 *
 * 2. COMO IMPEDIR O DIÁLOGO DO SISTEMA
 *    `preventDefault()` no `click` NÃO funciona: no Chromium/Electron o diálogo já abriu nesse
 *    ponto. Pelo algoritmo "show the picker" da spec HTML, o diálogo nasce da ativação no
 *    `mousedown` — é lá que o `preventDefault()` precisa acontecer, em fase de CAPTURA para
 *    rodar antes dos handlers do Obsidian. O `keydown` (Enter/Espaço) é o mesmo caminho pelo
 *    teclado; sem ele a paleta seria contornável tabulando até o seletor.
 *
 * 3. COMO DEVOLVER O VALOR
 *    Escrever em `.value` não dispara evento nenhum. Quem escuta (o Obsidian e os plugins)
 *    precisa receber `input` e `change` disparados à mão — ver `aplicarCor`.
 *
 * 4. ESTRATÉGIA: DELEGAÇÃO, NÃO MutationObserver
 *    Um listener em `document` cobre inputs criados no futuro sem janela de corrida (settings
 *    tabs são reconstruídas a cada `containerEl.empty()`). Como não injetamos nada no DOM,
 *    não há o que observar — um MutationObserver aqui seria só custo e risco.
 */

const SELETOR_INPUT_COR = 'input[type="color"]';

/** Marcação para excluir uma área da interceptação (usada pelas nossas próprias settings). */
export const CLASSE_IGNORAR = "customize-ignorar";

export class InterceptadorDeCor {
	/**
	 * O input que estamos deliberadamente liberando para o diálogo nativo (botão "Cor
	 * personalizada"). É um input específico, não um booleano global: liberar um seletor
	 * não pode liberar os outros da mesma tela.
	 */
	private inputLiberado: HTMLInputElement | null = null;

	constructor(
		private plugin: Plugin,
		private getDados: () => DadosCustomize,
		private popover: PopoverPaleta,
	) {}

	iniciar(): void {
		// CAPTURA (true): precisamos rodar antes de qualquer handler do Obsidian ou de plugins
		// terceiros. registerDomEvent desregistra sozinho no onunload.
		this.plugin.registerDomEvent(document, "mousedown", (ev) => this.aoMousedown(ev), true);
		this.plugin.registerDomEvent(document, "keydown", (ev) => this.aoKeydown(ev), true);
	}

	private alvo(ev: Event): HTMLInputElement | null {
		const el = ev.target;
		if (!(el instanceof HTMLInputElement)) return null;
		if (!el.matches(SELETOR_INPUT_COR)) return null;
		if (el.disabled) return null;
		return el;
	}

	/** A porta única: qualquer motivo para não interceptar passa por aqui. */
	private deveIntervir(input: HTMLInputElement): boolean {
		const dados = this.getDados();
		if (!dados.interceptacaoAtiva) return false;
		if (this.inputLiberado === input) return false;
		if (input.closest(`.${CLASSE_IGNORAR}`)) return false;

		for (const seletor of dados.seletoresIgnorados) {
			const limpo = seletor.trim();
			if (!limpo) continue;
			// Um seletor inválido digitado pela usuária não pode quebrar o mousedown de todo o app.
			try {
				if (input.closest(limpo)) return false;
			} catch {
				continue;
			}
		}

		// Paleta sem cores: um popover vazio não ajuda ninguém, melhor deixar o nativo.
		if (paletaAtiva(dados).cores.length === 0) return false;

		return true;
	}

	private aoMousedown(ev: MouseEvent): void {
		if (ev.button !== 0) return; // botão direito/meio: deixa o menu de contexto nativo
		const input = this.alvo(ev);
		if (!input || !this.deveIntervir(input)) return;
		// preventDefault num evento não-cancelável é no-op silencioso: abriríamos o popover E o
		// diálogo do sistema ao mesmo tempo. Melhor deixar o nativo.
		if (!ev.cancelable) return;

		ev.preventDefault();
		ev.stopPropagation();
		this.abrirPopover(input);
	}

	private aoKeydown(ev: KeyboardEvent): void {
		if (ev.key !== "Enter" && ev.key !== " ") return;
		const input = this.alvo(ev);
		if (!input || !this.deveIntervir(input)) return;
		if (!ev.cancelable) return;

		ev.preventDefault();
		ev.stopPropagation();
		this.abrirPopover(input);
	}

	private abrirPopover(input: HTMLInputElement): void {
		const dados = this.getDados();
		this.popover.abrir(input, {
			modo: "escolher",
			cores: paletaAtiva(dados).cores,
			corAtual: input.value,
			permitirCorPersonalizada: dados.permitirCorPersonalizada,
			aoEscolher: (hex) => {
				aplicarCor(input, hex);
				return true; // escolheu a cor: fecha
			},
			// Síncrono dentro do clique: showPicker() exige transient user activation.
			aoPedirCorPersonalizada: () => {
				this.popover.fechar();
				this.abrirNativo(input);
			},
		});
		// O preventDefault do mousedown também cancelou o foco — devolvemos aqui, para que o
		// Escape tenha para onde voltar.
		input.focus({ preventScroll: true });
	}

	/** Abre o diálogo do sistema para este input, contornando a nossa própria supressão. */
	private abrirNativo(input: HTMLInputElement): void {
		this.inputLiberado = input;
		try {
			// showPicker() não passa por mousedown nenhum, então nem chega no interceptador —
			// o flag acima é só cinto de segurança para o fallback abaixo.
			input.showPicker();
		} catch {
			// Fallback: o .click() sintético GERA um mousedown, e é aí que o flag salva.
			try {
				input.click();
			} catch {
				/* sem caminho para o diálogo nativo: desiste em silêncio */
			}
		} finally {
			// Solta no próximo tick, depois que o mousedown sintético já foi processado.
			window.setTimeout(() => {
				this.inputLiberado = null;
			}, 0);
		}
	}
}

/**
 * Aplica um hex ao input e avisa quem estiver escutando.
 *
 * `bubbles: true` é obrigatório: `ColorComponent` escuta no próprio input, mas as CSS variables
 * do Obsidian e vários plugins usam delegação num container acima — sem borbulhar, falham em
 * silêncio. A ordem input → change espelha o diálogo nativo (valor mudando → valor confirmado),
 * então quem escuta só um dos dois continua funcionando.
 */
export function aplicarCor(input: HTMLInputElement, hex: string): void {
	const valor = normalizarHex(hex);
	if (!valor) return;

	input.value = valor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.dispatchEvent(new Event("change", { bubbles: true }));
}
