/**
 * Helpers puros de cor. Sem DOM, sem Obsidian.
 *
 * O ponto crítico é `normalizarHex`: um `<input type="color">` só aceita "#rrggbb" de 6 dígitos.
 * Se escrevermos "#FFF" ou "vermelho" no `.value`, o navegador vira "#000000" em silêncio —
 * ou seja, a usuária escolheria branco e receberia preto sem nenhum aviso.
 */

const HEX_CURTO = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONGO = /^#?([0-9a-f]{6})$/i;

/** Normaliza para "#rrggbb" minúsculo. Devolve null se não for um hex reconhecível. */
export function normalizarHex(valor: string): string | null {
	const bruto = (valor ?? "").trim();
	if (!bruto) return null;

	const longo = HEX_LONGO.exec(bruto);
	if (longo) return `#${longo[1].toLowerCase()}`;

	const curto = HEX_CURTO.exec(bruto);
	if (curto) {
		const [, r, g, b] = curto;
		return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
	}

	return null;
}

/** Componentes 0–255 de um hex já normalizado. */
function componentes(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Hex → triplet "r, g, b" (sem `rgb()`), que é o formato que o Obsidian usa em
 * `--callout-color` e consome como `rgb(var(--callout-color))`. Devolve null se o hex
 * for inválido — passar hex direto para a variável quebraria em silêncio.
 */
export function hexParaRgb(hex: string): string | null {
	const normalizado = normalizarHex(hex);
	if (!normalizado) return null;
	return componentes(normalizado).join(", ");
}

/** Triplet "r, g, b" → hex. Usado ao importar cores do Callout Manager. */
export function rgbParaHex(triplet: string): string | null {
	const partes = triplet.split(",").map((p) => Number(p.trim()));
	if (partes.length !== 3) return null;
	if (partes.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
	const hex = partes.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
	return `#${hex}`;
}

/** Luminância relativa (WCAG 2.x), 0 = preto, 1 = branco. */
export function luminancia(hex: string): number {
	const canal = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const [r, g, b] = componentes(hex);
	return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * true se o swatch é claro demais para se distinguir de um fundo claro e precisa de borda mais
 * marcada. O limiar é visual, não normativo: branco (1.0) e quase-brancos precisam, o resto não.
 */
export function precisaBorda(hex: string): boolean {
	return luminancia(hex) > 0.8;
}
